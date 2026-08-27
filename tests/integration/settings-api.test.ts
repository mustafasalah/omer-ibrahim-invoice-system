import { afterEach, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { GET, PATCH } from "@/app/api/settings/route";
import type { SettingsResponse } from "@/domain/settings/contracts";
import { createSessionToken, insertSession } from "@/server/auth/sessions";
import { apiErrorCodes } from "@/server/http/errors";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;
afterEach(() => { globalThis.__oimsDatabaseConnection = undefined; temporary?.dispose(); temporary = undefined; });

function cookiePair(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("Missing cookie.");
  return value.split(";")[0] ?? "";
}

async function csrf() {
  const response = await getCsrf(new Request("http://127.0.0.1:3000/api/auth/csrf", { headers: { host: "127.0.0.1:3000" } }));
  return { token: (await response.clone().json() as { csrfToken: string }).csrfToken, cookie: cookiePair(response) };
}

function sessionCookie(user: { id: string; username: string; displayName: string; role: "ADMIN" | "EMPLOYEE"; mustChangePassword: boolean }) {
  if (!temporary) throw new Error("Missing database.");
  const token = createSessionToken();
  insertSession({ connection: temporary.connection, user, token, now: new Date() });
  return `oims_session=${token}`;
}

describe("settings API authorization and contract", () => {
  it("returns 401 without a session and 403 to an employee", async () => {
    temporary = createTemporaryDatabase(); globalThis.__oimsDatabaseConnection = temporary.connection;
    const admin = await createTestAdmin(temporary.connection);
    const unauthenticated = await GET(new Request("http://127.0.0.1:3000/api/settings"));
    expect(unauthenticated.status).toBe(401);
    const at = "2026-08-27T08:00:00.000Z";
    temporary.connection.client.prepare(`insert into users
      (id,username,display_name,role,password_hash,is_active,must_change_password,failed_login_count,created_at,updated_at,row_version)
      values (?,?,?,?,?,1,0,0,?,?,1)`).run("employee-1", "employee", "موظف", "EMPLOYEE", "unused", at, at);
    const employee = { id: "employee-1", username: "employee", displayName: "موظف", role: "EMPLOYEE" as const, mustChangePassword: false };
    const forbidden = await GET(new Request("http://127.0.0.1:3000/api/settings", { headers: { cookie: sessionCookie(employee) } }));
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ error: { code: apiErrorCodes.FORBIDDEN } });
    expect(admin.role).toBe("ADMIN");
  });

  it("reads, validates CSRF, rejects unknown fields, and updates for an administrator", async () => {
    temporary = createTemporaryDatabase(); globalThis.__oimsDatabaseConnection = temporary.connection;
    const admin = await createTestAdmin(temporary.connection);
    const authCookie = sessionCookie(admin);
    const fetched = await GET(new Request("http://127.0.0.1:3000/api/settings", { headers: { cookie: authCookie, "x-request-id": "settings-get" } }));
    expect(fetched.status).toBe(200);
    const body = await fetched.json() as SettingsResponse;
    expect(body.preview.invoiceNumber).toMatch(/^OI-/u);
    expect(JSON.stringify(body)).not.toContain("taxEnabled");
    expect(JSON.stringify(body)).not.toContain("lanAccessEnabled");

    const missingCsrf = await PATCH(new Request("http://127.0.0.1:3000/api/settings", { method: "PATCH",
      headers: { cookie: authCookie, "content-type": "application/json" }, body: "{}" }));
    expect(missingCsrf.status).toBe(403);
    const csrfData = await csrf();
    const current = body.settings;
    const rowVersion = current.rowVersion;
    const editable = {
      company: current.company,
      currency: current.currency,
      numbering: current.numbering,
      regional: current.regional,
      session: { idleMinutes: current.session.idleMinutes },
      defaultPaymentTerms: current.defaultPaymentTerms,
      footerText: current.footerText,
    };
    const request = (payload: unknown) => new Request("http://127.0.0.1:3000/api/settings", { method: "PATCH",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin",
        cookie: `${authCookie}; ${csrfData.cookie}`, "x-csrf-token": csrfData.token, "content-type": "application/json" },
      body: JSON.stringify(payload) });
    const unknown = await PATCH(request({ rowVersion, settings: { ...editable, id: "default" } }));
    expect(unknown.status).toBe(422);
    const updated = await PATCH(request({ rowVersion,
      settings: { ...editable, company: { ...editable.company, address: "الخرطوم" } } }));
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ settings: { company: { address: "الخرطوم" }, rowVersion: rowVersion + 1 } });
  });
});
