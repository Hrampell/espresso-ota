import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workflowPath = path.resolve(".github/workflows/deploy-production.yml");

test("production OTA workflow is manual-only and explicitly confirmed", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  assert.match(source, /^on:\n  workflow_dispatch:/mu);
  assert.doesNotMatch(source, /^\s+(?:push|pull_request|schedule|repository_dispatch):/mu);
  assert.match(source, /confirm:\n\s+description:[^\n]+\n\s+required: true/u);
  assert.match(source, /INPUT_CONFIRM:[^\n]+inputs\.confirm/u);
  assert.match(source, /validate-deployment\.mjs/u);
});

test("workflow has narrow permissions, one deployment lane, and pinned actions", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  assert.match(source, /permissions:\n  contents: write/u);
  assert.match(source, /concurrency:\n  group: espresso-ota-production\n  cancel-in-progress: false/u);
  assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
  assert.match(source, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/u);
  assert.match(source, /APP_REPO_DEPLOY_KEY/u);
  assert.doesNotMatch(source, /pull-requests:\s*write|issues:\s*write|id-token:\s*write/u);
});

test("release asset verification happens before the production pointer commit", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const releaseIndex = source.indexOf("gh release create");
  const assetVerificationIndex = source.indexOf("release_asset_verified=true");
  const pointerIndex = source.indexOf("cp \"$SIGNED_MANIFEST\" v1/production.json");
  const publicVerificationIndex = source.indexOf("verify-publication.mjs");
  assert.ok(releaseIndex >= 0);
  assert.ok(assetVerificationIndex > releaseIndex);
  assert.ok(pointerIndex > assetVerificationIndex);
  assert.ok(publicVerificationIndex > pointerIndex);
  assert.match(source, /rollback_pointer/u);
});

test("workflow cannot deploy backend or submit an App Store build", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  assert.doesNotMatch(source, /supabase\s+(?:db|functions|deploy|link)|altool|notarytool|xcrun\s+iTMSTransporter/u);
  assert.doesNotMatch(source, /OTA_SIGNING_PRIVATE_KEY_PEM[^\n]*(?:echo|cat|printf)/u);
});

test("no production pointer is committed before the updater-enabled native build is live", () => {
  assert.equal(fs.existsSync(path.resolve("v1/production.json")), false);
});
