import { NextResponse } from "next/server";
import { requireCsrfProtection } from "@/server/auth/csrf";
import { requireCapability } from "@/server/auth/sessions";
import { readJsonBody } from "@/server/http/json";
import { withApiHandler } from "@/server/http/route";
import { getSettings, updateSettings } from "@/server/settings/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiHandler(async ({ request, requestId }) => {
  requireCapability(request, "settings.manage");
  return NextResponse.json({ ...getSettings(), requestId }, { headers: { "cache-control": "no-store" } });
});

export const PATCH = withApiHandler(async ({ request, requestId }) => {
  requireCsrfProtection(request);
  const session = requireCapability(request, "settings.manage");
  const result = updateSettings({
    input: await readJsonBody(request),
    actor: { id: session.user.id, displayName: session.user.displayName },
    requestId,
  });
  return NextResponse.json({ ...result, requestId }, { headers: { "cache-control": "no-store" } });
});
