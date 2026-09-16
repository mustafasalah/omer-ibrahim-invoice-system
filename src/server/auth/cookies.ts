import "server-only";

import type { NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "oims_session";
export const CSRF_COOKIE_NAME = "oims_csrf";

export function isHttpsRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }

    const value = part.slice(separator + 1).trim();

    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function hasCookie(request: Request, name: string): boolean {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return false;
  }

  return cookieHeader.split(";").some((part) => {
    const separator = part.indexOf("=");
    return separator >= 0 && part.slice(0, separator).trim() === name;
  });
}

export function setSessionCookie(
  response: NextResponse,
  request: Request,
  token: string,
  absoluteExpiresAt: string,
): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: isHttpsRequest(request),
    expires: new Date(absoluteExpiresAt),
  });
}

export function deleteSessionCookie(response: NextResponse, request: Request): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: isHttpsRequest(request),
    expires: new Date(0),
    maxAge: 0,
  });
}

export function setCsrfCookie(response: NextResponse, request: Request, token: string): void {
  response.cookies.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: isHttpsRequest(request),
    maxAge: 2 * 60 * 60,
  });
}
