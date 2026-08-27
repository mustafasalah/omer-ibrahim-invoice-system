import { NextResponse } from "next/server";
import { getBootstrapStatus } from "@/server/auth/bootstrap";
import { withApiHandler } from "@/server/http/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiHandler(async () =>
  NextResponse.json(getBootstrapStatus(), {
    headers: { "cache-control": "no-store" },
  }),
);
