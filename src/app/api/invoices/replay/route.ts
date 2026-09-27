import { NextResponse } from "next/server";
import { readInvoiceIntent } from "@/domain/invoices/draft";
import { requireCsrfProtection } from "@/server/auth/csrf";
import { assertCapability, requireSession } from "@/server/auth/sessions";
import { validationError } from "@/server/http/errors";
import { requireIdempotencyKey } from "@/server/http/idempotency";
import { readJsonBody } from "@/server/http/json";
import { withApiHandler } from "@/server/http/route";
import { replayInvoiceDraftCreation } from "@/server/invoices/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApiHandler(async ({ request, requestId }) => {
  requireCsrfProtection(request);
  const session = requireSession(request);
  const input = await readJsonBody(request);
  if (readInvoiceIntent(input) !== "SAVE_DRAFT") throw validationError({ intent: "INVALID_INTENT" });
  assertCapability(session, "invoice.create");
  const result = replayInvoiceDraftCreation({
    input,
    actor: { id: session.user.id },
    idempotencyKey: requireIdempotencyKey(request),
  });
  return NextResponse.json({ ...result, requestId }, { status: 201, headers: { "cache-control": "no-store" } });
});
