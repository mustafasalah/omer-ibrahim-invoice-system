import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("client/server import boundary", () => {
  it(
    "reports direct server imports from Client Components",
    async () => {
      const eslint = new ESLint({ cwd: process.cwd() });
      const [result] = await eslint.lintText(
        `'use client';\nimport { getDatabase } from "@/server/db/connection";\nexport default function Fixture() { return null; }`,
        { filePath: path.join(process.cwd(), "src", "components", "client", "fixture.tsx") },
      );

      expect(result?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: "boundaries/no-server-import-in-client",
            severity: 2,
          }),
        ]),
      );
    },
    30_000,
  );
});
