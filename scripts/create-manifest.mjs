import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSignedEnvelope, verifySignedEnvelope } from "./lib/contract.mjs";

export async function createManifestFile({
  payload,
  outputPath,
  privateKeyPem,
  publicKeySpkiBase64,
}) {
  const envelope = createSignedEnvelope({ payload, privateKeyPem });
  verifySignedEnvelope({ envelope, publicKeySpkiBase64 });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(envelope)}\n`, { encoding: "utf8", mode: 0o644 });
  return { outputPath };
}

async function main() {
  const [payloadPath, outputPath, publicKeySpkiBase64] = process.argv.slice(2);
  const privateKeyPem = process.env.OTA_SIGNING_PRIVATE_KEY_PEM;
  if (!payloadPath || !outputPath || !publicKeySpkiBase64 || !privateKeyPem) {
    throw new Error("Usage: create-manifest.mjs <payload.json> <output.json> <public-spki-base64>");
  }
  const payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));
  await createManifestFile({ payload, outputPath, privateKeyPem, publicKeySpkiBase64 });
  process.stdout.write(`${JSON.stringify({ outputPath })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
