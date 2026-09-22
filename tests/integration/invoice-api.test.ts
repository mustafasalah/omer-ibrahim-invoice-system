import { afterEach, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST } from "@/app/api/invoices/route";
import { GET, PATCH } from "@/app/api/invoices/[id]/route";
import { POST as ISSUE } from "@/app/api/invoices/[id]/issue/route";
import type { DraftResult } from "@/domain/invoices/draft";
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

function request(url: string, method: "POST" | "PATCH", body: unknown, authCookie: string, token: string,
  csrfCookie: string, requestId = "invoice-api-test", idempotencyKey: string | null = "invoice-api-test-key") {
  const headers = new Headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000",
    "sec-fetch-site": "same-origin", "content-type": "application/json", cookie: `${authCookie}; ${csrfCookie}`,
    "x-csrf-token": token, "x-request-id": requestId });
  if (idempotencyKey !== null) headers.set("idempotency-key", idempotencyKey);
  return new Request(url, { method, headers,
  body: JSON.stringify(body) });
}

describe("invoice draft API", () => {
  it("enforces authentication, CSRF, lifecycle-field ownership, and the save-draft intent", async () => {
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
      { intent: "SAVE_DRAFT", invoice: { invoiceNumber: "forged" } },
      { intent: "SAVE_DRAFT", invoice: { invoiceStatus: "ISSUED" } },
      { intent: "SAVE_DRAFT", invoice: { rowVersion: 99 } },
      { intent: "SAVE_DRAFT", invoice: { unknownField: true } },
      { intent: "SAVE_DRAFT", invoice: { items: [{ sortOrder: 99 }] } }]) {
      const response = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", body, authCookie, csrfData.token, csrfData.cookie));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: apiErrorCodes.VALIDATION_ERROR,
        requestId: "invoice-api-test" } });
    }
    expect((temporary.connection.client.prepare("select count(*) as count from invoice_sequences").get() as { count: bigint }).count).toBe(0n);
  });

  it("requires a valid Idempotency-Key for SAVE_DRAFT without reserving data for invalid keys", async () => {
    temporary = createTemporaryDatabase(); globalThis.__oimsDatabaseConnection = temporary.connection;
    const admin = await createTestAdmin(temporary.connection); const token = createSessionToken();
    insertSession({ connection: temporary.connection, user: admin, token, now: new Date() });
    const csrfData = await csrf(); const authCookie = `oims_session=${token}`;
    const invalidKeys: Array<[string, string | null]> = [
      ["missing", null],
      ["empty", ""],
      ["too-long", `a${"b".repeat(128)}`],
      ["malformed", "draft/key-with-slash"],
    ];
    for (const [label, key] of invalidKeys) {
      const response = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", {
        intent: "SAVE_DRAFT", invoice: { items: [] },
      }, authCookie, csrfData.token, csrfData.cookie, `invalid-key-${label}`, key));
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ error: {
        code: apiErrorCodes.INVALID_IDEMPOTENCY_KEY,
        fieldErrors: { idempotencyKey: "INVALID_IDEMPOTENCY_KEY" },
        requestId: `invalid-key-${label}`,
      } });
    }
    expect((temporary.connection.client.prepare("select count(*) as count from invoices").get() as { count: bigint }).count).toBe(0n);
    expect((temporary.connection.client.prepare("select count(*) as count from invoice_sequences").get() as { count: bigint }).count).toBe(0n);
    expect((temporary.connection.client.prepare("select count(*) as count from audit_logs where event_type='INVOICE_CREATED'")
      .get() as { count: bigint }).count).toBe(0n);
    expect((temporary.connection.client.prepare("select count(*) as count from invoice_idempotency_records")
      .get() as { count: bigint }).count).toBe(0n);

    const valid = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", {
      intent: "SAVE_DRAFT", invoice: { items: [] },
    }, authCookie, csrfData.token, csrfData.cookie, "valid-key-request", "valid-draft-key-0001"));
    expect(valid.status).toBe(201);
    expect((temporary.connection.client.prepare("select count(*) as count from invoices").get() as { count: bigint }).count).toBe(1n);
  });

  it("ignores forged calculated fields and persists server-recalculated values (AT-CALC-010)", async () => {
    temporary = createTemporaryDatabase(); globalThis.__oimsDatabaseConnection = temporary.connection;
    const admin = await createTestAdmin(temporary.connection); const token = createSessionToken();
    insertSession({ connection: temporary.connection, user: admin, token, now: new Date() });
    const csrfData = await csrf();
    const response = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", {
      intent: "SAVE_DRAFT",
      invoice: {
        totals: { subtotalMinor: "1", grandTotalMinor: "1", remainingMinor: "1" },
        subtotalMinor: "2",
        grandTotalMinor: "2",
        items: [{ productName: "server calculation", quantity: "2", unitPrice: "5",
          baseMinor: "3", taxableMinor: "3", lineTotalMinor: "3" }],
      },
    }, `oims_session=${token}`, csrfData.token, csrfData.cookie));
    expect(response.status).toBe(201);
    const body = await response.json() as { invoice: { id: string; totals: Record<string, string>;
      items: Array<{ baseMinor: string; taxableMinor: string; lineTotalMinor: string }> } };
    expect(body.invoice.totals).toMatchObject({ subtotalMinor: "1000", grandTotalMinor: "1000", remainingMinor: "1000" });
    expect(body.invoice.items[0]).toMatchObject({ baseMinor: "1000", taxableMinor: "1000", lineTotalMinor: "1000" });
    expect(temporary.connection.client.prepare(`select subtotal_minor as subtotalMinor,
      grand_total_minor as grandTotalMinor,remaining_minor as remainingMinor from invoices where id=?`)
      .get(body.invoice.id)).toEqual({ subtotalMinor: 1000n, grandTotalMinor: 1000n, remainingMinor: 1000n });
  });

  it("creates, reads, and patches a draft without exposing persistence internals", async () => {
    temporary = createTemporaryDatabase(); globalThis.__oimsDatabaseConnection = temporary.connection;
    const admin = await createTestAdmin(temporary.connection); const token = createSessionToken();
    insertSession({ connection: temporary.connection, user: admin, token, now: new Date() });
    const authCookie = `oims_session=${token}`; const csrfData = await csrf();
    const unauthenticated = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", {
      intent: "ISSUE", invoice: {},
    }, "", csrfData.token, csrfData.cookie));
    expect(unauthenticated.status).toBe(401);
    const createBody = {
      intent: "SAVE_DRAFT", invoice: { beneficiary: { name: "عميل" },
        items: [{ clientKey: "one", productName: "منتج", quantity: "2", unitPrice: "5" }] },
    };
    const createdResponse = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", createBody,
      authCookie, csrfData.token, csrfData.cookie));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as DraftResult & { requestId: string };
    expect(created.requestId).toBe("invoice-api-test");
    const lostResponseRetry = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", createBody,
      authCookie, csrfData.token, csrfData.cookie, "invoice-api-retry", "invoice-api-test-key"));
    expect(lostResponseRetry.status).toBe(201);
    const replayed = await lostResponseRetry.json() as DraftResult & { requestId: string };
    expect(replayed.requestId).toBe("invoice-api-retry");
    expect({ ...replayed, requestId: created.requestId }).toEqual(created);
    const conflictingRetry = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", {
      intent: "SAVE_DRAFT", invoice: { notes: "different payload", items: [] },
    }, authCookie, csrfData.token, csrfData.cookie, "invoice-api-conflict", "invoice-api-test-key"));
    expect(conflictingRetry.status).toBe(409);
    await expect(conflictingRetry.json()).resolves.toMatchObject({ error: {
      code: apiErrorCodes.IDEMPOTENCY_KEY_REUSED,
      fieldErrors: { idempotencyKey: "IDEMPOTENCY_KEY_REUSED" },
      requestId: "invoice-api-conflict",
    } });
    expect((temporary.connection.client.prepare("select count(*) as count from invoices").get() as { count: bigint }).count).toBe(1n);
    expect((temporary.connection.client.prepare("select last_value as value from invoice_sequences").get() as { value: bigint }).value).toBe(1n);
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
    const immutableRetryResponse = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", createBody,
      authCookie, csrfData.token, csrfData.cookie, "invoice-api-retry-after-edit", "invoice-api-test-key"));
    expect(immutableRetryResponse.status).toBe(201);
    const immutableRetry = await immutableRetryResponse.json() as DraftResult & { requestId: string };
    expect(immutableRetry.requestId).toBe("invoice-api-retry-after-edit");
    expect({ ...immutableRetry, requestId: created.requestId }).toEqual(created);
    expect((temporary.connection.client.prepare("select count(*) as count from audit_logs where event_type='INVOICE_CREATED'")
      .get() as { count: bigint }).count).toBe(1n);
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

  it("issues directly and from a draft with CSRF, strict input, safe DTOs, and idempotent request IDs", async () => {
    temporary = createTemporaryDatabase(); globalThis.__oimsDatabaseConnection = temporary.connection;
    const admin = await createTestAdmin(temporary.connection); const token = createSessionToken();
    insertSession({ connection: temporary.connection, user: admin, token, now: new Date() });
    const authCookie = `oims_session=${token}`; const csrfData = await csrf();
    const invoice = { invoiceDate: "2026-08-27", beneficiary: { name: "عميل API" },
      items: [{ productName: "منتج API", quantity: "2", unitPrice: "3" }] };
    const forged = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", {
      intent: "ISSUE", invoice: { ...invoice, invoiceStatus: "ISSUED" },
    }, authCookie, csrfData.token, csrfData.cookie));
    expect(forged.status).toBe(422);
    expect((temporary.connection.client.prepare("select count(*) as count from invoices").get() as { count: bigint }).count).toBe(0n);

    const issuedResponse = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", {
      intent: "ISSUE", invoice,
    }, authCookie, csrfData.token, csrfData.cookie));
    expect(issuedResponse.status).toBe(201);
    const issued = await issuedResponse.json() as { invoice: { id: string; invoiceNumber: string; invoiceStatus: string;
      issuedAt: string; issuedBy: { id: string }; printSnapshot: { companyNameAr: string; capturedAt: string } } };
    expect(issued.invoice).toMatchObject({ invoiceStatus: "ISSUED", issuedBy: { id: admin.id },
      printSnapshot: { capturedAt: issued.invoice.issuedAt } });
    expect(JSON.stringify(issued)).not.toMatch(/assetId|relativePath|phonesJson|sql|changesJson/iu);
    const retryResponse = await POST(request("http://127.0.0.1:3000/api/invoices", "POST", {
      intent: "ISSUE", invoice,
    }, authCookie, csrfData.token, csrfData.cookie));
    await expect(retryResponse.json()).resolves.toMatchObject({ invoice: { id: issued.invoice.id } });
    expect((temporary.connection.client.prepare("select count(*) as count from invoices").get() as { count: bigint }).count).toBe(1n);

    const draftResponse = await POST(new Request("http://127.0.0.1:3000/api/invoices", {
      method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin", "content-type": "application/json", cookie: `${authCookie}; ${csrfData.cookie}`,
        "x-csrf-token": csrfData.token, "x-request-id": "draft-api-create", "idempotency-key": "draft-api-create-key" },
      body: JSON.stringify({ intent: "SAVE_DRAFT", invoice: {} }),
    }));
    const draftCreated = await draftResponse.json() as { invoice: { id: string; rowVersion: number } };
    const noCsrf = await ISSUE(new Request(`http://127.0.0.1:3000/api/invoices/${draftCreated.invoice.id}/issue`, {
      method: "POST", headers: { cookie: authCookie, "content-type": "application/json" }, body: "{}",
    }));
    expect(noCsrf.status).toBe(403);
    const missing = await ISSUE(request("http://127.0.0.1:3000/api/invoices/01K00000000000000000000000/issue", "POST", {
      rowVersion: 1, invoice,
    }, authCookie, csrfData.token, csrfData.cookie));
    expect(missing.status).toBe(404);
    expect(JSON.stringify(await missing.json())).not.toMatch(/sqlite|select|service\.ts|\\/iu);
    const incomplete = await ISSUE(request(`http://127.0.0.1:3000/api/invoices/${draftCreated.invoice.id}/issue`, "POST", {
      rowVersion: 1, invoice: { beneficiary: { name: "" }, items: [{ productName: "", quantity: "", unitPrice: "" }] },
    }, authCookie, csrfData.token, csrfData.cookie));
    expect(incomplete.status).toBe(422);
    await expect(incomplete.json()).resolves.toMatchObject({ error: { fieldErrors: {
      "beneficiary.name": "REQUIRED", "items.0.productName": "REQUIRED",
      "items.0.quantity": "DECIMAL_REQUIRED", "items.0.unitPrice": "DECIMAL_REQUIRED",
    } } });
    const existingIssued = await ISSUE(request(`http://127.0.0.1:3000/api/invoices/${draftCreated.invoice.id}/issue`, "POST", {
      rowVersion: 1, invoice,
    }, authCookie, csrfData.token, csrfData.cookie));
    expect(existingIssued.status).toBe(200);
    await expect(existingIssued.json()).resolves.toMatchObject({ invoice: { invoiceStatus: "ISSUED", rowVersion: 2 } });
  });

  it("returns 403 when an employee calls draft PATCH after issue (AT-AUTH-007)", async () => {
    temporary = createTemporaryDatabase(); globalThis.__oimsDatabaseConnection = temporary.connection;
    const admin = await createTestAdmin(temporary.connection); const adminToken = createSessionToken();
    insertSession({ connection: temporary.connection, user: admin, token: adminToken, now: new Date() });
    const csrfData = await csrf(); const adminCookie = `oims_session=${adminToken}`;
    const body = { invoiceDate: "2026-08-27", beneficiary: { name: "مستفيد" },
      items: [{ productName: "منتج", quantity: "1", unitPrice: "1" }] };
    const createdResponse = await POST(new Request("http://127.0.0.1:3000/api/invoices", { method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin",
        "content-type": "application/json", cookie: `${adminCookie}; ${csrfData.cookie}`, "x-csrf-token": csrfData.token,
        "x-request-id": "auth7-create" }, body: JSON.stringify({ intent: "ISSUE", invoice: body }) }));
    const created = await createdResponse.json() as { invoice: { id: string; rowVersion: number } };
    const at = new Date().toISOString();
    temporary.connection.client.prepare(`insert into users (id,username,display_name,role,password_hash,is_active,
      must_change_password,failed_login_count,created_at,updated_at,row_version)
      values ('employee-api','employee.api','موظف API','EMPLOYEE','unused',1,0,0,?,?,1)`).run(at, at);
    const employeeToken = createSessionToken();
    insertSession({ connection: temporary.connection, user: { id: "employee-api", username: "employee.api",
      displayName: "موظف API", role: "EMPLOYEE", mustChangePassword: false }, token: employeeToken, now: new Date() });
    const patched = await PATCH(request(`http://127.0.0.1:3000/api/invoices/${created.invoice.id}`, "PATCH", {
      rowVersion: created.invoice.rowVersion, invoice: { ...body, notes: "محاولة ممنوعة" },
    }, `oims_session=${employeeToken}`, csrfData.token, csrfData.cookie));
    expect(patched.status).toBe(403);
    await expect(patched.json()).resolves.toMatchObject({ error: { code: apiErrorCodes.FORBIDDEN } });
    const stored = temporary.connection.client.prepare("select notes,row_version as rowVersion from invoices where id=?")
      .get(created.invoice.id);
    expect(stored).toEqual({ notes: null, rowVersion: 1n });
  });
});
