import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertAllowedSourcePaths } from "./lib/contract.mjs";

async function main() {
  const [changedPathsFile] = process.argv.slice(2);
  if (!changedPathsFile) throw new Error("Usage: validate-source.mjs <nul-delimited-paths>");
  const bytes = await fs.readFile(changedPathsFile);
  if (bytes.byteLength === 0 || bytes.at(-1) !== 0) throw new Error("Changed paths must be NUL-delimited");
  const paths = bytes.toString("utf8").slice(0, -1).split("\0");
  assertAllowedSourcePaths(paths);
  process.stdout.write(`${JSON.stringify({ files: paths.length })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
