import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OTA_MAX_ARTIFACT_BYTES } from "./lib/contract.mjs";

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 5_000;

function validateRelativePath(relativePath) {
  const segments = relativePath.split("/");
  if (
    /[\u0000-\u001F\u007F]/u.test(relativePath)
    || relativePath.length > 512
    || relativePath.startsWith("/")
    || relativePath.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.startsWith("."))
    || segments.includes("__MACOSX")
  ) throw new Error(`Unsafe artifact path: ${relativePath}`);
}

export function validateZipEntryNames(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("ZIP must contain files");
  for (const entry of entries) validateRelativePath(entry.replace(/\/$/u, ""));
}

export async function collectArtifactFiles(sourceDirectory) {
  const root = path.resolve(sourceDirectory);
  const files = [];
  let totalBytes = 0;

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      validateRelativePath(relativePath);
      const stats = await fs.lstat(absolutePath);
      if (stats.isSymbolicLink()) throw new Error(`Symlink is forbidden: ${relativePath}`);
      if (stats.isDirectory()) {
        await walk(absolutePath);
      } else if (stats.isFile()) {
        files.push(relativePath);
        totalBytes += stats.size;
        if (files.length > MAX_FILES || totalBytes > MAX_SOURCE_BYTES) throw new Error("Artifact source exceeds limits");
      } else {
        throw new Error(`Unsupported filesystem entry: ${relativePath}`);
      }
    }
  }

  await walk(root);
  files.sort();
  if (!files.includes("index.html")) throw new Error("dist/index.html is required");
  return files;
}

export async function stageArtifact(sourceDirectory, stageDirectory) {
  const files = await collectArtifactFiles(sourceDirectory);
  await fs.mkdir(stageDirectory, { recursive: true, mode: 0o755 });
  for (const relativePath of files) {
    const source = path.join(sourceDirectory, relativePath);
    const destination = path.join(stageDirectory, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
    await fs.copyFile(source, destination);
    await fs.chmod(destination, 0o644);
    const normalizedTime = new Date("1980-01-01T00:00:00.000Z");
    await fs.utimes(destination, normalizedTime, normalizedTime);
  }
  return files;
}

export async function createArtifactReceipt(artifactPath) {
  const stats = await fs.stat(artifactPath);
  if (!stats.isFile() || stats.size < 1 || stats.size > OTA_MAX_ARTIFACT_BYTES) {
    throw new Error("ZIP size is invalid");
  }
  const bytes = await fs.readFile(artifactPath);
  if (bytes.byteLength !== stats.size) throw new Error("ZIP changed while hashing");
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
  };
}

async function main() {
  const [command, firstPath, secondPath] = process.argv.slice(2);
  if (command === "stage" && firstPath && secondPath) {
    const files = await stageArtifact(firstPath, secondPath);
    process.stdout.write(`${JSON.stringify({ files: files.length })}\n`);
    return;
  }
  if (command === "receipt" && firstPath) {
    process.stdout.write(`${JSON.stringify(await createArtifactReceipt(firstPath))}\n`);
    return;
  }
  if (command === "validate-entries" && firstPath) {
    const text = await fs.readFile(firstPath, "utf8");
    if (!text.endsWith("\n")) throw new Error("Entry list must end with a newline");
    validateZipEntryNames(text.slice(0, -1).split("\n"));
    return;
  }
  throw new Error("Usage: build-artifact.mjs stage <dist> <stage> | receipt <zip> | validate-entries <file>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
