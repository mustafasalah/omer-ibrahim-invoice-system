import "server-only";

import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "./env";

export type DataDirectories = Readonly<{
  root: string;
  database: string;
  logs: string;
  media: string;
}>;

export function ensureDataDirectories(config: Pick<AppConfig, "dataDir">): DataDirectories {
  const directories: DataDirectories = {
    root: config.dataDir,
    database: path.join(config.dataDir, "database"),
    logs: path.join(config.dataDir, "logs"),
    media: path.join(config.dataDir, "media"),
  };

  for (const directory of Object.values(directories)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });

    if (process.platform !== "win32") {
      chmodSync(directory, 0o700);
    }
  }

  return directories;
}
