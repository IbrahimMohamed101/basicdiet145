"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.join(__dirname, "..", "src", "index.js");
const source = fs.readFileSync(indexPath, "utf8");

function positionOf(fragment) {
  const index = source.indexOf(fragment);
  assert.notStrictEqual(index, -1, `Missing startup fragment: ${fragment}`);
  return index;
}

function testSafetyRunsBeforeInstallers() {
  const safetyCall = positionOf("assertSubscriptionStackingProductionSafety(process.env)");
  const rolloutCall = positionOf("assertSubscriptionStackingRolloutConfiguration(process.env)");
  const firstInstaller = positionOf('require("./services/installSubscriptionStackingUnsupportedActionGuards")');
  assert(safetyCall < rolloutCall, "production safety must run before rollout validation");
  assert(rolloutCall < firstInstaller, "rollout validation must run before stacking installers");
}

function testIncompleteRoutersRemainDisconnected() {
  assert.strictEqual(
    source.includes("installSubscriptionStackingPlannedPickupRouter"),
    false,
    "planned pickup must remain disconnected until ownership binding is approved"
  );
  assert.strictEqual(
    source.includes("installSubscriptionStackingSkipRouter"),
    false,
    "atomic skip router must remain disconnected until remote staging validation"
  );
}

function testNoStartupFlagMutation() {
  const forbiddenAssignments = [
    /process\.env\.SUBSCRIPTION_STACKING_SHADOW_ENABLED\s*=/,
    /process\.env\.SUBSCRIPTION_STACKING_READ_ENABLED\s*=/,
    /process\.env\.SUBSCRIPTION_STACKING_WRITE_ENABLED\s*=/,
    /process\.env\.SUBSCRIPTION_STACKING_USER_IDS\s*=/,
  ];
  for (const pattern of forbiddenAssignments) {
    assert.strictEqual(pattern.test(source), false, `startup must not mutate rollout flags: ${pattern}`);
  }
}

function run() {
  testSafetyRunsBeforeInstallers();
  testIncompleteRoutersRemainDisconnected();
  testNoStartupFlagMutation();
  console.log("subscription stacking startup isolation tests passed");
}

run();
