import { NextResponse } from "next/server";
import { checkDatabase, getDatabase } from "@/server/db/connection";
import { serviceUnavailableError } from "@/server/http/errors";
import { withApiHandler } from "@/server/http/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiHandler(async ({ requestId }) => {
  try {
    const database = checkDatabase(getDatabase());

    return NextResponse.json(
      {
        status: "ok",
        checks: {
          database: database.quickCheck,
          schemaVersion: database.schemaVersion,
        },
        requestId,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch {
    throw serviceUnavailableError();
  }
});
