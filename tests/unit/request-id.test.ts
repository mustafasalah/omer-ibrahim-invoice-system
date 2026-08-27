import { describe, expect, it } from "vitest";
import { getRequestId } from "@/server/http/request-id";

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
