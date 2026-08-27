import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("Argon2id passwords", () => {
  it("stores an Argon2id digest and preserves significant spaces", async () => {
    const password = "  passphrase with spaces  ";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain(password);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, password.trim())).resolves.toBe(false);
  });

  it("performs a safe dummy verification for a missing account", async () => {
    await expect(verifyPassword(undefined, "unknown password")).resolves.toBe(false);
  });
});
