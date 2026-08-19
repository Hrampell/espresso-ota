import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  assertAllowedSourcePaths,
  createSignedEnvelope,
  validateDeploymentInputs,
  verifySignedEnvelope,
} from "./contract.mjs";

const validInputs = {
  sourceSha: "0123456789abcdef0123456789abcdef01234567",
  sequence: "4",
  bundleVersion: "1.3.3-ota.4",
  kind: "bugfix",
  note: "Fix the existing bean list loading state",
  confirm: "DEPLOY",
};

function payload() {
  return {
    schemaVersion: 1,
    channel: "production",
    sequence: 4,
    bundleVersion: "1.3.3-ota.4",
    sourceCommit: validInputs.sourceSha,
    kind: "bugfix",
    nativeCompatibility: {
      version: "1.3.3",
      minimumBuild: 11,
      maximumBuild: 11,
    },
    artifact: {
      url: "https://github.com/Hrampell/espresso-ota/releases/download/ota-1.3.3-ota.4/espresso-shot-log-1.3.3-ota.4.zip",
      sha256: "a".repeat(64),
      sizeBytes: 500_000,
    },
    publishedAt: "2026-08-18T19:00:00.000Z",
  };
}

test("accepts exact explicit production deployment inputs", () => {
  assert.deepEqual(validateDeploymentInputs(validInputs), {
    ...validInputs,
    sequence: 4,
  });
});

test("rejects malformed or unsafe deployment inputs", () => {
  const mutations = [
    { sourceSha: "ABC" },
    { sequence: "0", bundleVersion: "1.3.3-ota.0" },
    { sequence: "04" },
    { sequence: "5" },
    { bundleVersion: "1.3.3-ota.5" },
    { kind: "feature" },
    { note: "" },
    { note: "contains\na newline" },
    { note: "x".repeat(201) },
    { confirm: "deploy" },
    { extra: true },
  ];
  for (const mutation of mutations) {
    assert.throws(() => validateDeploymentInputs({ ...validInputs, ...mutation }));
  }
});

test("allows only built web source paths", () => {
  assert.doesNotThrow(() => assertAllowedSourcePaths([
    "src/pages/Beans.tsx",
    "src/index.css",
    "public/icon.png",
    "index.html",
  ]));

  for (const path of [
    "package.json",
    "package-lock.json",
    "capacitor.config.ts",
    "ios/App/App.xcodeproj/project.pbxproj",
    "android/app/build.gradle",
    "supabase/migrations/change.sql",
    "scripts/deploy.mjs",
    ".github/workflows/deploy.yml",
    ".env.production",
    "vite.config.ts",
    "tsconfig.app.json",
  ]) {
    assert.throws(() => assertAllowedSourcePaths([path]), path);
  }
});

test("creates and verifies an exact P-256 signed envelope", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeySpkiBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  const envelope = createSignedEnvelope({ payload: payload(), privateKeyPem });
  assert.deepEqual(verifySignedEnvelope({ envelope, publicKeySpkiBase64 }), payload());
  assert.deepEqual(Object.keys(envelope), ["schemaVersion", "keyId", "payload", "signature"]);
  assert.equal(Buffer.from(envelope.signature, "base64url").byteLength, 64);
});

test("requires numeric payload integers rather than string-shaped values", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  assert.throws(() => createSignedEnvelope({
    payload: { ...payload(), sequence: "4" },
    privateKeyPem,
  }));
  assert.throws(() => createSignedEnvelope({
    payload: { ...payload(), artifact: { ...payload().artifact, sizeBytes: "500000" } },
    privateKeyPem,
  }));
});

test("rejects tampering, extra keys, and the obsolete unsigned format", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeySpkiBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const envelope = createSignedEnvelope({ payload: payload(), privateKeyPem });

  assert.throws(() => verifySignedEnvelope({
    envelope: {
      ...envelope,
      signature: `${envelope.signature.slice(0, -1)}${envelope.signature.endsWith("A") ? "B" : "A"}`,
    },
    publicKeySpkiBase64,
  }));
  assert.throws(() => verifySignedEnvelope({
    envelope: { ...envelope, extra: true },
    publicKeySpkiBase64,
  }));
  assert.throws(() => verifySignedEnvelope({
    envelope: { version: "1.1.2", url: "https://example.invalid" },
    publicKeySpkiBase64,
  }));
});
