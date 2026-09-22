import { describe, expect, it } from "vitest";
import { getRequestId } from "@/server/http/request-id";
import { getIdempotencyKey } from "@/server/http/idempotency";

describe("request IDs", () => {
  it("keeps a safe incoming ID", () => {
    const request = new Request("http://localhost/api/health", {
      headers: { "x-request-id": "client-request_123" },
    });

    expect(getRequestId(request)).toBe("client-request_123");
  });

  it("replaces malformed IDs", () => {
    const request = new Request("http://localhost/api/health", {
      headers: { "x-request-id": "unsafe request id" },
    });

    expect(getRequestId(request)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("idempotency keys", () => {
  it("keeps a stable explicit key and safely falls back to the request ID", () => {
    expect(getIdempotencyKey(new Request("http://localhost/api/invoices", {
      headers: { "idempotency-key": "draft-create-key-123" },
    }), "fallback-request")).toBe("draft-create-key-123");
    expect(getIdempotencyKey(new Request("http://localhost/api/invoices", {
      headers: { "idempotency-key": "short" },
    }), "fallback-request")).toBe("fallback-request");
  });
});
