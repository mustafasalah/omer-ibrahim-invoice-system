import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "@/server/logging/logger";

describe("local technical logging", () => {
  it("redacts secrets and complete financial payloads", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createLogger(destination);

    logger.info({
      password: "top-secret-password",
      passwordConfirmation: "top-secret-confirmation",
      passwordHash: "$argon2id$secret-hash",
      token: "raw-session-token",
      invoice: { grandTotalMinor: "100000" },
      amountMinor: "99999",
      safeContext: "health-check",
    });

    expect(output).toContain("[REDACTED]");
    expect(output).toContain("health-check");
    expect(output).not.toContain("top-secret-password");
    expect(output).not.toContain("top-secret-confirmation");
    expect(output).not.toContain("secret-hash");
    expect(output).not.toContain("raw-session-token");
    expect(output).not.toContain("100000");
    expect(output).not.toContain("99999");
  });
});
