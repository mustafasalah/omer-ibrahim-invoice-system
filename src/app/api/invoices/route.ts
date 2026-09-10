import { NextResponse } from "next/server";
import { requireCsrfProtection } from "@/server/auth/csrf";
import { assertCapability, requireSession } from "@/server/auth/sessions";
import { readInvoiceIntent } from "@/domain/invoices/draft";
import { readJsonBody } from "@/server/http/json";
import { validationError } from "@/server/http/errors";
import { withApiHandler } from "@/server/http/route";
import { createInvoiceDraft, createIssuedInvoice } from "@/server/invoices/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApiHandler(async ({ request, requestId }) => {
  requireCsrfProtection(request);
  const session = requireSession(request);
  const input = await readJsonBody(request);
  const intent = readInvoiceIntent(input);
  if (!intent) throw validationError({ intent: "INVALID_INTENT" });
  assertCapability(session, intent === "ISSUE" ? "invoice.issue" : "invoice.create");
  const result = (intent === "ISSUE" ? createIssuedInvoice : createInvoiceDraft)({
    input,
    actor: { id: session.user.id, displayName: session.user.displayName, role: session.user.role },
    requestId,
  });
  return NextResponse.json({ ...result, requestId }, { status: 201, headers: { "cache-control": "no-store" } });
});
