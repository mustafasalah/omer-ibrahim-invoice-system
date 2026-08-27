import { checkDatabase, getDatabase } from "@/server/db/connection";
import { getConfig, toConfigDiagnostic } from "@/server/config/env";

const connection = getDatabase();
const result = {
  config: toConfigDiagnostic(getConfig()),
  database: checkDatabase(connection),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
connection.client.close();
