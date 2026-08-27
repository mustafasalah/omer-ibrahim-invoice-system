import { NextResponse } from "next/server";
import { bootstrapFirstAdmin } from "@/server/auth/bootstrap";
import { requireCsrfProtection } from "@/server/auth/csrf";
import { isLoopbackBootstrapRequest } from "@/server/auth/network";
import { getConfig } from "@/server/config/env";
import { readJsonBody } from "@/server/http/json";
import { withApiHandler } from "@/server/http/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApiHandler(async ({ request, requestId }) => {
  requireCsrfProtection(request);
  const config = getConfig();
  const admin = await bootstrapFirstAdmin({
    input: await readJsonBody(request),
    isLoopback: isLoopbackBootstrapRequest(request, config.host),
    requestId,
  });

  return NextResponse.json(
    { admin, redirectTo: "/login" },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
});
