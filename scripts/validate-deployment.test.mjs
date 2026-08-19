import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { createSignedEnvelope } from "./lib/contract.mjs";
import { validateDeployment } from "./validate-deployment.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKeySpkiBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");

const baseline = {
  schemaVersion: 1,
  appRepository: "Hrampell/espressoshotlogapp",
  releaseBranch: "main",
  nativeVersion: "1.3.3",
  nativeBuild: 11,
  baselineCommit: "a".repeat(40),
  keyId: "espresso-ota-p256-2026-01",
  publicKeySpkiBase64,
};

const inputs = {
  sourceSha: "b".repeat(40),
  sequence: "2",
  bundleVersion: "1.3.3-ota.2",
  kind: "bugfix",
  note: "Fix existing photo rendering",
  confirm: "DEPLOY",
};

function envelopeFor(sequence) {
  return createSignedEnvelope({
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }),
    payload: {
      schemaVersion: 1,
      channel: "production",
      sequence,
      bundleVersion: `1.3.3-ota.${sequence}`,
      sourceCommit: "c".repeat(40),
      kind: "bugfix",
      nativeCompatibility: { version: "1.3.3", minimumBuild: 11, maximumBuild: 11 },
      artifact: {
        url: `https://github.com/Hrampell/espresso-ota/releases/download/ota-1.3.3-ota.${sequence}/espresso-shot-log-1.3.3-ota.${sequence}.zip`,
        sha256: "d".repeat(64),
        sizeBytes: 123,
      },
      publishedAt: "2026-08-18T19:00:00.000Z",
    },
  });
}

test("accepts the first sequence and a strictly newer signed sequence", () => {
  assert.equal(validateDeployment({ inputs: { ...inputs, sequence: "1", bundleVersion: "1.3.3-ota.1" }, baseline }), 1);
  assert.equal(validateDeployment({ inputs, baseline, currentEnvelope: envelopeFor(1) }), 2);
});

test("rejects replay, gaps in trust configuration, and malformed baselines", () => {
  assert.throws(() => validateDeployment({ inputs, baseline, currentEnvelope: envelopeFor(2) }), /newer/u);
  assert.throws(() => validateDeployment({ inputs, baseline: { ...baseline, nativeBuild: 12 } }), /baseline/u);
  assert.throws(() => validateDeployment({ inputs, baseline: { ...baseline, extra: true } }), /baseline/u);
  assert.throws(() => validateDeployment({ inputs: { ...inputs, sequence: "3", bundleVersion: "1.3.3-ota.3" }, baseline }), /first/u);
});
