type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    fieldErrors?: Record<string, string>;
    requestId?: string;
  };
};

export type ClientApiError = {
  message: string;
  fieldErrors: Record<string, string>;
};

export async function getCsrfToken(): Promise<string> {
  const response = await fetch("/api/auth/csrf", {
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("CSRF_UNAVAILABLE");
  }

  const body = (await response.json()) as { csrfToken?: string };
  if (!body.csrfToken) {
    throw new Error("CSRF_UNAVAILABLE");
  }

  return body.csrfToken;
}

export async function readApiError(response: Response, fallback: string): Promise<ClientApiError> {
  try {
    const body = (await response.json()) as ApiErrorPayload;
    return {
      message: body.error?.message ?? fallback,
      fieldErrors: body.error?.fieldErrors ?? {},
    };
  } catch {
    return { message: fallback, fieldErrors: {} };
  }
}
