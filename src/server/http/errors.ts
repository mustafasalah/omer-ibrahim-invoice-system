import "server-only";

import { getMessages } from "@/i18n";

export const apiErrorCodes = {
  CONFLICT: "CONFLICT",
  DATABASE_BUSY: "DATABASE_BUSY",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  VALIDATION_ERROR: "VALIDATION_ERROR",
} as const;

export type ApiErrorCode = (typeof apiErrorCodes)[keyof typeof apiErrorCodes];

export type ApiError = {
  error: {
    code: ApiErrorCode;
    message: string;
    fieldErrors?: Record<string, string>;
    requestId: string;
  };
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(options: {
    code: ApiErrorCode;
    message: string;
    status: number;
    fieldErrors?: Record<string, string>;
  }) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status;
    this.fieldErrors = options.fieldErrors;
  }
}

export function validationError(fieldErrors?: Record<string, string>): AppError {
  return new AppError({
    code: apiErrorCodes.VALIDATION_ERROR,
    message: getMessages().errors.validation,
    status: 422,
    fieldErrors,
  });
}

export function conflictError(): AppError {
  return new AppError({
    code: apiErrorCodes.CONFLICT,
    message: getMessages().errors.conflict,
    status: 409,
  });
}

export function databaseBusyError(): AppError {
  return new AppError({
    code: apiErrorCodes.DATABASE_BUSY,
    message: getMessages().errors.databaseBusy,
    status: 503,
  });
}

export function serviceUnavailableError(): AppError {
  return new AppError({
    code: apiErrorCodes.SERVICE_UNAVAILABLE,
    message: getMessages().errors.serviceUnavailable,
    status: 503,
  });
}

export function toApiError(error: unknown, requestId: string): { body: ApiError; status: number } {
  const safeError =
    error instanceof AppError
      ? error
      : new AppError({
          code: apiErrorCodes.INTERNAL_ERROR,
          message: getMessages().errors.internal,
          status: 500,
        });

  return {
    status: safeError.status,
    body: {
      error: {
        code: safeError.code,
        message: safeError.message,
        ...(safeError.fieldErrors ? { fieldErrors: safeError.fieldErrors } : {}),
        requestId,
      },
    },
  };
}
