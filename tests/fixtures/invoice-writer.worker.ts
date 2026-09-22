import { openDatabase } from "@/server/db/connection";
import { createInvoiceDraft } from "@/server/invoices/service";

type WriterData = {
  databasePath: string;
  actor: { id: string; displayName: string; role: "ADMIN" | "EMPLOYEE" };
  requestId: string;
  now: string;
  holdAfterSequenceMs?: number;
  busyTimeoutMs?: number;
};

process.send?.({ type: "ready" });
process.once("message", (message: { type?: string; data?: WriterData }) => {
  if (message.type !== "run" || !message.data) return;
  const data = message.data;
  const connection = openDatabase(data.databasePath);
  if (data.busyTimeoutMs !== undefined) connection.client.pragma(`busy_timeout = ${data.busyTimeoutMs}`);
  try {
    const result = createInvoiceDraft({
      connection,
      actor: data.actor,
      requestId: data.requestId,
      now: new Date(data.now),
      input: { intent: "SAVE_DRAFT", invoice: { items: [] } },
      faultInjector: (point) => {
        if (point !== "afterSequence" || !data.holdAfterSequenceMs) return;
        process.send?.({ type: "lock-held" });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, data.holdAfterSequenceMs);
      },
    });
    process.send?.({ type: "result", invoiceNumber: result.invoice.invoiceNumber });
  } catch (error) {
    const safe = error as { code?: string; status?: number };
    process.send?.({ type: "error", code: safe.code ?? "UNKNOWN", status: safe.status ?? 500 });
  } finally {
    connection.client.close();
    process.disconnect?.();
  }
});
