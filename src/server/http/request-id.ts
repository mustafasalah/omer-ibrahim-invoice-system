import "server-only";

import { randomUUID } from "node:crypto";

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function getRequestId(request: Request): string {
  const incomingRequestId = request.headers.get("x-request-id");
  const idempotencyKey = request.headers.get("idempotency-key");

  if (
    incomingRequestId &&
    requestIdPattern.test(incomingRequestId) &&
    (!idempotencyKey || !incomingRequestId.includes(idempotencyKey))
  ) {
    return incomingRequestId;
  }

  return randomUUID();
}
