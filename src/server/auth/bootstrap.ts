import "server-only";

import { ulid } from "ulid";
import { getMessages } from "@/i18n";
import type { BootstrapStatus, SessionUser } from "@/domain/auth/contracts";
import { getCapabilitiesForRole } from "@/domain/auth/capabilities";
import { validateBootstrapAdminInput } from "@/domain/auth/credentials";
import { appendAuditEvent } from "@/server/audit/service";
import { getDatabase, type DatabaseConnection } from "@/server/db/connection";
import { users } from "@/server/db/schema";
import { withImmediateTransaction } from "@/server/db/transaction";
import {
  bootstrapCompleteError,
  bootstrapLocalOnlyError,
  validationError,
} from "@/server/http/errors";
import { hashPassword } from "./password";

function userCount(connection: DatabaseConnection): bigint {
  const result = connection.client.prepare("select count(*) as count from users").get() as {
    count: bigint;
  };
  return result.count;
}

export function getBootstrapStatus(
  connection: DatabaseConnection = getDatabase(),
): BootstrapStatus {
  return { bootstrapRequired: userCount(connection) === 0n };
}

export async function bootstrapFirstAdmin(options: {
  connection?: DatabaseConnection;
  input: unknown;
  isLoopback: boolean;
  requestId: string;
  now?: Date;
}): Promise<SessionUser> {
  if (!options.isLoopback) {
    throw bootstrapLocalOnlyError();
  }

  const connection = options.connection ?? getDatabase();

  if (userCount(connection) !== 0n) {
    throw bootstrapCompleteError();
  }

  const messages = getMessages();
  const validated = validateBootstrapAdminInput(options.input, messages.auth.validation);

  if (!validated.success) {
    throw validationError(validated.fieldErrors);
  }

  const passwordHash = await hashPassword(validated.data.password);
  const createdAt = (options.now ?? new Date()).toISOString();
  const id = ulid();

  withImmediateTransaction(connection.client, () => {
    if (userCount(connection) !== 0n) {
      throw bootstrapCompleteError();
    }

    connection.db
      .insert(users)
      .values({
        id,
        username: validated.data.username,
        displayName: validated.data.displayName,
        role: "ADMIN",
        passwordHash,
        isActive: true,
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt,
        createdBy: null,
        updatedAt: createdAt,
        updatedBy: null,
        rowVersion: 1,
      })
      .run();

    appendAuditEvent(connection, {
      eventType: "ADMIN_BOOTSTRAPPED",
      actorUserId: id,
      actorDisplayName: validated.data.displayName,
      entityType: "USER",
      entityId: id,
      summary: messages.audit.adminBootstrapped,
      changes: { role: "ADMIN" },
      createdAt,
      requestId: options.requestId,
    });
  });

  return {
    id,
    username: validated.data.username,
    displayName: validated.data.displayName,
    role: "ADMIN",
    mustChangePassword: false,
    capabilities: getCapabilitiesForRole("ADMIN"),
  };
}
