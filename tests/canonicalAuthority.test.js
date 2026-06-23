"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  canTransitionStatus,
  normalizeOperationalStatus,
} = require("../src/services/dashboard/opsTransitionPolicy");

const ROOT = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

assert.strictEqual(normalizeOperationalStatus("order", "preparing"), "in_preparation");
assert.strictEqual(canTransitionStatus("order", "confirmed", "in_preparation"), true);
assert.strictEqual(canTransitionStatus("order", "confirmed", "fulfilled"), false);
assert.strictEqual(canTransitionStatus("subscription", "in_preparation", "ready_for_delivery"), true);
assert.strictEqual(canTransitionStatus("subscription", "open", "fulfilled"), false);

const runtimeFiles = [
  "src/controllers/subscriptionController.js",
  "src/controllers/kitchenController.js",
  "src/controllers/courierController.js",
  "src/services/fulfillmentService.js",
  "src/services/dashboard/opsTransitionService.js",
];
for (const file of runtimeFiles) {
  assert(!read(file).includes("utils/state"), `${file} must not consume legacy state.js`);
}

const premiumAuthority = read("src/services/subscription/premiumUpgradeConfigService.js");
assert(premiumAuthority.includes("async function resolvePremiumUpgrade"));
assert(premiumAuthority.includes("PREMIUM_UPGRADE_UNAVAILABLE"));
assert(!premiumAuthority.includes("return !configs.length ||"), "premium eligibility must fail closed");

const premiumOverage = read("src/services/subscription/premiumOverageDayPaymentService.js");
assert(!premiumOverage.includes("premium_price"), "premium overage must not read legacy settings pricing");
assert(premiumOverage.includes("resolvePremiumUpgrade"));

const orderPricing = read("src/services/orders/orderPricingService.js");
assert(orderPricing.includes("resolvePremiumUpgrade(protein.premiumKey)"));

console.log("canonicalAuthority.test.js passed");
