import { NextResponse } from "next/server";
import { createCsrfToken } from "@/server/auth/csrf";
import { setCsrfCookie } from "@/server/auth/cookies";
import { withApiHandler } from "@/server/http/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiHandler(async ({ request, requestId }) => {
  const csrfToken = createCsrfToken();
  const response = NextResponse.json(
    { csrfToken, requestId },
    { headers: { "cache-control": "no-store" } },
  );
  setCsrfCookie(response, request, csrfToken);
  return response;
});
