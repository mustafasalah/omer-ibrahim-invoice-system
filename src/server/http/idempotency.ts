import "server-only";

import { invalidIdempotencyKeyError } from "./errors";

export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;

export function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (!value || !idempotencyKeyPattern.test(value)) throw invalidIdempotencyKeyError();
  return value;
}
