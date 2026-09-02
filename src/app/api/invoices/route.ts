import { NextResponse } from "next/server";
import { requireCsrfProtection } from "@/server/auth/csrf";
import { requireCapability } from "@/server/auth/sessions";
import { readJsonBody } from "@/server/http/json";
import { withApiHandler } from "@/server/http/route";
import { createInvoiceDraft } from "@/server/invoices/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApiHandler(async ({ request, requestId }) => {
  requireCsrfProtection(request);
  const session = requireCapability(request, "invoice.create");
  const result = createInvoiceDraft({
    input: await readJsonBody(request),
    actor: { id: session.user.id, displayName: session.user.displayName, role: session.user.role },
    requestId,
  });
  return NextResponse.json({ ...result, requestId }, { status: 201, headers: { "cache-control": "no-store" } });
});
