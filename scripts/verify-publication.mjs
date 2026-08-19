import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OTA_MAX_ARTIFACT_BYTES,
  OTA_MAX_MANIFEST_BYTES,
  verifySignedEnvelope,
} from "./lib/contract.mjs";

async function readBounded(response, maximumBytes) {
  if (!response.ok || response.status !== 200) throw new Error(`Unexpected HTTP status ${response.status}`);
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximumBytes)) {
    throw new Error("Response exceeds size cap");
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error("Response exceeds size cap");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("response_too_large");
        throw new Error("Response exceeds size cap");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function verifyPublication({ manifestUrl, publicKeySpkiBase64, fetcher = fetch }) {
  if (manifestUrl !== "https://hrampell.github.io/espresso-ota/v1/production.json") {
    throw new Error("Unexpected production manifest URL");
  }
  const manifestRequestInit = {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  };
  const manifestResponse = await fetcher(manifestUrl, manifestRequestInit);
  const manifestContentType = manifestResponse.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (manifestContentType !== "application/json") throw new Error("Manifest content type is invalid");
  const manifestBytes = await readBounded(manifestResponse, OTA_MAX_MANIFEST_BYTES);
  const envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  const payload = verifySignedEnvelope({ envelope, publicKeySpkiBase64 });

  const artifactResponse = await fetcher(payload.artifact.url, {
    ...manifestRequestInit,
    redirect: "follow",
  });
  const artifactBytes = await readBounded(artifactResponse, OTA_MAX_ARTIFACT_BYTES);
  if (artifactBytes.byteLength !== payload.artifact.sizeBytes) throw new Error("Artifact size mismatch");
  const digest = createHash("sha256").update(artifactBytes).digest("hex");
  if (digest !== payload.artifact.sha256) throw new Error("Artifact digest mismatch");
  return { bundleVersion: payload.bundleVersion, sourceCommit: payload.sourceCommit };
}

async function main() {
  const [manifestUrl, publicKeySpkiBase64] = process.argv.slice(2);
  if (!manifestUrl || !publicKeySpkiBase64) {
    throw new Error("Usage: verify-publication.mjs <manifest-url> <public-spki-base64>");
  }
  process.stdout.write(`${JSON.stringify(await verifyPublication({ manifestUrl, publicKeySpkiBase64 }))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
