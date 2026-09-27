import "server-only";

import { getMessages } from "@/i18n";

export const apiErrorCodes = {
  BOOTSTRAP_COMPLETE: "BOOTSTRAP_COMPLETE",
  BOOTSTRAP_LOCAL_ONLY: "BOOTSTRAP_LOCAL_ONLY",
  CONFLICT: "CONFLICT",
  CSRF_INVALID: "CSRF_INVALID",
  DATABASE_BUSY: "DATABASE_BUSY",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INVALID_IDEMPOTENCY_KEY: "INVALID_IDEMPOTENCY_KEY",
  IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
  IDEMPOTENCY_REPLAY_UNAVAILABLE: "IDEMPOTENCY_REPLAY_UNAVAILABLE",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  LOGIN_RATE_LIMITED: "LOGIN_RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  UNAUTHORIZED: "UNAUTHORIZED",
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
  readonly headers?: HeadersInit;

  constructor(options: {
    code: ApiErrorCode;
    message: string;
    status: number;
    fieldErrors?: Record<string, string>;
    headers?: HeadersInit;
  }) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status;
    this.fieldErrors = options.fieldErrors;
    this.headers = options.headers;
  }
}

export function bootstrapCompleteError(): AppError {
  return new AppError({
    code: apiErrorCodes.BOOTSTRAP_COMPLETE,
    message: getMessages().errors.bootstrapComplete,
    status: 409,
  });
}

export function bootstrapLocalOnlyError(): AppError {
  return new AppError({
    code: apiErrorCodes.BOOTSTRAP_LOCAL_ONLY,
    message: getMessages().errors.bootstrapLocalOnly,
    status: 403,
  });
}

export function csrfError(): AppError {
  return new AppError({
    code: apiErrorCodes.CSRF_INVALID,
    message: getMessages().errors.csrf,
    status: 403,
  });
}

export function unauthorizedError(): AppError {
  return new AppError({
    code: apiErrorCodes.UNAUTHORIZED,
    message: getMessages().errors.unauthorized,
    status: 401,
  });
}

export function forbiddenError(): AppError {
  return new AppError({
    code: apiErrorCodes.FORBIDDEN,
    message: getMessages().errors.forbidden,
    status: 403,
  });
}

export function invalidCredentialsError(): AppError {
  return new AppError({
    code: apiErrorCodes.INVALID_CREDENTIALS,
    message: getMessages().errors.invalidCredentials,
    status: 401,
  });
}

export function loginRateLimitedError(retryAfterSeconds: number): AppError {
  return new AppError({
    code: apiErrorCodes.LOGIN_RATE_LIMITED,
    message: getMessages().errors.loginRateLimited,
    status: 429,
    headers: { "retry-after": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}

export function validationError(fieldErrors?: Record<string, string>): AppError {
  return new AppError({
    code: apiErrorCodes.VALIDATION_ERROR,
    message: getMessages().errors.validation,
    status: 422,
    fieldErrors,
  });
}

export function invalidIdempotencyKeyError(): AppError {
  return new AppError({
    code: apiErrorCodes.INVALID_IDEMPOTENCY_KEY,
    message: getMessages().errors.invalidIdempotencyKey,
    status: 422,
    fieldErrors: { idempotencyKey: "INVALID_IDEMPOTENCY_KEY" },
  });
}

export function idempotencyKeyReusedError(): AppError {
  return new AppError({
    code: apiErrorCodes.IDEMPOTENCY_KEY_REUSED,
    message: getMessages().errors.idempotencyKeyReused,
    status: 409,
    fieldErrors: { idempotencyKey: "IDEMPOTENCY_KEY_REUSED" },
  });
}

export function idempotencyReplayUnavailableError(): AppError {
  return new AppError({
    code: apiErrorCodes.IDEMPOTENCY_REPLAY_UNAVAILABLE,
    message: getMessages().errors.idempotencyReplayUnavailable,
    status: 409,
    fieldErrors: { idempotencyKey: "IDEMPOTENCY_REPLAY_UNAVAILABLE" },
  });
}

export function conflictError(fieldErrors?: Record<string, string>): AppError {
  return new AppError({
    code: apiErrorCodes.CONFLICT,
    message: getMessages().errors.conflict,
    status: 409,
    fieldErrors,
  });
}

export function notFoundError(): AppError {
  return new AppError({
    code: apiErrorCodes.NOT_FOUND,
    message: getMessages().errors.notFound,
    status: 404,
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

export function toApiError(
  error: unknown,
  requestId: string,
): { body: ApiError; status: number; headers?: HeadersInit } {
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
    ...(safeError.headers ? { headers: safeError.headers } : {}),
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
