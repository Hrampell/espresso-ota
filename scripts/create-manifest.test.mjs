import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createManifestFile } from "./create-manifest.mjs";
import { verifySignedEnvelope } from "./lib/contract.mjs";

test("writes a self-verified signed manifest without returning private material", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "espresso-ota-manifest-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeySpkiBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const payload = {
    schemaVersion: 1,
    channel: "production",
    sequence: 1,
    bundleVersion: "1.3.3-ota.1",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    kind: "copy",
    nativeCompatibility: { version: "1.3.3", minimumBuild: 11, maximumBuild: 11 },
    artifact: {
      url: "https://github.com/Hrampell/espresso-ota/releases/download/ota-1.3.3-ota.1/espresso-shot-log-1.3.3-ota.1.zip",
      sha256: "b".repeat(64),
      sizeBytes: 1_000,
    },
    publishedAt: "2026-08-18T19:00:00.000Z",
  };
  const outputPath = path.join(directory, "production.json");

  const result = await createManifestFile({
    payload,
    outputPath,
    privateKeyPem,
    publicKeySpkiBase64,
  });
  const envelope = JSON.parse(await fs.readFile(outputPath, "utf8"));

  assert.deepEqual(verifySignedEnvelope({ envelope, publicKeySpkiBase64 }), payload);
  assert.deepEqual(result, { outputPath });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY/u);
});
