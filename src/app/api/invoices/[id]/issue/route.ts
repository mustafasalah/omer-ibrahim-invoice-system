import { NextResponse } from "next/server";
import { requireCsrfProtection } from "@/server/auth/csrf";
import { requireCapability } from "@/server/auth/sessions";
import { validationError } from "@/server/http/errors";
import { readJsonBody } from "@/server/http/json";
import { withApiHandler } from "@/server/http/route";
import { issueInvoiceDraft } from "@/server/invoices/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function invoiceId(request: Request): string {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const id = decodeURIComponent(segments.at(-2) ?? "");
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(id)) throw validationError({ id: "INVALID_INVOICE_ID" });
  return id;
}

export const POST = withApiHandler(async ({ request, requestId }) => {
  requireCsrfProtection(request);
  const session = requireCapability(request, "invoice.issue");
  const result = issueInvoiceDraft({
    id: invoiceId(request),
    input: await readJsonBody(request),
    actor: { id: session.user.id, displayName: session.user.displayName, role: session.user.role },
    requestId,
  });
  return NextResponse.json({ ...result, requestId }, { headers: { "cache-control": "no-store" } });
});
