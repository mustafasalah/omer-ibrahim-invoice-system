import "./user-info-shim.mjs";

const { register } = await import("tsx/esm/api");
register();
await import("./invoice-writer.worker.ts");
