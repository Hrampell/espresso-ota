import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OTA_KEY_ID,
  OTA_NATIVE_BUILD,
  OTA_NATIVE_VERSION,
  validateDeploymentInputs,
  verifySignedEnvelope,
} from "./lib/contract.mjs";

const BASELINE_KEYS = [
  "schemaVersion",
  "appRepository",
  "releaseBranch",
  "nativeVersion",
  "nativeBuild",
  "baselineCommit",
  "keyId",
  "publicKeySpkiBase64",
];

function validateBaseline(baseline) {
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) throw new Error("Invalid baseline");
  const keys = Object.keys(baseline).sort();
  if (keys.length !== BASELINE_KEYS.length || keys.some((key, index) => key !== [...BASELINE_KEYS].sort()[index])) {
    throw new Error("Invalid baseline keys");
  }
  if (
    baseline.schemaVersion !== 1
    || baseline.appRepository !== "Hrampell/espressoshotlogapp"
    || baseline.releaseBranch !== "main"
    || baseline.nativeVersion !== OTA_NATIVE_VERSION
    || baseline.nativeBuild !== OTA_NATIVE_BUILD
    || !/^[0-9a-f]{40}$/u.test(baseline.baselineCommit)
    || baseline.keyId !== OTA_KEY_ID
    || typeof baseline.publicKeySpkiBase64 !== "string"
  ) throw new Error("Invalid baseline configuration");
  return baseline;
}

export function validateDeployment({ inputs, baseline, currentEnvelope }) {
  const validatedInputs = validateDeploymentInputs(inputs);
  const validatedBaseline = validateBaseline(baseline);
  if (currentEnvelope === undefined) {
    if (validatedInputs.sequence !== 1) throw new Error("The first production sequence must be 1");
    return validatedInputs.sequence;
  }
  const current = verifySignedEnvelope({
    envelope: currentEnvelope,
    publicKeySpkiBase64: validatedBaseline.publicKeySpkiBase64,
  });
  if (validatedInputs.sequence <= current.sequence) throw new Error("Sequence must be newer than production");
  return validatedInputs.sequence;
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
  const [baselinePath, pointerPath] = process.argv.slice(2);
  if (!baselinePath || !pointerPath) {
    throw new Error("Usage: validate-deployment.mjs <baseline.json> <production-pointer.json>");
  }
  const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
  let currentEnvelope;
  try {
    currentEnvelope = JSON.parse(await fs.readFile(pointerPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const sequence = validateDeployment({ inputs: workflowInputsFromEnvironment(), baseline, currentEnvelope });
  process.stdout.write(`${JSON.stringify({ sequence })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
