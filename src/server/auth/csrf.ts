import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "@/server/config/env";
import { csrfError } from "@/server/http/errors";
import { CSRF_COOKIE_NAME, readCookie } from "./cookies";

export const CSRF_HEADER_NAME = "x-csrf-token";

function signNonce(nonce: string): string {
  return createHmac("sha256", getConfig().sessionSecret)
    .update(`oims-csrf:${nonce}`)
    .digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createCsrfToken(): string {
  const nonce = randomBytes(32).toString("base64url");
  return `${nonce}.${signNonce(nonce)}`;
}

export function isValidCsrfToken(token: string): boolean {
  const separator = token.indexOf(".");

  if (separator <= 0 || separator !== token.lastIndexOf(".")) {
    return false;
  }

  const nonce = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  return nonce.length === 43 && constantTimeEqual(signature, signNonce(nonce));
}

function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin || !host) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    return (
      (originUrl.protocol === "http:" || originUrl.protocol === "https:") &&
      !originUrl.username &&
      !originUrl.password &&
      originUrl.host.toLowerCase() === host.trim().toLowerCase()
    );
  } catch {
    return false;
  }
}

export function requireCsrfProtection(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  const cookieToken = readCookie(request, CSRF_COOKIE_NAME);
  const headerToken = request.headers.get(CSRF_HEADER_NAME);

  if (
    !hasSameOrigin(request) ||
    (fetchSite !== null && fetchSite !== "same-origin") ||
    !cookieToken ||
    !headerToken ||
    !constantTimeEqual(cookieToken, headerToken) ||
    !isValidCsrfToken(cookieToken)
  ) {
    throw csrfError();
  }
}
