import { describe, expect, it, vi } from "vitest";
import {
  createSecureClientId,
  SECURE_RANDOM_UNAVAILABLE,
  SecureRandomUnavailableError,
} from "@/components/invoices/secure-client-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("secure client identifiers", () => {
  it("prefers crypto.randomUUID when it is available", () => {
    const expected = "a78c35e4-9bbc-4ac8-bb30-66e68c00ed02";
    const randomUUID = vi.fn(() => expected);
    const getRandomValues = vi.fn(() => {
      throw new Error("fallback must not run");
    });

    expect(createSecureClientId({ randomUUID, getRandomValues })).toBe(expected);
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("uses getRandomValues to produce unique RFC 4122 version 4 UUIDs", () => {
    let sequence = 0;
    const source = {
      getRandomValues(bytes: Uint8Array) {
        sequence += 1;
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = (sequence * 31 + index * 17) & 0xff;
        }
        bytes[12] = (sequence >>> 24) & 0xff;
        bytes[13] = (sequence >>> 16) & 0xff;
        bytes[14] = (sequence >>> 8) & 0xff;
        bytes[15] = sequence & 0xff;
        return bytes;
      },
    };

    const identifiers = Array.from({ length: 256 }, () => createSecureClientId(source));
    expect(new Set(identifiers)).toHaveLength(identifiers.length);
    expect(identifiers.every((identifier) => UUID_V4.test(identifier))).toBe(true);
  });

  it("falls back to getRandomValues when randomUUID exists but is unavailable", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0x2a);
      return bytes;
    });

    const identifier = createSecureClientId({
      randomUUID: () => { throw new DOMException("Secure context required", "NotAllowedError"); },
      getRandomValues,
    });

    expect(identifier).toMatch(UUID_V4);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("fails closed when neither secure random API is available", () => {
    expect(() => createSecureClientId(null)).toThrowError(SecureRandomUnavailableError);
    try {
      createSecureClientId({});
      throw new Error("expected secure identifier generation to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: SECURE_RANDOM_UNAVAILABLE });
    }
  });
});
