import { afterEach, describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { createInvoiceDraft } from "@/server/invoices/service";
import { getSettings } from "@/server/settings/service";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;
afterEach(() => { temporary?.dispose(); temporary = undefined; });
const emptyDraft = { intent: "SAVE_DRAFT", invoice: { items: [] } };
const SAFETY_TIMEOUT_MS = 10_000;

type WriterMessage = {
  type: "READY" | "LOCK_ACQUIRED" | "WRITE_ATTEMPT_STARTED" | "RESULT" | "ERROR";
  invoiceNumber?: string;
  code?: string;
  status?: number;
};

type WriterData = {
  databasePath: string;
  actor: { id: string; displayName: string; role: "ADMIN" | "EMPLOYEE" };
  requestId: string;
  now: string;
  startGate: SharedArrayBuffer;
  releaseGate?: SharedArrayBuffer;
  busyTimeoutMs?: number;
};

type WriterHandle = ReturnType<typeof startWriter>;

function signal(buffer: SharedArrayBuffer): void {
  const gate = new Int32Array(buffer);
  Atomics.store(gate, 0, 1);
  Atomics.notify(gate, 0);
}

async function withSafetyTimeout<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const safety = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Worker orchestration exceeded its safety timeout.")), SAFETY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, safety]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function startWriter(data: WriterData) {
  const worker = new Worker(new URL("../fixtures/typescript-worker-bootstrap.mjs", import.meta.url), {
    execArgv: ["--conditions=react-server"],
    workerData: data,
  });
  const messages: WriterMessage[] = [];
  worker.on("message", (message: WriterMessage) => messages.push(message));
  const exited = new Promise<number>((resolve) => worker.once("exit", resolve));

  const waitFor = (type: WriterMessage["type"]): Promise<WriterMessage> => {
    const existing = messages.find((message) => message.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const onMessage = (message: WriterMessage) => {
        if (message.type !== type) return;
        cleanup(); resolve(message);
      };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onExit = (code: number) => { cleanup(); reject(new Error(`Writer exited with code ${code} before ${type}.`)); };
      const cleanup = () => {
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
      };
      worker.on("message", onMessage);
      worker.once("error", onError);
      worker.once("exit", onExit);
    });
  };
  const outcome = () => Promise.race([waitFor("RESULT"), waitFor("ERROR")]);
  return { worker, waitFor, outcome, exited };
}

async function closeWriters(handles: WriterHandle[], gates: SharedArrayBuffer[]): Promise<void> {
  for (const gate of gates) signal(gate);
  await withSafetyTimeout(Promise.all(handles.map((handle) => handle.exited))).then(() => undefined);
}

