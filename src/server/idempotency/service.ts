import "server-only";

import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type { DatabaseConnection } from "@/server/db/connection";

export const INVOICE_IDEMPOTENCY_OPERATION = "SAVE_DRAFT" as const;
export const IDEMPOTENCY_RETENTION_DAYS = 7;
export const IDEMPOTENCY_CLEANUP_BATCH_SIZE = 25;

const RETENTION_MILLISECONDS = IDEMPOTENCY_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
const KEY_HASH_DOMAIN = "oims:invoice:SAVE_DRAFT:key:v1\0";
const REQUEST_FINGERPRINT_DOMAIN = "oims:invoice:SAVE_DRAFT:request:v1\0";

export type InvoiceIdempotencyRecord = {
  id: string;
  requestFingerprint: string;
  responseStatus: bigint;
  responseJson: string;
  expiresAt: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("Idempotency payload is not JSON serializable.");
}

export function hashIdempotencyKey(key: string): string {
  return sha256(`${KEY_HASH_DOMAIN}${key}`);
}

export function fingerprintIdempotencyRequest(payload: unknown): string {
  return sha256(`${REQUEST_FINGERPRINT_DOMAIN}${canonicalJson(payload)}`);
}

export function idempotencyExpiry(createdAt: Date): string {
  return new Date(createdAt.getTime() + RETENTION_MILLISECONDS).toISOString();
}

export function findInvoiceIdempotencyRecord(options: {
  connection: DatabaseConnection;
  userId: string;
  keyHash: string;
}): InvoiceIdempotencyRecord | null {
  const record = options.connection.client.prepare(`select id,request_fingerprint as requestFingerprint,
    response_status as responseStatus,response_json as responseJson,expires_at as expiresAt
    from invoice_idempotency_records where user_id=? and operation=? and key_hash=?`)
    .get(options.userId, INVOICE_IDEMPOTENCY_OPERATION, options.keyHash) as InvoiceIdempotencyRecord | undefined;
  return record ?? null;
}

export function deleteInvoiceIdempotencyRecord(
  connection: DatabaseConnection,
  id: string,
): void {
  connection.client.prepare("delete from invoice_idempotency_records where id=?").run(id);
}

/**
 * Replay records live for seven days. Each draft-create transaction removes at most
 * one small indexed batch so cleanup remains local and cannot hold the write lock for
 * an unbounded table scan.
 */
export function cleanupExpiredIdempotencyRecords(
  connection: DatabaseConnection,
  now: string,
  limit = IDEMPOTENCY_CLEANUP_BATCH_SIZE,
): number {
  const deleted = connection.client.prepare(`delete from invoice_idempotency_records where id in (
    select id from invoice_idempotency_records where expires_at<=? order by expires_at,id limit ?
  )`).run(now, limit);
  return deleted.changes;
}

export function insertInvoiceIdempotencyRecord(options: {
  connection: DatabaseConnection;
  userId: string;
  keyHash: string;
  requestFingerprint: string;
  responseStatus: number;
  responseJson: string;
  createdAt: Date;
}): void {
  const createdAt = options.createdAt.toISOString();
  options.connection.client.prepare(`insert into invoice_idempotency_records
    (id,user_id,operation,key_hash,request_fingerprint,response_status,response_json,created_at,expires_at)
    values (?,?,?,?,?,?,?,?,?)`).run(
      ulid(), options.userId, INVOICE_IDEMPOTENCY_OPERATION, options.keyHash,
      options.requestFingerprint, options.responseStatus, options.responseJson,
      createdAt, idempotencyExpiry(options.createdAt),
    );
}
