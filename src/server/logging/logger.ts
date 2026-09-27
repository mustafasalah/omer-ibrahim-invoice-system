import "server-only";

import path from "node:path";
import pino, { type DestinationStream, type Logger } from "pino";
import { ensureDataDirectories } from "@/server/config/data-directories";
import { getConfig } from "@/server/config/env";

export const redactedLogPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  'req.headers["idempotency-key"]',
  'request.headers["idempotency-key"]',
  "idempotencyKey",
  "password",
  "passwordHash",
  "passwordConfirmation",
  "sessionSecret",
  "sessionToken",
  "token",
  "*.password",
  "*.passwordHash",
  "*.passwordConfirmation",
  "*.sessionSecret",
  "*.sessionToken",
  "*.token",
  "*.idempotencyKey",
  "invoice",
  "*.invoice",
  "amount",
  "amountMinor",
  "subtotalMinor",
  "discountTotalMinor",
  "taxTotalMinor",
  "grandTotalMinor",
  "grossPaidMinor",
  "refundedTotalMinor",
  "netCollectedMinor",
  "remainingMinor",
  "*.amount",
  "*.amountMinor",
  "*.subtotalMinor",
  "*.discountTotalMinor",
  "*.taxTotalMinor",
  "*.grandTotalMinor",
  "*.grossPaidMinor",
  "*.refundedTotalMinor",
  "*.netCollectedMinor",
  "*.remainingMinor",
  "financialDetails",
  "*.financialDetails",
] as const;

export function createLogger(destination?: DestinationStream): Logger {
  const config = getConfig();
  const options: pino.LoggerOptions = {
    level: config.logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...redactedLogPaths],
      censor: "[REDACTED]",
    },
  };

  if (destination) {
    return pino(options, destination);
  }

  const directories = ensureDataDirectories(config);
  const fileDestination = pino.destination({
    dest: path.join(directories.logs, "application.log"),
    mkdir: true,
    sync: false,
  });

  return pino(options, fileDestination);
}

let singletonLogger: Logger | undefined;

export function getLogger(): Logger {
  singletonLogger ??= createLogger();
  return singletonLogger;
}
