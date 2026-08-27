import { describe, expect, it } from "vitest";
import { createCsrfToken, isValidCsrfToken, requireCsrfProtection } from "@/server/auth/csrf";
import { CSRF_COOKIE_NAME } from "@/server/auth/cookies";
import { isLoopbackAddress, isLoopbackBootstrapRequest } from "@/server/auth/network";
import { AppError, apiErrorCodes } from "@/server/http/errors";

function protectedRequest(token: string, overrides: HeadersInit = {}): Request {
  return new Request("http://127.0.0.1:3000/api/auth/login", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
      "x-csrf-token": token,
      ...overrides,
    },
  });
}

describe("CSRF and bootstrap network protection", () => {
  it("accepts only signed double-submit tokens from the exact origin", () => {
    const token = createCsrfToken();
    expect(isValidCsrfToken(token)).toBe(true);
    expect(() => requireCsrfProtection(protectedRequest(token))).not.toThrow();

    for (const request of [
      protectedRequest(token, { origin: "http://example.test" }),
      protectedRequest(token, { "sec-fetch-site": "cross-site" }),
      protectedRequest(`${token}x`),
    ]) {
      try {
        requireCsrfProtection(request);
        throw new Error("Expected CSRF rejection.");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe(apiErrorCodes.CSRF_INVALID);
      }
    }
  });

  it("recognizes loopback addresses and rejects LAN bootstrap requests", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.25.10.3")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.10")).toBe(false);

    expect(isLoopbackBootstrapRequest(protectedRequest("unused"), "127.0.0.1")).toBe(true);
    expect(
      isLoopbackBootstrapRequest(
        protectedRequest("unused", { "x-forwarded-for": "192.168.1.20" }),
        "127.0.0.1",
      ),
    ).toBe(false);
    expect(isLoopbackBootstrapRequest(protectedRequest("unused"), "0.0.0.0")).toBe(false);
  });
});
