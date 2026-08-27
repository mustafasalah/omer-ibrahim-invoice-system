import { NextResponse } from "next/server";
import { setSessionCookie } from "@/server/auth/cookies";
import { requireCsrfProtection } from "@/server/auth/csrf";
import { login } from "@/server/auth/login";
import { readJsonBody } from "@/server/http/json";
import { withApiHandler } from "@/server/http/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApiHandler(async ({ request }) => {
  requireCsrfProtection(request);
  const session = await login({
    input: await readJsonBody(request),
    clientLabel: request.headers.get("user-agent"),
  });
  const response = NextResponse.json(
    { user: session.user, redirectTo: "/" },
    { headers: { "cache-control": "no-store" } },
  );
  setSessionCookie(response, request, session.token, session.absoluteExpiresAt);
  return response;
});