describe("invoice number allocation", () => {
  it("uses max(last + 1, sequence start) and skips colliding final numbers", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    getSettings({ connection: temporary.connection, now: new Date("2026-06-01T00:00:00Z") });
    temporary.connection.client.prepare("update app_settings set sequence_start=50 where id='default'").run();
    temporary.connection.client.prepare("insert into invoice_sequences (sequence_key,last_value,updated_at) values ('invoice:2026',2,?)")
      .run("2026-01-01T00:00:00Z");
    const first = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "start", now: new Date("2026-06-01T00:00:00Z") });
    expect(first.invoice.invoiceNumber).toBe("OI-2026-00050");
    temporary.connection.client.prepare("update invoice_sequences set last_value=49 where sequence_key='invoice:2026'").run();
    const skipped = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "collision", now: new Date("2026-06-01T00:00:00Z") });
    expect(skipped.invoice.invoiceNumber).toBe("OI-2026-00051");
  });

  it("keeps independent YEARLY sequences and one NEVER sequence", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const y2026 = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "y26", now: new Date("2026-06-01T00:00:00Z") });
    const y2027 = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "y27", now: new Date("2027-06-01T00:00:00Z") });
    expect(y2026.invoice.invoiceNumber).toBe("OI-2026-00001");
    expect(y2027.invoice.invoiceNumber).toBe("OI-2027-00001");
    expect(temporary.connection.client.prepare("select sequence_key as key,last_value as value from invoice_sequences order by sequence_key").all())
      .toEqual([{ key: "invoice:2026", value: 1n }, { key: "invoice:2027", value: 1n }]);
    temporary.connection.client.prepare(`update app_settings set sequence_reset_policy='NEVER',
      invoice_number_pattern='{PREFIX}-{SEQ:5}' where id='default'`).run();
    const globalOne = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "g1", now: new Date("2027-06-01T00:00:00Z") });
    const globalTwo = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
      requestId: "g2", now: new Date("2028-06-01T00:00:00Z") });
    expect([globalOne.invoice.invoiceNumber, globalTwo.invoice.invoiceNumber]).toEqual(["OI-00001", "OI-00002"]);
  });

  it("releases two ready independent SQLite writers from one shared barrier", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const startGate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const base = { databasePath: temporary.connection.databasePath,
      actor: { id: admin.id, displayName: admin.displayName, role: admin.role },
      now: "2026-06-01T00:00:00Z", startGate };
    const first = startWriter({ ...base, requestId: "concurrent-a" });
    const second = startWriter({ ...base, requestId: "concurrent-b" });
    try {
      await withSafetyTimeout((async () => {
        await Promise.all([first.waitFor("READY"), second.waitFor("READY")]);
        signal(startGate);
        await Promise.all([first.waitFor("WRITE_ATTEMPT_STARTED"), second.waitFor("WRITE_ATTEMPT_STARTED")]);
        const outcomes = await Promise.all([first.outcome(), second.outcome()]);
        expect(outcomes.map((message) => message.invoiceNumber).sort())
          .toEqual(["OI-2026-00001", "OI-2026-00002"]);
        await Promise.all([first.exited, second.exited]);
      })());
      expect((temporary.connection.client.prepare("select count(distinct invoice_number) as count from invoices").get() as { count: bigint }).count).toBe(2n);
      expect((temporary.connection.client.prepare("select last_value as value from invoice_sequences where sequence_key='invoice:2026'").get() as { value: bigint }).value).toBe(2n);
    } finally {
      await closeWriters([first, second], [startGate]);
    }
  }, 15_000);

  it("uses explicit lock and write-attempt signals to test busy timeout without consuming a number", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const holderStart = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const contenderStart = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const releaseLock = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const base = { databasePath: temporary.connection.databasePath,
      actor: { id: admin.id, displayName: admin.displayName, role: admin.role }, now: "2026-06-01T00:00:00Z" };
    const holder = startWriter({ ...base, requestId: "lock-holder", startGate: holderStart, releaseGate: releaseLock });
    const contender = startWriter({ ...base, requestId: "lock-contender", startGate: contenderStart, busyTimeoutMs: 25 });
    try {
      await withSafetyTimeout((async () => {
        await Promise.all([holder.waitFor("READY"), contender.waitFor("READY")]);
        signal(holderStart);
        await holder.waitFor("LOCK_ACQUIRED");
        signal(contenderStart);
        await contender.waitFor("WRITE_ATTEMPT_STARTED");
        await expect(contender.outcome()).resolves.toMatchObject({ type: "ERROR", code: "DATABASE_BUSY", status: 503 });
        signal(releaseLock);
        await expect(holder.outcome()).resolves.toMatchObject({ type: "RESULT", invoiceNumber: "OI-2026-00001" });
        await Promise.all([holder.exited, contender.exited]);
      })());
      expect((temporary.connection.client.prepare("select count(*) as count from invoices").get() as { count: bigint }).count).toBe(1n);
      expect((temporary.connection.client.prepare("select last_value as value from invoice_sequences where sequence_key='invoice:2026'").get() as { value: bigint }).value).toBe(1n);
      const recovered = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
        requestId: "after-lock", now: new Date("2026-06-01T00:00:00Z") });
      expect(recovered.invoice.invoiceNumber).toBe("OI-2026-00002");
      expect((temporary.connection.client.prepare("select last_value as value from invoice_sequences where sequence_key='invoice:2026'").get() as { value: bigint }).value).toBe(2n);
    } finally {
      await closeWriters([holder, contender], [holderStart, contenderStart, releaseLock]);
    }
  }, 15_000);
});
