import { getDatabase } from "@/server/db/connection";

const connection = getDatabase();
process.stdout.write(`Database migrations applied: ${connection.databasePath}\n`);
connection.client.close();
