import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "@/server/db/connection";
import { createInvoiceDraft } from "@/server/invoices/service";

type WriterData = {
  databasePath: string;
  actor: { id: string; displayName: string; role: "ADMIN" | "EMPLOYEE" };
  requestId: string;
  now: string;
  startGate: SharedArrayBuffer;
  releaseGate?: SharedArrayBuffer;
  busyTimeoutMs?: number;
};

const port = parentPort;
if (!port) throw new Error("Invoice writer must run in a worker thread.");

const data = workerData as WriterData;
let connection: ReturnType<typeof openDatabase> | undefined;

function waitForSignal(buffer: SharedArrayBuffer): void {
  const signal = new Int32Array(buffer);
  while (Atomics.load(signal, 0) === 0) Atomics.wait(signal, 0, 0);
}

try {
  connection = openDatabase(data.databasePath);
  if (data.busyTimeoutMs !== undefined) connection.client.pragma(`busy_timeout = ${data.busyTimeoutMs}`);
  port.postMessage({ type: "READY" });
  waitForSignal(data.startGate);
  port.postMessage({ type: "WRITE_ATTEMPT_STARTED" });
  const result = createInvoiceDraft({
    connection,
    actor: data.actor,
    requestId: data.requestId,
    idempotencyKey: data.requestId,
    now: new Date(data.now),
    input: { intent: "SAVE_DRAFT", invoice: { items: [] } },
    faultInjector: (point) => {
      if (point !== "afterSequence" || !data.releaseGate) return;
      port.postMessage({ type: "LOCK_ACQUIRED" });
      waitForSignal(data.releaseGate);
    },
  });
  port.postMessage({ type: "RESULT", invoiceNumber: result.invoice.invoiceNumber });
} catch (error) {
  const safe = error as { code?: string; status?: number };
  port.postMessage({ type: "ERROR", code: safe.code ?? "UNKNOWN", status: safe.status ?? 500 });
} finally {
  connection?.client.close();
  port.close();
}
