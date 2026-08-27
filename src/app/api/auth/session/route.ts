import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/sessions";
import { withApiHandler } from "@/server/http/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiHandler(async ({ request }) => {
  const session = requireSession(request);
  return NextResponse.json(
    { user: session.user },
    { headers: { "cache-control": "no-store" } },
  );
});
