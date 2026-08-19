import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OTA_NATIVE_BUILD,
  OTA_NATIVE_VERSION,
  validateDeploymentInputs,
  validatePayload,
} from "./lib/contract.mjs";

export function createPayload({ inputs, receipt, publishedAt }) {
  const validated = validateDeploymentInputs(inputs);
  if (
    !receipt
    || typeof receipt !== "object"
    || Array.isArray(receipt)
    || Object.keys(receipt).sort().join(",") !== "sha256,sizeBytes"
  ) throw new Error("Invalid artifact receipt");

  return validatePayload({
    schemaVersion: 1,
    channel: "production",
    sequence: validated.sequence,
    bundleVersion: validated.bundleVersion,
    sourceCommit: validated.sourceSha,
    kind: validated.kind,
    nativeCompatibility: {
      version: OTA_NATIVE_VERSION,
      minimumBuild: OTA_NATIVE_BUILD,
      maximumBuild: OTA_NATIVE_BUILD,
    },
    artifact: {
      url: `https://github.com/Hrampell/espresso-ota/releases/download/ota-${validated.bundleVersion}/espresso-shot-log-${validated.bundleVersion}.zip`,
      sha256: receipt.sha256,
      sizeBytes: receipt.sizeBytes,
    },
    publishedAt,
  });
}

function workflowInputsFromEnvironment() {
  return {
    sourceSha: process.env.INPUT_SOURCE_SHA,
    sequence: process.env.INPUT_SEQUENCE,
    bundleVersion: process.env.INPUT_BUNDLE_VERSION,
    kind: process.env.INPUT_KIND,
    note: process.env.INPUT_NOTE,
    confirm: process.env.INPUT_CONFIRM,
  };
}

async function main() {
  const [receiptPath, outputPath] = process.argv.slice(2);
  if (!receiptPath || !outputPath) {
    throw new Error("Usage: create-payload.mjs <receipt.json> <payload.json>");
  }
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  const payload = createPayload({
    inputs: workflowInputsFromEnvironment(),
    receipt,
    publishedAt: new Date().toISOString(),
  });
  await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o644 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
