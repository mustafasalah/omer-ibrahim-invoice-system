import { afterEach, describe, expect, it } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInvoiceDraft } from "@/server/invoices/service";
import { getSettings } from "@/server/settings/service";
import { createTestAdmin } from "../fixtures/auth";
import { createTemporaryDatabase, type TemporaryDatabase } from "../fixtures/database";

let temporary: TemporaryDatabase | undefined;
afterEach(() => { temporary?.dispose(); temporary = undefined; });
const emptyDraft = { intent: "SAVE_DRAFT", invoice: { items: [] } };

type WriterMessage = { type: "ready" | "lock-held" | "result" | "error"; invoiceNumber?: string; code?: string; status?: number };

function startWriter(workerData: Record<string, unknown>) {
  const worker: ChildProcess = fork(fileURLToPath(new URL("../fixtures/typescript-process-bootstrap.mjs", import.meta.url)), [], {
    execArgv: ["--conditions=react-server"],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const messages: WriterMessage[] = [];
  const waiters = new Map<string, Array<(message: WriterMessage) => void>>();
  worker.on("message", (message: WriterMessage) => {
    messages.push(message);
    waiters.get(message.type)?.splice(0).forEach((resolve) => resolve(message));
  });
  const waitFor = (type: WriterMessage["type"]): Promise<WriterMessage> => {
    const existing = messages.find((message) => message.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for worker message: ${type}`)), 8_000);
      const wrapped = (message: WriterMessage) => { clearTimeout(timeout); resolve(message); };
      waiters.set(type, [...(waiters.get(type) ?? []), wrapped]);
      worker.once("error", reject);
    });
  };
  const outcome = () => Promise.race([waitFor("result"), waitFor("error")]);
  return { worker, waitFor, outcome, start: () => worker.send({ type: "run", data: workerData }) };
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

  it("serializes two creation attempts from independent connections into unique sequential numbers", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const workerData = { databasePath: temporary.connection.databasePath,
      actor: { id: admin.id, displayName: admin.displayName, role: admin.role },
      now: "2026-06-01T00:00:00Z" };
    const first = startWriter({ ...workerData, requestId: "concurrent-a" });
    const second = startWriter({ ...workerData, requestId: "concurrent-b" });
    try {
      await Promise.all([first.waitFor("ready"), second.waitFor("ready")]);
      first.start(); second.start();
      const outcomes = await Promise.all([first.outcome(), second.outcome()]);
      expect(outcomes.map((message) => message.invoiceNumber).sort())
        .toEqual(["OI-2026-00001", "OI-2026-00002"]);
      expect((temporary.connection.client.prepare("select count(distinct invoice_number) as count from invoices").get() as { count: bigint }).count).toBe(2n);
      expect((temporary.connection.client.prepare("select last_value as value from invoice_sequences where sequence_key='invoice:2026'").get() as { value: bigint }).value).toBe(2n);
    } finally { first.worker.kill(); second.worker.kill(); }
  }, 15_000);

  it("honors busy timeout deterministically without consuming a sequence number", async () => {
    temporary = createTemporaryDatabase(); const admin = await createTestAdmin(temporary.connection);
    const base = { databasePath: temporary.connection.databasePath,
      actor: { id: admin.id, displayName: admin.displayName, role: admin.role }, now: "2026-06-01T00:00:00Z" };
    const holder = startWriter({ ...base, requestId: "lock-holder", holdAfterSequenceMs: 4_000 });
    let contender: ReturnType<typeof startWriter> | undefined;
    try {
      await holder.waitFor("ready"); holder.start(); await holder.waitFor("lock-held");
      contender = startWriter({ ...base, requestId: "lock-contender", busyTimeoutMs: 25 });
      await contender.waitFor("ready"); contender.start();
      await expect(contender.outcome()).resolves.toMatchObject({ type: "error", code: "DATABASE_BUSY", status: 503 });
      await expect(holder.outcome()).resolves.toMatchObject({ type: "result", invoiceNumber: "OI-2026-00001" });
      const recovered = createInvoiceDraft({ connection: temporary.connection, actor: admin, input: emptyDraft,
        requestId: "after-lock", now: new Date("2026-06-01T00:00:00Z") });
      expect(recovered.invoice.invoiceNumber).toBe("OI-2026-00002");
      expect((temporary.connection.client.prepare("select last_value as value from invoice_sequences where sequence_key='invoice:2026'").get() as { value: bigint }).value).toBe(2n);
    } finally {
      holder.worker.kill(); contender?.worker.kill();
    }
  }, 15_000);
});
