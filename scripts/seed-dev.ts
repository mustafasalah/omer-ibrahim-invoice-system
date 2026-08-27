import { getConfig } from "@/server/config/env";
import { getDatabase } from "@/server/db/connection";
import { seedDevelopmentSettings } from "@/server/db/seed";

const config = getConfig();

if (config.environment === "production") {
  throw new Error("Development seed is disabled in production.");
}

const connection = getDatabase();
const now = new Date().toISOString();
seedDevelopmentSettings(connection, now);

process.stdout.write("Development settings seed is present.\n");
connection.client.close();
