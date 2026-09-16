import { afterEach, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { POST as bootstrapAdminRoute } from "@/app/api/bootstrap/admin/route";
import { GET as bootstrapStatusRoute } from "@/app/api/bootstrap/status/route";
import { apiErrorCodes } from "@/server/http/errors";
import { resetMissingLoginAttemptsForTests } from "@/server/auth/login";
import { TEST_ADMIN_PASSWORD } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;

afterEach(() => {
  globalThis.__oimsDatabaseConnection = undefined;
  resetMissingLoginAttemptsForTests();
  temporary?.dispose();
  temporary = undefined;
});

function cookiePair(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Expected a Set-Cookie header.");
  }
  return setCookie.split(";")[0] ?? "";
}

async function csrf(origin = "http://127.0.0.1:3000") {
  const response = await getCsrf(
    new Request(`${origin}/api/auth/csrf`, {
      headers: { host: new URL(origin).host, "x-request-id": "csrf-test" },
    }),
  );
  const body = (await response.json()) as { csrfToken: string };
  return { token: body.csrfToken, cookie: cookiePair(response) };
}

function mutationRequest(options: {
  url: string;
  csrfToken: string;
  csrfCookie: string;
  body?: unknown;
  extraCookie?: string;
  headers?: HeadersInit;
}): Request {
  const url = new URL(options.url);
  return new Request(url, {
    method: "POST",
    headers: {
      host: url.host,
      origin: url.origin,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": options.csrfToken,
      cookie: [options.csrfCookie, options.extraCookie].filter(Boolean).join("; "),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function bootstrapThroughApi() {
  const csrfData = await csrf();
  return bootstrapAdminRoute(
    mutationRequest({
      url: "http://127.0.0.1:3000/api/bootstrap/admin",
      csrfToken: csrfData.token,
      csrfCookie: csrfData.cookie,
      body: {
        username: "ApiAdmin",
        displayName: "مدير API",
        password: TEST_ADMIN_PASSWORD,
        passwordConfirmation: TEST_ADMIN_PASSWORD,
      },
    }),
  );
}

describe("bootstrap and authentication API", () => {
  it("exposes only bootstrap state, rejects cross-origin and remote creation, then closes permanently", async () => {
    temporary = createTemporaryDatabase();
    globalThis.__oimsDatabaseConnection = temporary.connection;

    const initialStatus = await bootstrapStatusRoute(
      new Request("http://127.0.0.1:3000/api/bootstrap/status"),
    );
    expect(await initialStatus.json()).toEqual({ bootstrapRequired: true });

    const csrfData = await csrf();
    const crossOrigin = await bootstrapAdminRoute(
      mutationRequest({
        url: "http://127.0.0.1:3000/api/bootstrap/admin",
        csrfToken: csrfData.token,
        csrfCookie: csrfData.cookie,
        body: {},
        headers: { origin: "http://attacker.test" },
      }),
    );
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toMatchObject({
      error: { code: apiErrorCodes.CSRF_INVALID, requestId: expect.any(String) },
    });

    const remote = await bootstrapAdminRoute(
      mutationRequest({
        url: "http://127.0.0.1:3000/api/bootstrap/admin",
        csrfToken: csrfData.token,
        csrfCookie: csrfData.cookie,
        body: {},
        headers: { "x-forwarded-for": "192.168.1.25" },
      }),
    );
    expect(remote.status).toBe(403);
    await expect(remote.json()).resolves.toMatchObject({
      error: { code: apiErrorCodes.BOOTSTRAP_LOCAL_ONLY },
    });

    const rebindingCsrf = await csrf("http://attacker.test");
    const rebinding = await bootstrapAdminRoute(
      mutationRequest({
        url: "http://attacker.test/api/bootstrap/admin",
        csrfToken: rebindingCsrf.token,
        csrfCookie: rebindingCsrf.cookie,
        body: {},
      }),
    );
    expect(rebinding.status).toBe(403);
    await expect(rebinding.json()).resolves.toMatchObject({
      error: { code: apiErrorCodes.BOOTSTRAP_LOCAL_ONLY },
    });

    const created = await bootstrapThroughApi();
    const serializedCreated = JSON.stringify(await created.json());
    expect(created.status).toBe(201);
    expect(serializedCreated).not.toContain(TEST_ADMIN_PASSWORD);
    expect(serializedCreated).not.toContain("passwordHash");
    expect(serializedCreated).not.toContain("sessionToken");
    expect(serializedCreated).not.toContain("tokenHash");

    const closedStatus = await bootstrapStatusRoute(
      new Request("http://127.0.0.1:3000/api/bootstrap/status"),
    );
    expect(await closedStatus.json()).toEqual({ bootstrapRequired: false });

    const repeated = await bootstrapThroughApi();
    expect(repeated.status).toBe(409);
    await expect(repeated.json()).resolves.toMatchObject({
      error: { code: apiErrorCodes.BOOTSTRAP_COMPLETE },
    });
  });

  it("sets a hardened cookie, serves the session, and logs out idempotently", async () => {
    temporary = createTemporaryDatabase();
    globalThis.__oimsDatabaseConnection = temporary.connection;
    await bootstrapThroughApi();

    const unauthenticated = await sessionRoute(
      new Request("http://127.0.0.1:3000/api/auth/session"),
    );
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("set-cookie")).toBeNull();
    await expect(unauthenticated.json()).resolves.toMatchObject({
      error: { code: apiErrorCodes.UNAUTHORIZED },
    });

    const invalidSession = await sessionRoute(
      new Request("http://127.0.0.1:3000/api/auth/session", {
        headers: { cookie: "oims_session=invalid-or-expired-token" },
      }),
    );
    expect(invalidSession.status).toBe(401);
    expect(invalidSession.headers.get("set-cookie")).toMatch(/oims_session=;.*Max-Age=0/i);

    const csrfData = await csrf("https://127.0.0.1:3000");
    const loginResponse = await loginRoute(
      mutationRequest({
        url: "https://127.0.0.1:3000/api/auth/login",
        csrfToken: csrfData.token,
        csrfCookie: csrfData.cookie,
        body: { username: "APIADMIN", password: TEST_ADMIN_PASSWORD },
      }),
    );
    const loginBody = JSON.stringify(await loginResponse.clone().json());
    const loginSetCookie = loginResponse.headers.get("set-cookie") ?? "";
    const sessionCookie = cookiePair(loginResponse);

    expect(loginResponse.status).toBe(200);
    expect(loginSetCookie).toContain("HttpOnly");
    expect(loginSetCookie).toMatch(/SameSite=Strict/i);
    expect(loginSetCookie).toContain("Path=/");
    expect(loginSetCookie).toContain("Secure");
    expect(loginBody).not.toContain(TEST_ADMIN_PASSWORD);
    expect(loginBody).not.toContain("passwordHash");
    expect(loginBody).not.toContain("sessionToken");
    expect(loginBody).not.toContain("tokenHash");

    const sessionResponse = await sessionRoute(
      new Request("https://127.0.0.1:3000/api/auth/session", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toMatchObject({
      user: { username: "apiadmin", role: "ADMIN" },
    });

    const logoutCsrf = await csrf("https://127.0.0.1:3000");
    const logoutResponse = await logoutRoute(
      mutationRequest({
        url: "https://127.0.0.1:3000/api/auth/logout",
        csrfToken: logoutCsrf.token,
        csrfCookie: logoutCsrf.cookie,
        extraCookie: sessionCookie,
      }),
    );
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie")).toMatch(/oims_session=;.*Max-Age=0/i);
    const storedSession = temporary.connection.client
      .prepare("select revoked_at as revokedAt from sessions")
      .get() as { revokedAt: string | null };
    expect(storedSession.revokedAt).not.toBeNull();

    const secondCsrf = await csrf("https://127.0.0.1:3000");
    const repeatedLogout = await logoutRoute(
      mutationRequest({
        url: "https://127.0.0.1:3000/api/auth/logout",
        csrfToken: secondCsrf.token,
        csrfCookie: secondCsrf.cookie,
        extraCookie: "oims_session=invalid-or-expired-token",
      }),
    );
    expect(repeatedLogout.status).toBe(200);
    expect(repeatedLogout.headers.get("set-cookie")).toMatch(/oims_session=;.*Max-Age=0/i);
  });
});
