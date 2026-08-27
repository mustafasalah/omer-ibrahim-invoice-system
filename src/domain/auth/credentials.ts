import { z } from "zod";
import type { BootstrapAdminInput, LoginInput } from "./contracts";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 64;
export const DISPLAY_NAME_MAX_LENGTH = 100;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const usernamePattern = /^[\p{L}\p{N}._-]+$/u;

const veryCommonPasswords = new Set([
  "1234567890",
  "admin12345",
  "adminadmin",
  "letmein123",
  "password",
  "password1",
  "password123",
  "qwerty12345",
  "welcome123",
  "كلمةالمرور",
]);

const bootstrapInputSchema = z
  .object({
    username: z.string(),
    displayName: z.string(),
    password: z.string(),
    passwordConfirmation: z.string(),
  })
  .strict();

const loginInputSchema = z
  .object({
    username: z.string(),
    password: z.string(),
  })
  .strict();

export type CredentialValidationMessages = {
  invalidRequest: string;
  usernameRequired: string;
  usernameLength: string;
  usernameCharacters: string;
  displayNameRequired: string;
  displayNameLength: string;
  passwordLength: string;
  passwordCommon: string;
  passwordMatchesUsername: string;
  passwordConfirmation: string;
};

export type ValidatedBootstrapAdmin = Omit<BootstrapAdminInput, "passwordConfirmation">;

function characterLength(value: string): number {
  return Array.from(value).length;
}

function lowerLatin(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function normalizeUsername(value: string): string {
  return lowerLatin(value.normalize("NFKC").trim());
}

function normalizePasswordComparison(value: string): string {
  return lowerLatin(value.normalize("NFKC").trim());
}

export function validateBootstrapAdminInput(
  input: unknown,
  messages: CredentialValidationMessages,
): { success: true; data: ValidatedBootstrapAdmin } | { success: false; fieldErrors: Record<string, string> } {
  const parsed = bootstrapInputSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, fieldErrors: { request: messages.invalidRequest } };
  }

  const username = normalizeUsername(parsed.data.username);
  const displayName = parsed.data.displayName.normalize("NFKC").trim();
  const passwordLength = characterLength(parsed.data.password);
  const fieldErrors: Record<string, string> = {};

  if (!username) {
    fieldErrors.username = messages.usernameRequired;
  } else if (
    characterLength(username) < USERNAME_MIN_LENGTH ||
    characterLength(username) > USERNAME_MAX_LENGTH
  ) {
    fieldErrors.username = messages.usernameLength;
  } else if (!usernamePattern.test(username)) {
    fieldErrors.username = messages.usernameCharacters;
  }

  if (!displayName) {
    fieldErrors.displayName = messages.displayNameRequired;
  } else if (characterLength(displayName) > DISPLAY_NAME_MAX_LENGTH) {
    fieldErrors.displayName = messages.displayNameLength;
  }

  if (passwordLength < PASSWORD_MIN_LENGTH || passwordLength > PASSWORD_MAX_LENGTH) {
    fieldErrors.password = messages.passwordLength;
  } else {
    const comparablePassword = normalizePasswordComparison(parsed.data.password);

    if (veryCommonPasswords.has(comparablePassword)) {
      fieldErrors.password = messages.passwordCommon;
    } else if (comparablePassword === username) {
      fieldErrors.password = messages.passwordMatchesUsername;
    }
  }

  if (parsed.data.password !== parsed.data.passwordConfirmation) {
    fieldErrors.passwordConfirmation = messages.passwordConfirmation;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }

  return {
    success: true,
    data: {
      username,
      displayName,
      password: parsed.data.password,
    },
  };
}

export function parseLoginInput(input: unknown): LoginInput | undefined {
  const parsed = loginInputSchema.safeParse(input);

  if (!parsed.success) {
    return undefined;
  }

  return {
    username: normalizeUsername(parsed.data.username),
    password: parsed.data.password,
  };
}

export function isPasswordLengthAllowed(password: string): boolean {
  const length = characterLength(password);
  return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH;
}
