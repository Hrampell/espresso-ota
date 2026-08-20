import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { createSignedEnvelope } from "./lib/contract.mjs";
import { verifyPublication } from "./verify-publication.mjs";

function fixture() {
  const artifact = Buffer.from("signed espresso bundle");
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeySpkiBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const bundleVersion = "1.3.3-ota.3";
  const payload = {
    schemaVersion: 1,
    channel: "production",
    sequence: 3,
    bundleVersion,
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    kind: "asset",
    nativeCompatibility: { version: "1.3.3", minimumBuild: 11, maximumBuild: 11 },
    artifact: {
      url: `https://github.com/Hrampell/espresso-ota/releases/download/ota-${bundleVersion}/espresso-shot-log-${bundleVersion}.zip`,
      sha256: createHash("sha256").update(artifact).digest("hex"),
      sizeBytes: artifact.byteLength,
    },
    publishedAt: "2026-08-18T19:00:00.000Z",
  };
  return {
    artifact,
    publicKeySpkiBase64,
    manifest: JSON.stringify(createSignedEnvelope({ payload, privateKeyPem })),
    payload,
  };
}

test("verifies the public signed pointer and immutable release bytes", async () => {
  const data = fixture();
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) {
      return new Response(data.manifest, { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(data.artifact, { status: 200, headers: { "content-type": "application/zip" } });
  };

  await assert.doesNotReject(verifyPublication({
    manifestUrl: "https://hrampell.github.io/espresso-ota/v1/production.json",
    publicKeySpkiBase64: data.publicKeySpkiBase64,
    expectedBundleVersion: data.payload.bundleVersion,
    expectedSourceCommit: data.payload.sourceCommit,
    fetcher,
  }));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(requests[0].init.credentials, "omit");
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  assert.ok(requests[1].init.signal instanceof AbortSignal);
  assert.equal(requests[1].url, data.payload.artifact.url);
});

test("rejects a previous valid pointer while the expected deployment is still propagating", async () => {
  const data = fixture();
  let call = 0;
  const fetcher = async () => {
    call += 1;
    return call === 1
      ? new Response(data.manifest, { status: 200, headers: { "content-type": "application/json" } })
      : new Response(data.artifact, { status: 200, headers: { "content-type": "application/zip" } });
  };

  await assert.rejects(verifyPublication({
    manifestUrl: "https://hrampell.github.io/espresso-ota/v1/production.json",
    publicKeySpkiBase64: data.publicKeySpkiBase64,
    expectedBundleVersion: "1.3.3-ota.4",
    expectedSourceCommit: "fedcba9876543210fedcba9876543210fedcba98",
    fetcher,
  }), /expected deployment/i);
});

test("rejects wrong artifact bytes and never reports a false success", async () => {
  const data = fixture();
  let call = 0;
  const fetcher = async () => {
    call += 1;
    return call === 1
      ? new Response(data.manifest, { status: 200, headers: { "content-type": "application/json" } })
      : new Response("tampered", { status: 200, headers: { "content-type": "application/zip" } });
  };

  await assert.rejects(verifyPublication({
    manifestUrl: "https://hrampell.github.io/espresso-ota/v1/production.json",
    publicKeySpkiBase64: data.publicKeySpkiBase64,
    expectedBundleVersion: data.payload.bundleVersion,
    expectedSourceCommit: data.payload.sourceCommit,
    fetcher,
  }));
});
