import "server-only";

const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;

export function getIdempotencyKey(request: Request, fallbackRequestId: string): string {
  const value = request.headers.get("idempotency-key");
  return value && idempotencyKeyPattern.test(value) ? value : fallbackRequestId;
}
