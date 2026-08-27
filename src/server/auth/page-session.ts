import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "./cookies";
import { resolveSessionToken, type AuthenticatedSession } from "./sessions";

export async function optionalPageSession(): Promise<AuthenticatedSession | undefined> {
  const cookieStore = await cookies();
  return resolveSessionToken({ token: cookieStore.get(SESSION_COOKIE_NAME)?.value });
}
