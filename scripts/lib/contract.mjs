import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

export const OTA_KEY_ID = "espresso-ota-p256-2026-01";
export const OTA_NATIVE_VERSION = "1.3.3";
export const OTA_NATIVE_BUILD = 11;
export const OTA_MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
export const OTA_MAX_MANIFEST_BYTES = 256 * 1024;
export const OTA_RELEASE_PREFIX = "https://github.com/Hrampell/espresso-ota/releases/download/";

const KINDS = new Set(["bugfix", "style", "copy", "asset"]);
const ENVELOPE_KEYS = ["schemaVersion", "keyId", "payload", "signature"];
const PAYLOAD_KEYS = [
  "schemaVersion",
  "channel",
  "sequence",
  "bundleVersion",
  "sourceCommit",
  "kind",
  "nativeCompatibility",
  "artifact",
  "publishedAt",
];
const DEPLOYMENT_INPUT_KEYS = ["sourceSha", "sequence", "bundleVersion", "kind", "note", "confirm"];

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unexpected keys`);
  }
}

function parsePositiveInteger(value, label) {
  const text = String(value);
  if (!/^[1-9]\d*$/u.test(text)) throw new Error(`${label} must be a canonical positive integer`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} is out of range`);
  return number;
}

export function validateDeploymentInputs(input) {
  assertExactKeys(input, DEPLOYMENT_INPUT_KEYS, "deployment inputs");
  if (!/^[0-9a-f]{40}$/u.test(input.sourceSha ?? "")) throw new Error("Invalid source SHA");
  const sequence = parsePositiveInteger(input.sequence, "sequence");
  if (input.bundleVersion !== `${OTA_NATIVE_VERSION}-ota.${sequence}`) {
    throw new Error("Bundle version and sequence do not match");
  }
  if (!KINDS.has(input.kind)) throw new Error("Invalid OTA kind");
  if (
    typeof input.note !== "string"
    || input.note.length < 1
    || input.note.length > 200
    || !/^[\x20-\x7E]+$/u.test(input.note)
  ) throw new Error("Invalid deployment note");
  if (input.confirm !== "DEPLOY") throw new Error("Explicit DEPLOY confirmation is required");
  return { ...input, sequence };
}

export function assertAllowedSourcePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("At least one changed path is required");
  for (const filePath of paths) {
    if (
      typeof filePath !== "string"
      || filePath.startsWith("/")
      || filePath.includes("\\")
      || filePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) throw new Error(`Unsafe changed path: ${filePath}`);
    const allowed = filePath === "index.html"
      || filePath.startsWith("src/")
      || filePath.startsWith("public/");
    if (!allowed) throw new Error(`Native or operational path is not OTA-eligible: ${filePath}`);
  }
}

function expectedArtifactUrl(bundleVersion) {
  return `${OTA_RELEASE_PREFIX}ota-${bundleVersion}/espresso-shot-log-${bundleVersion}.zip`;
}

export function validatePayload(payload) {
  assertExactKeys(payload, PAYLOAD_KEYS, "payload");
  if (payload.schemaVersion !== 1 || payload.channel !== "production") throw new Error("Unsupported payload protocol");
  if (typeof payload.sequence !== "number") throw new Error("Payload sequence must be numeric");
  const sequence = parsePositiveInteger(payload.sequence, "payload sequence");
  if (payload.bundleVersion !== `${OTA_NATIVE_VERSION}-ota.${sequence}`) throw new Error("Invalid bundle version");
  if (!/^[0-9a-f]{40}$/u.test(payload.sourceCommit)) throw new Error("Invalid source commit");
  if (!KINDS.has(payload.kind)) throw new Error("Invalid payload kind");
  assertExactKeys(payload.nativeCompatibility, ["version", "minimumBuild", "maximumBuild"], "compatibility");
  if (
    payload.nativeCompatibility.version !== OTA_NATIVE_VERSION
    || payload.nativeCompatibility.minimumBuild !== OTA_NATIVE_BUILD
    || payload.nativeCompatibility.maximumBuild !== OTA_NATIVE_BUILD
  ) throw new Error("Invalid native compatibility");
  assertExactKeys(payload.artifact, ["url", "sha256", "sizeBytes"], "artifact");
  if (payload.artifact.url !== expectedArtifactUrl(payload.bundleVersion)) throw new Error("Invalid artifact URL");
  if (!/^[0-9a-f]{64}$/u.test(payload.artifact.sha256)) throw new Error("Invalid artifact digest");
  if (typeof payload.artifact.sizeBytes !== "number") throw new Error("Artifact size must be numeric");
  const sizeBytes = parsePositiveInteger(payload.artifact.sizeBytes, "artifact size");
  if (sizeBytes > OTA_MAX_ARTIFACT_BYTES) throw new Error("Artifact exceeds size cap");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(payload.publishedAt)) {
    throw new Error("Invalid publication timestamp");
  }
  const timestamp = Date.parse(payload.publishedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== payload.publishedAt) {
    throw new Error("Non-canonical publication timestamp");
  }
  return payload;
}

function decodeCanonicalBase64Url(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw new Error(`Invalid ${label}`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error(`Non-canonical ${label}`);
  return bytes;
}

function importPrivateKey(privateKeyPem) {
  if (typeof privateKeyPem !== "string" && !Buffer.isBuffer(privateKeyPem)) throw new Error("Missing signing key");
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Signing key must be ECDSA P-256");
  }
  return key;
}

function importPublicKey(publicKeySpkiBase64) {
  if (
    typeof publicKeySpkiBase64 !== "string"
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(publicKeySpkiBase64)
    || publicKeySpkiBase64.length % 4 !== 0
  ) throw new Error("Invalid public key encoding");
  const bytes = Buffer.from(publicKeySpkiBase64, "base64");
  if (bytes.toString("base64") !== publicKeySpkiBase64) throw new Error("Non-canonical public key encoding");
  const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Verification key must be ECDSA P-256");
  }
  return key;
}

export function createSignedEnvelope({ payload, privateKeyPem }) {
  validatePayload(payload);
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  if (payloadBytes.byteLength > OTA_MAX_MANIFEST_BYTES) throw new Error("Payload exceeds size cap");
  const signature = sign("sha256", payloadBytes, {
    key: importPrivateKey(privateKeyPem),
    dsaEncoding: "ieee-p1363",
  });
  if (signature.byteLength !== 64) throw new Error("Unexpected signature length");
  return {
    schemaVersion: 1,
    keyId: OTA_KEY_ID,
    payload: payloadBytes.toString("base64url"),
    signature: signature.toString("base64url"),
  };
}

export function verifySignedEnvelope({ envelope, publicKeySpkiBase64 }) {
  assertExactKeys(envelope, ENVELOPE_KEYS, "envelope");
  if (envelope.schemaVersion !== 1 || envelope.keyId !== OTA_KEY_ID) throw new Error("Unsupported envelope");
  const payloadBytes = decodeCanonicalBase64Url(envelope.payload, "payload");
  const signatureBytes = decodeCanonicalBase64Url(envelope.signature, "signature");
  if (signatureBytes.byteLength !== 64 || payloadBytes.byteLength > OTA_MAX_MANIFEST_BYTES) {
    throw new Error("Invalid signed envelope size");
  }
  if (!verify("sha256", payloadBytes, {
    key: importPublicKey(publicKeySpkiBase64),
    dsaEncoding: "ieee-p1363",
  }, signatureBytes)) throw new Error("Manifest signature is invalid");
  const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  return validatePayload(payload);
}
