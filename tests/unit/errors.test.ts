import { describe, expect, it } from "vitest";
import { apiErrorCodes, toApiError, validationError } from "@/server/http/errors";

describe("API error contract", () => {
  it("preserves stable validation codes and field errors", () => {
    const result = toApiError(validationError({ amount: "invalid" }), "request-1");

    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      error: {
        code: apiErrorCodes.VALIDATION_ERROR,
        message: expect.any(String),
        fieldErrors: { amount: "invalid" },
        requestId: "request-1",
      },
    });
  });

  it("does not expose unexpected exception details", () => {
    const result = toApiError(
      new Error("SELECT password_hash FROM users at C:\\private\\database.sqlite"),
      "request-2",
    );
    const serialized = JSON.stringify(result.body);

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe(apiErrorCodes.INTERNAL_ERROR);
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("password_hash");
    expect(serialized).not.toContain("database.sqlite");
  });
});
