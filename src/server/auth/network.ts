import "server-only";

function stripAddressDecorations(value: string): string {
  const trimmed = value.trim().replace(/^"|"$/g, "");

  if (trimmed.startsWith("[")) {
    const closingBracket = trimmed.indexOf("]");
    return closingBracket > 0 ? trimmed.slice(1, closingBracket) : trimmed;
  }

  if (/^127(?:\.\d{1,3}){3}:\d+$/.test(trimmed)) {
    return trimmed.slice(0, trimmed.lastIndexOf(":"));
  }

  return trimmed.split("%")[0] ?? trimmed;
}

export function isLoopbackAddress(value: string): boolean {
  const address = stripAddressDecorations(value).toLowerCase();

  if (address === "localhost" || address === "::1") {
    return true;
  }

  if (address.startsWith("::ffff:")) {
    return isLoopbackAddress(address.slice("::ffff:".length));
  }

  const parts = address.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.slice(1).every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

function forwardedAddress(request: Request): string | undefined {
  const forwarded = request.headers.get("forwarded");

  if (forwarded) {
    const match = /(?:^|;)\s*for=("?\[[^\]]+\]"?|"?[^;,\s]+"?)/i.exec(
      forwarded.split(",")[0] ?? "",
    );
    return match?.[1];
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
  }

  return request.headers.get("x-real-ip") ?? undefined;
}

export function isLoopbackBootstrapRequest(request: Request, boundHost: string): boolean {
  if (!isLoopbackAddress(boundHost)) {
    return false;
  }

  const forwarded = forwardedAddress(request);
  return forwarded ? isLoopbackAddress(forwarded) : true;
}
