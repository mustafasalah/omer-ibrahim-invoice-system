import { NextResponse } from "next/server";
import { deleteSessionCookie, readCookie, SESSION_COOKIE_NAME } from "@/server/auth/cookies";
import { requireCsrfProtection } from "@/server/auth/csrf";
import { logoutSession } from "@/server/auth/sessions";
import { withApiHandler } from "@/server/http/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApiHandler(async ({ request }) => {
  requireCsrfProtection(request);
  logoutSession({ token: readCookie(request, SESSION_COOKIE_NAME) });
  const response = NextResponse.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
  deleteSessionCookie(response, request);
  return response;
});
