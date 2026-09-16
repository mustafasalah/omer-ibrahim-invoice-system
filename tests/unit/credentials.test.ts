import { describe, expect, it } from "vitest";
import { getMessages } from "@/i18n";
import {
  normalizeUsername,
  PASSWORD_MAX_LENGTH,
  validateBootstrapAdminInput,
} from "@/domain/auth/credentials";

const messages = getMessages().auth.validation;

function validInput(overrides: Record<string, string> = {}) {
  return {
    username: "Admin.Local",
    displayName: "مدير النظام",
    password: "عبارة مرور قوية 2026",
    passwordConfirmation: "عبارة مرور قوية 2026",
    ...overrides,
  };
}

describe("authentication credentials", () => {
  it("normalizes usernames and folds Latin casing", () => {
    expect(normalizeUsername("  ＡdMin.Local  ")).toBe("admin.local");
    expect(normalizeUsername("  ÉQUIPE.Admin  ")).toBe("équipe.admin");
    expect(normalizeUsername("équipe.admin")).toBe(normalizeUsername("ÉQUIPE.ADMIN"));
  });

  it("preserves password spaces exactly", () => {
    const password = "  local passphrase  ";
    const result = validateBootstrapAdminInput(
      validInput({ password, passwordConfirmation: password }),
      messages,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.password).toBe(password);
    }
  });

  it("enforces length, common-password, username-match, and confirmation rules", () => {
    const short = validateBootstrapAdminInput(
      validInput({ password: "short", passwordConfirmation: "short" }),
      messages,
    );
    const common = validateBootstrapAdminInput(
      validInput({ password: "password123", passwordConfirmation: "password123" }),
      messages,
    );
    const matching = validateBootstrapAdminInput(
      validInput({
        username: "administrator",
        password: "ADMINISTRATOR",
        passwordConfirmation: "ADMINISTRATOR",
      }),
      messages,
    );
    const unicodeLatinMatching = validateBootstrapAdminInput(
      validInput({
        username: "ÉclairAdmin",
        password: "éclairadmin",
        passwordConfirmation: "éclairadmin",
      }),
      messages,
    );
    const mismatch = validateBootstrapAdminInput(
      validInput({ passwordConfirmation: "different password" }),
      messages,
    );
    const tooLong = "ص".repeat(PASSWORD_MAX_LENGTH + 1);
    const overLimit = validateBootstrapAdminInput(
      validInput({ password: tooLong, passwordConfirmation: tooLong }),
      messages,
    );

    expect(short).toMatchObject({ success: false, fieldErrors: { password: expect.any(String) } });
    expect(common).toMatchObject({ success: false, fieldErrors: { password: expect.any(String) } });
    expect(matching).toMatchObject({ success: false, fieldErrors: { password: expect.any(String) } });
    expect(unicodeLatinMatching).toMatchObject({
      success: false,
      fieldErrors: { password: expect.any(String) },
    });
    expect(mismatch).toMatchObject({
      success: false,
      fieldErrors: { passwordConfirmation: expect.any(String) },
    });
    expect(overLimit).toMatchObject({ success: false, fieldErrors: { password: expect.any(String) } });
  });

  it("requires a display name and accepts the exact 128-character password boundary", () => {
    const password = "س".repeat(PASSWORD_MAX_LENGTH);
    const missingName = validateBootstrapAdminInput(validInput({ displayName: "   " }), messages);
    const boundary = validateBootstrapAdminInput(
      validInput({ password, passwordConfirmation: password }),
      messages,
    );

    expect(missingName).toMatchObject({
      success: false,
      fieldErrors: { displayName: expect.any(String) },
    });
    expect(boundary.success).toBe(true);
  });
});
