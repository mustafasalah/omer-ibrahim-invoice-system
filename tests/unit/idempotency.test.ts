import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  IDEMPOTENCY_RETENTION_DAYS,
  fingerprintIdempotencyRequest,
  hashIdempotencyKey,
  idempotencyExpiry,
} from "@/server/idempotency/service";

describe("invoice idempotency primitives", () => {
  it("hashes keys deterministically with a domain-separated lowercase SHA-256 digest", () => {
    const key = "draft-create-key-123";
    const first = hashIdempotencyKey(key);

    expect(first).toBe(hashIdempotencyKey(key));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain(key);
    expect(first).not.toBe(createHash("sha256").update(key, "utf8").digest("hex"));
    expect(first).not.toBe(fingerprintIdempotencyRequest(key));
    expect(hashIdempotencyKey(`${key}-different`)).not.toBe(first);
  });

  it("canonicalizes object keys while preserving payload and array semantics", () => {
    const original = {
      beneficiary: { name: "Beneficiary", address: "Khartoum" },
      items: [
        { description: "Item A", quantity: "2", unitPrice: "10.00" },
        { description: "Item B", quantity: "1", unitPrice: "5.00" },
      ],
    };
    const reordered = {
      items: [
        { unitPrice: "10.00", quantity: "2", description: "Item A" },
        { quantity: "1", description: "Item B", unitPrice: "5.00" },
      ],
      beneficiary: { address: "Khartoum", name: "Beneficiary" },
    };

    const fingerprint = fingerprintIdempotencyRequest(original);

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintIdempotencyRequest(reordered)).toBe(fingerprint);
    expect(fingerprintIdempotencyRequest({ ...original, beneficiary: {
      ...original.beneficiary,
      name: "Different beneficiary",
    } })).not.toBe(fingerprint);
    expect(fingerprintIdempotencyRequest({
      ...original,
      items: [...original.items].reverse(),
    })).not.toBe(fingerprint);
  });

  it("expires replay records exactly seven days after creation", () => {
    const createdAt = new Date("2028-02-27T23:59:59.123Z");
    const expectedExpiry = new Date(
      createdAt.getTime() + (7 * 24 * 60 * 60 * 1_000),
    ).toISOString();

    expect(IDEMPOTENCY_RETENTION_DAYS).toBe(7);
    expect(idempotencyExpiry(createdAt)).toBe(expectedExpiry);
    expect(idempotencyExpiry(createdAt)).toBe("2028-03-05T23:59:59.123Z");
  });
});
