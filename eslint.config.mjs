import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(repositoryRoot, "src", "server");

function isServerImport(filename, importSource) {
  if (importSource === "@/server" || importSource.startsWith("@/server/")) {
    return true;
  }

  if (!importSource.startsWith(".")) {
    return false;
  }

  const resolvedImport = path.resolve(path.dirname(filename), importSource);
  return resolvedImport === serverRoot || resolvedImport.startsWith(`${serverRoot}${path.sep}`);
}

const boundariesPlugin = {
  rules: {
    "no-server-import-in-client": {
      meta: {
        type: "problem",
        docs: {
          description: "Prevents server modules from entering a client component graph.",
        },
        messages: {
          serverImport: "Client Components must not import src/server modules.",
        },
        schema: [],
      },
      create(context) {
        let isClientComponent = false;

        return {
          Program(node) {
            isClientComponent = node.body.some(
              (statement) =>
                statement.type === "ExpressionStatement" &&
                statement.directive === "use client",
            );
          },
          ImportDeclaration(node) {
            if (
              isClientComponent &&
              typeof node.source.value === "string" &&
              isServerImport(context.filename, node.source.value)
            ) {
              context.report({ node, messageId: "serverImport" });
            }
          },
          ImportExpression(node) {
            if (
              isClientComponent &&
              node.source.type === "Literal" &&
              typeof node.source.value === "string" &&
              isServerImport(context.filename, node.source.value)
            ) {
              context.report({ node, messageId: "serverImport" });
            }
          },
        };
      },
    },
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    plugins: {
      boundaries: boundariesPlugin,
    },
    rules: {
      "boundaries/no-server-import-in-client": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "data/**",
    "drizzle/meta/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
