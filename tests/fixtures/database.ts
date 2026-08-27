import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "@/server/db/connection";

export type TemporaryDatabase = {
  connection: DatabaseConnection;
  directory: string;
  dispose: () => void;
};

export function createTemporaryDatabase(): TemporaryDatabase {
  const temporaryRoot = path.resolve(tmpdir());
  const directory = mkdtempSync(path.join(temporaryRoot, "oims-test-"));
  const connection = openDatabase(path.join(directory, "test.sqlite"));
  migrateDatabase(connection, path.resolve(process.cwd(), "drizzle"));

  return {
    connection,
    directory,
    dispose() {
      connection.client.close();
      const resolvedDirectory = path.resolve(directory);
      const relative = path.relative(temporaryRoot, resolvedDirectory);

      if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
        throw new Error("Refusing to remove a directory outside the test temp root.");
      }

      rmSync(resolvedDirectory, { force: true, recursive: true });
    },
  };
}
