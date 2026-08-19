import assert from "node:assert/strict";
import test from "node:test";

import { createPayload } from "./create-payload.mjs";

test("creates the exact production payload from validated workflow facts", () => {
  assert.deepEqual(createPayload({
    inputs: {
      sourceSha: "0123456789abcdef0123456789abcdef01234567",
      sequence: "5",
      bundleVersion: "1.3.3-ota.5",
      kind: "style",
      note: "Polish existing bean cards",
      confirm: "DEPLOY",
    },
    receipt: { sha256: "a".repeat(64), sizeBytes: 500_000 },
    publishedAt: "2026-08-18T19:00:00.000Z",
  }), {
    schemaVersion: 1,
    channel: "production",
    sequence: 5,
    bundleVersion: "1.3.3-ota.5",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    kind: "style",
    nativeCompatibility: { version: "1.3.3", minimumBuild: 11, maximumBuild: 11 },
    artifact: {
      url: "https://github.com/Hrampell/espresso-ota/releases/download/ota-1.3.3-ota.5/espresso-shot-log-1.3.3-ota.5.zip",
      sha256: "a".repeat(64),
      sizeBytes: 500_000,
    },
    publishedAt: "2026-08-18T19:00:00.000Z",
  });
});
