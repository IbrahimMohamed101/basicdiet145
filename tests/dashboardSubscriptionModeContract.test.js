"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  resolveDashboardSubscriptionMode,
} = require("../src/services/installDashboardSubscriptionStackingFlow");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

assert.strictEqual(
  resolveDashboardSubscriptionMode({ dashboardSubscriptionMode: "standalone" }),
  "standalone"
);
assert.strictEqual(
  resolveDashboardSubscriptionMode({ dashboardSubscriptionMode: "stack_into_current" }),
  "stack_into_current"
);
assert.strictEqual(
  resolveDashboardSubscriptionMode({}),
  "legacy"
);

const controllerSource = read("src/controllers/adminController.js");
assert.ok(controllerSource.includes("normalizeDashboardSubscriptionMode"));
assert.ok(controllerSource.includes("contract.dashboardSubscriptionMode = body.subscriptionMode"));
assert.ok(controllerSource.includes("STANDALONE_ACTIVE_SUBSCRIPTION_CONFLICT"));

const stackingSource = read(
  "src/services/installDashboardSubscriptionStackingFlow.js"
);
assert.ok(stackingSource.includes("STACK_TARGET_NOT_FOUND"));
assert.ok(stackingSource.includes("resolveDashboardSubscriptionMode"));

console.log("dashboard subscription mode contract tests passed");
