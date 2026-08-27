import "server-only";

import { NextResponse } from "next/server";
import { deleteSessionCookie } from "@/server/auth/cookies";
import { getLogger } from "@/server/logging/logger";
import { toApiError } from "./errors";
import { getRequestId } from "./request-id";

export type ApiHandler = (context: { request: Request; requestId: string }) => Promise<Response>;

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set("x-request-id", requestId);
  return response;
}

export function withApiHandler(handler: ApiHandler): (request: Request) => Promise<Response> {
  return async function apiRoute(request: Request): Promise<Response> {
    const requestId = getRequestId(request);

    try {
      return withRequestId(await handler({ request, requestId }), requestId);
    } catch (error) {
      const { body, status, headers } = toApiError(error, requestId);
      try {
        getLogger().error(
          {
            errorCode: body.error.code,
            status,
            requestId,
            method: request.method,
            pathname: new URL(request.url).pathname,
          },
          "API request failed",
        );
      } catch {
        // Logging must never replace the stable, redacted API error response.
      }
      const response = NextResponse.json(body, { status, headers });
      if (status === 401) {
        deleteSessionCookie(response, request);
      }
      return withRequestId(response, requestId);
    }
  };
}
