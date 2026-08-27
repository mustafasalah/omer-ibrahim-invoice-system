import "server-only";

import { insertDefaultSettings } from "@/server/settings/defaults";
import type { DatabaseConnection } from "./connection";
import { withImmediateTransaction } from "./transaction";

export function seedDevelopmentSettings(connection: DatabaseConnection, now: string): void {
  withImmediateTransaction(connection.client, () => insertDefaultSettings(connection, now));
}
