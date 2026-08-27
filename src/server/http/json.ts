import "server-only";

import { validationError } from "./errors";

export const MAX_JSON_BODY_BYTES = 32 * 1_024;

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");

  if (contentLength && Number(contentLength) > MAX_JSON_BODY_BYTES) {
    throw validationError();
  }

  const body = await request.text();

  if (!body || Buffer.byteLength(body, "utf8") > MAX_JSON_BODY_BYTES) {
    throw validationError();
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw validationError();
  }
}
