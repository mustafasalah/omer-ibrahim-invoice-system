import { describe, expect, it } from "vitest";
import { getRequestId } from "@/server/http/request-id";
import { requireIdempotencyKey } from "@/server/http/idempotency";

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
  it("accepts an explicit key within the documented character and length limits", () => {
    expect(requireIdempotencyKey(new Request("http://localhost/api/invoices", {
      headers: { "idempotency-key": "draft-create-key-123" },
    }))).toBe("draft-create-key-123");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", "short"],
    ["too long", `a${"b".repeat(128)}`],
    ["malformed", "draft key contains spaces"],
  ])("rejects a %s key without falling back to the request ID", (_label, key) => {
    const headers = new Headers();
    if (key !== undefined) headers.set("idempotency-key", key);
    expect(() => requireIdempotencyKey(new Request("http://localhost/api/invoices", { headers })))
      .toThrowError(expect.objectContaining({ code: "INVALID_IDEMPOTENCY_KEY", status: 422 }));
  });
});
