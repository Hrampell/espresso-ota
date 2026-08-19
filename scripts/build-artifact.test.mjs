import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectArtifactFiles,
  createArtifactReceipt,
  validateZipEntryNames,
} from "./build-artifact.mjs";

test("collects only regular dist files and requires index.html", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "espresso-ota-dist-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, "assets"));
  await fs.writeFile(path.join(directory, "index.html"), "<html></html>");
  await fs.writeFile(path.join(directory, "assets/app.js"), "console.log('ok')");

  assert.deepEqual(await collectArtifactFiles(directory), ["assets/app.js", "index.html"]);
});

test("rejects missing index, symlinks, hidden metadata, and excessive file counts", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "espresso-ota-invalid-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "app.js"), "ok");
  await assert.rejects(collectArtifactFiles(directory));

  await fs.writeFile(path.join(directory, "index.html"), "ok");
  await fs.symlink(path.join(directory, "index.html"), path.join(directory, "linked.html"));
  await assert.rejects(collectArtifactFiles(directory));
});

test("rejects unsafe ZIP entry names", () => {
  assert.doesNotThrow(() => validateZipEntryNames(["index.html", "assets/app.js"]));
  for (const entry of [
    "../secret",
    "/absolute",
    "assets\\windows.js",
    "assets//double.js",
    "./index.html",
    "assets/.hidden",
    "__MACOSX/file",
    ".DS_Store",
  ]) {
    assert.throws(() => validateZipEntryNames([entry]), entry);
  }
});

test("computes an exact SHA-256 receipt and enforces the 25 MiB cap", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "espresso-ota-receipt-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, "bundle.zip");
  await fs.writeFile(artifact, "espresso");

  assert.deepEqual(await createArtifactReceipt(artifact), {
    sha256: "3c4ef966f728d7c0542941c369fbcdd089f8d7f7837b6d42dc2cbd6adaf68158",
    sizeBytes: 8,
  });

  const oversized = path.join(directory, "oversized.zip");
  await fs.writeFile(oversized, "x");
  await fs.truncate(oversized, 25 * 1024 * 1024 + 1);
  await assert.rejects(createArtifactReceipt(oversized));
});
