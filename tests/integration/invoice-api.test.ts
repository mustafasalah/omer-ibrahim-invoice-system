import { afterEach, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST } from "@/app/api/invoices/route";
import { GET, PATCH } from "@/app/api/invoices/[id]/route";
import { createSessionToken, insertSession } from "@/server/auth/sessions";
import { apiErrorCodes } from "@/server/http/errors";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;
afterEach(() => { globalThis.__oimsDatabaseConnection = undefined; temporary?.dispose(); temporary = undefined; });

function cookiePair(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("Missing cookie.");
  return cookie.split(";")[0] ?? "";
}

async function csrf() {
  const response = await getCsrf(new Request("http://127.0.0.1:3000/api/auth/csrf", {
    headers: { host: "127.0.0.1:3000" },
  }));
  return { token: (await response.clone().json() as { csrfToken: string }).csrfToken, cookie: cookiePair(response) };
}

function request(url: string, method: "POST" | "PATCH", body: unknown, authCookie: string, token: string, csrfCookie: string) {
  return new Request(url, { method, headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000",
    "sec-fetch-site": "same-origin", "content-type": "application/json", cookie: `${authCookie}; ${csrfCookie}`,
    "x-csrf-token": token, "x-request-id": "invoice-api-test" }, body: JSON.stringify(body) });
}

describe("invoice draft API", () => {
  it("enforces authentication, CSRF, strict server-owned fields, and the save-draft intent", async () => {
    temporary = createTemporaryDatabase(); globalThis.__oimsDatabaseConnection = temporary.connection;
    const unauthenticated = await POST(new Request("http://127.0.0.1:3000/api/invoices", { method: "POST",
      headers: { "content-type": "application/json" }, body: "{}" }));
    expect(unauthenticated.status).toBe(403);
    const admin = await createTestAdmin(temporary.connection);
    const token = createSessionToken(); insertSession({ connection: temporary.connection, user: admin, token, now: new Date() });
    const authCookie = `oims_session=${token}`;
    const missingCsrf = await POST(new Request("http://127.0.0.1:3000/api/invoices", { method: "POST",
      headers: { cookie: authCookie, "content-type": "application/json" }, body: JSON.stringify({ intent: "SAVE_DRAFT", invoice: {} }) }));
    expect(missingCsrf.status).toBe(403);
    const csrfData = await csrf();
    for (const body of [{ intent: "ISSUE", invoice: {} },
      { intent: "SAVE_DRAFT", invoice: { grandTotalMinor: "999" } },
      { intent: "SAVE_DRAFT", invoice: { invoiceStatus: "ISSUED" } }]) {
      const response = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", body, authCookie, csrfData.token, csrfData.cookie));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: apiErrorCodes.VALIDATION_ERROR,
        requestId: "invoice-api-test" } });
    }
    expect((temporary.connection.client.prepare("select count(*) as count from invoice_sequences").get() as { count: bigint }).count).toBe(0n);
  });

  it("creates, reads, and patches a draft without exposing persistence internals", async () => {
    temporary = createTemporaryDatabase(); globalThis.__oimsDatabaseConnection = temporary.connection;
    const admin = await createTestAdmin(temporary.connection); const token = createSessionToken();
    insertSession({ connection: temporary.connection, user: admin, token, now: new Date() });
    const authCookie = `oims_session=${token}`; const csrfData = await csrf();
    const createdResponse = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", {
      intent: "SAVE_DRAFT", invoice: { beneficiary: { name: "عميل" },
        items: [{ clientKey: "one", productName: "منتج", quantity: "2", unitPrice: "5" }] },
    }, authCookie, csrfData.token, csrfData.cookie));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { invoice: { id: string; rowVersion: number }; requestId: string };
    expect(created.requestId).toBe("invoice-api-test");
    const fetchedResponse = await GET(new Request(`http://127.0.0.1:3000/api/invoices/${created.invoice.id}`, {
      headers: { cookie: authCookie, "x-request-id": "invoice-get" },
    }));
    expect(fetchedResponse.status).toBe(200);
    const serialized = JSON.stringify(await fetchedResponse.json());
    expect(serialized).not.toMatch(/normalizedName|changesJson|sequenceKey|updatedByName/iu);
    const patchedResponse = await PATCH(request(`http://127.0.0.1:3000/api/invoices/${created.invoice.id}`, "PATCH", {
      rowVersion: created.invoice.rowVersion, invoice: { notes: "معدلة", items: [] },
    }, authCookie, csrfData.token, csrfData.cookie));
    expect(patchedResponse.status).toBe(200);
    await expect(patchedResponse.json()).resolves.toMatchObject({ invoice: { notes: "معدلة", rowVersion: 2, items: [] } });
    const stale = await PATCH(request(`http://127.0.0.1:3000/api/invoices/${created.invoice.id}`, "PATCH", {
      rowVersion: 1, invoice: { items: [] },
    }, authCookie, csrfData.token, csrfData.cookie));
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: apiErrorCodes.CONFLICT,
      fieldErrors: { rowVersion: "2" } } });
  });

  it("returns 401 for protected reads without a valid session and safe 404/422 errors", async () => {
    temporary = createTemporaryDatabase(); globalThis.__oimsDatabaseConnection = temporary.connection;
    const noSession = await GET(new Request("http://127.0.0.1:3000/api/invoices/01K00000000000000000000000"));
    expect(noSession.status).toBe(401);
    await expect(noSession.json()).resolves.toMatchObject({ error: { code: apiErrorCodes.UNAUTHORIZED } });
    const admin = await createTestAdmin(temporary.connection); const token = createSessionToken();
    insertSession({ connection: temporary.connection, user: admin, token, now: new Date() });
    const missing = await GET(new Request("http://127.0.0.1:3000/api/invoices/01K00000000000000000000000", {
      headers: { cookie: `oims_session=${token}` },
    }));
    expect(missing.status).toBe(404);
    const malformed = await GET(new Request("http://127.0.0.1:3000/api/invoices/not-an-id", {
      headers: { cookie: `oims_session=${token}` },
    }));
    expect(malformed.status).toBe(422);
    expect(JSON.stringify(await malformed.json())).not.toMatch(/sqlite|select|\\|service\.ts/iu);
  });
});
