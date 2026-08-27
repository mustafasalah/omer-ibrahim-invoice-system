import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import type { Capability, Role } from "@/domain/auth/capabilities";
import { getCapabilitiesForRole, roleHasCapability } from "@/domain/auth/capabilities";
import type { SessionUser } from "@/domain/auth/contracts";
import { getConfig } from "@/server/config/env";
import { getDatabase, type DatabaseConnection } from "@/server/db/connection";
import { withImmediateTransaction } from "@/server/db/transaction";
import { forbiddenError, unauthorizedError } from "@/server/http/errors";
import { readCookie, SESSION_COOKIE_NAME } from "./cookies";

export const SESSION_IDLE_MINUTES = 30;
export const SESSION_ABSOLUTE_HOURS = 12;
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1_000;

type SessionRow = {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: bigint;
  isActive: bigint;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
};

export type AuthenticatedSession = {
  id: string;
  user: SessionUser;
  absoluteExpiresAt: string;
};

export type CreatedSession = AuthenticatedSession & {
  token: string;
};

function toSessionUser(row: SessionRow): SessionUser {
  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    mustChangePassword: row.mustChangePassword === 1n,
    capabilities: getCapabilitiesForRole(row.role),
  };
}

function sessionTokenHash(token: string): string {
  return createHmac("sha256", getConfig().sessionSecret)
    .update(`oims-session:${token}`)
    .digest("base64url");
}

export function hashSessionToken(token: string): string {
  return sessionTokenHash(token);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function findSession(connection: DatabaseConnection, tokenHash: string): SessionRow | undefined {
  return connection.client
    .prepare(
      `select
         sessions.id as sessionId,
         sessions.user_id as userId,
         users.username as username,
         users.display_name as displayName,
         users.role as role,
         users.must_change_password as mustChangePassword,
         users.is_active as isActive,
         sessions.created_at as createdAt,
         sessions.last_seen_at as lastSeenAt,
         sessions.expires_at as expiresAt,
         sessions.absolute_expires_at as absoluteExpiresAt,
         sessions.revoked_at as revokedAt
       from sessions
       inner join users on users.id = sessions.user_id
       where sessions.token_hash = ?`,
    )
    .get(tokenHash) as SessionRow | undefined;
}

function revokeSessionHash(
  connection: DatabaseConnection,
  tokenHash: string,
  revokedAt: string,
): void {
  withImmediateTransaction(connection.client, () => {
    connection.client
      .prepare(
        "update sessions set revoked_at = ? where token_hash = ? and revoked_at is null",
      )
      .run(revokedAt, tokenHash);
  });
}

export function insertSession(options: {
  connection: DatabaseConnection;
  user: Omit<SessionUser, "capabilities">;
  token: string;
  now: Date;
  clientLabel?: string | null;
}): CreatedSession {
  const createdAt = options.now.toISOString();
  const expiresAt = new Date(
    options.now.getTime() + SESSION_IDLE_MINUTES * 60 * 1_000,
  ).toISOString();
  const absoluteExpiresAt = new Date(
    options.now.getTime() + SESSION_ABSOLUTE_HOURS * 60 * 60 * 1_000,
  ).toISOString();
  const sessionId = ulid(options.now.getTime());

  options.connection.client
    .prepare(
      `insert into sessions
        (id, user_id, token_hash, created_at, last_seen_at, expires_at,
         absolute_expires_at, revoked_at, client_label)
       values (?, ?, ?, ?, ?, ?, ?, null, ?)`,
    )
    .run(
      sessionId,
      options.user.id,
      sessionTokenHash(options.token),
      createdAt,
      createdAt,
      expiresAt,
      absoluteExpiresAt,
      options.clientLabel ?? null,
    );

  return {
    id: sessionId,
    token: options.token,
    absoluteExpiresAt,
    user: {
      ...options.user,
      capabilities: getCapabilitiesForRole(options.user.role),
    },
  };
}

export function resolveSessionToken(options: {
  token: string | undefined;
  connection?: DatabaseConnection;
  now?: Date;
}): AuthenticatedSession | undefined {
  if (!options.token) {
    return undefined;
  }

  const connection = options.connection ?? getDatabase();
  const tokenHash = sessionTokenHash(options.token);
  const row = findSession(connection, tokenHash);

  if (!row || row.revokedAt) {
    return undefined;
  }

  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const expiresAtMs = Date.parse(row.expiresAt);
  const absoluteExpiresAtMs = Date.parse(row.absoluteExpiresAt);
  const lastSeenAtMs = Date.parse(row.lastSeenAt);
  const invalidTimestamps = [expiresAtMs, absoluteExpiresAtMs, lastSeenAtMs].some(Number.isNaN);

  if (
    row.isActive !== 1n ||
    invalidTimestamps ||
    nowMs >= expiresAtMs ||
    nowMs >= absoluteExpiresAtMs
  ) {
    revokeSessionHash(connection, tokenHash, now.toISOString());
    return undefined;
  }

  if (nowMs - lastSeenAtMs >= SESSION_TOUCH_INTERVAL_MS) {
    const nextExpiresAt = new Date(
      Math.min(nowMs + SESSION_IDLE_MINUTES * 60 * 1_000, absoluteExpiresAtMs),
    ).toISOString();

    withImmediateTransaction(connection.client, () => {
      connection.client
        .prepare(
          `update sessions
           set last_seen_at = ?, expires_at = ?
           where token_hash = ? and revoked_at is null and last_seen_at = ?`,
        )
        .run(now.toISOString(), nextExpiresAt, tokenHash, row.lastSeenAt);
    });
  }

  return {
    id: row.sessionId,
    user: toSessionUser(row),
    absoluteExpiresAt: row.absoluteExpiresAt,
  };
}

export function optionalSession(
  request: Request,
  options: { connection?: DatabaseConnection; now?: Date } = {},
): AuthenticatedSession | undefined {
  return resolveSessionToken({
    token: readCookie(request, SESSION_COOKIE_NAME),
    connection: options.connection,
    now: options.now,
  });
}

export function requireSession(
  request: Request,
  options: { connection?: DatabaseConnection; now?: Date } = {},
): AuthenticatedSession {
  const session = optionalSession(request, options);

  if (!session) {
    throw unauthorizedError();
  }

  return session;
}

export function assertCapability(session: AuthenticatedSession, capability: Capability): void {
  if (!roleHasCapability(session.user.role, capability)) {
    throw forbiddenError();
  }
}

export function requireCapability(
  request: Request,
  capability: Capability,
  options: { connection?: DatabaseConnection; now?: Date } = {},
): AuthenticatedSession {
  const session = requireSession(request, options);
  assertCapability(session, capability);
  return session;
}

export function logoutSession(options: {
  token: string | undefined;
  connection?: DatabaseConnection;
  now?: Date;
}): void {
  if (!options.token) {
    return;
  }

  revokeSessionHash(
    options.connection ?? getDatabase(),
    sessionTokenHash(options.token),
    (options.now ?? new Date()).toISOString(),
  );
}
