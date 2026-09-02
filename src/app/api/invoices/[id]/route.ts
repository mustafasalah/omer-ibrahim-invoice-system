import { NextResponse } from "next/server";
import { requireCsrfProtection } from "@/server/auth/csrf";
import { requireCapability } from "@/server/auth/sessions";
import { readJsonBody } from "@/server/http/json";
import { validationError } from "@/server/http/errors";
import { withApiHandler } from "@/server/http/route";
import { getInvoiceDraft, updateInvoiceDraft } from "@/server/invoices/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function invoiceId(request: Request): string {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "");
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(id)) throw validationError({ id: "INVALID_INVOICE_ID" });
  return id;
}

export const GET = withApiHandler(async ({ request, requestId }) => {
  requireCapability(request, "invoice.read");
  return NextResponse.json({ invoice: getInvoiceDraft(invoiceId(request)), requestId },
    { headers: { "cache-control": "no-store" } });
});

export const PATCH = withApiHandler(async ({ request, requestId }) => {
  requireCsrfProtection(request);
  const session = requireCapability(request, "invoice.edit_draft");
  const result = updateInvoiceDraft({ id: invoiceId(request), input: await readJsonBody(request),
    actor: { id: session.user.id, displayName: session.user.displayName, role: session.user.role }, requestId });
  return NextResponse.json({ ...result, requestId }, { headers: { "cache-control": "no-store" } });
});
