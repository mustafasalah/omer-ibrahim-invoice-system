export const SECURE_RANDOM_UNAVAILABLE = "SECURE_RANDOM_UNAVAILABLE" as const;

type SecureRandomSource = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

export class SecureRandomUnavailableError extends Error {
  readonly code = SECURE_RANDOM_UNAVAILABLE;

  constructor() {
    super("A secure random source is unavailable.");
    this.name = "SecureRandomUnavailableError";
  }
}

function runtimeCrypto(): SecureRandomSource | null {
  return typeof globalThis.crypto === "undefined" ? null : globalThis.crypto;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

/**
 * Generates a browser-safe UUID without ever falling back to timestamps or
 * pseudo-random values. Passing a source is intended for deterministic tests.
 */
export function createSecureClientId(source: SecureRandomSource | null = runtimeCrypto()): string {
  if (typeof source?.randomUUID === "function") {
    try {
      return source.randomUUID();
    } catch {
      // getRandomValues remains available in browsers that restrict randomUUID
      // to secure contexts, including supported HTTP LAN deployments.
    }
  }
  if (typeof source?.getRandomValues !== "function") throw new SecureRandomUnavailableError();

  const bytes = source.getRandomValues(new Uint8Array(16));
  if (bytes.byteLength !== 16) throw new SecureRandomUnavailableError();

  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) throw new SecureRandomUnavailableError();
  bytes[6] = (versionByte & 0x0f) | 0x40;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}
