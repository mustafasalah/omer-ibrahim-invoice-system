import type { DraftInvoiceInput } from "./draft";

export type PendingCreateOutcome = "in-flight" | "ambiguous" | "resolved";

export type PendingCreate = Readonly<{
  idempotencyKey: string;
  payload: DraftInvoiceInput;
  fingerprint: string;
  outcome: PendingCreateOutcome;
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function canonicalDraftPayload(payload: DraftInvoiceInput): string {
  return JSON.stringify(canonicalize(payload));
}

export function snapshotPendingCreate(idempotencyKey: string, payload: DraftInvoiceInput): PendingCreate {
  const fingerprint = canonicalDraftPayload(payload);
  return {
    idempotencyKey,
    payload: JSON.parse(fingerprint) as DraftInvoiceInput,
    fingerprint,
    outcome: "in-flight",
  };
}

export function transitionPendingCreate(
  pending: PendingCreate,
  outcome: PendingCreateOutcome,
): PendingCreate {
  return { ...pending, outcome };
}

export function pendingCreateHasNewerInput(pending: PendingCreate, payload: DraftInvoiceInput): boolean {
  return canonicalDraftPayload(payload) !== pending.fingerprint;
}
