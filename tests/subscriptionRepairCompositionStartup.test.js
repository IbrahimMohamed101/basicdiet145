"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";

const assert = require("assert");

const { createApp } = require("../src/app");
const pricingService = require("../src/services/subscription/subscriptionAddonPricingService");
const addonChoicesService = require("../src/services/subscription/subscriptionAddonChoicesService");
const selectionService = require("../src/services/subscription/subscriptionSelectionService");

const COMPOSITION_STATE_KEY = Symbol.for("basicdiet.subscriptionBackendRepairComposition.state");

function run() {
  const state = globalThis[COMPOSITION_STATE_KEY];
  assert(state, "subscription repair composition state exists after app startup");
  assert.strictEqual(state.status, "installed", `subscription repair composition installed: ${state.errorMessage || ""}`);

  assert.strictEqual(
    addonChoicesService.buildAddonChoicePricingPreview,
    pricingService.buildAddonChoicePricingPreviewCore,
    "add-on choices capture the canonical non-mutating pricing core"
  );
  assert.strictEqual(
    pricingService.buildAddonChoicePricingPreview,
    pricingService.buildAddonChoicePricingPreviewCore,
    "public add-on pricing export remains the canonical core"
  );

  assert.strictEqual(
    selectionService.performDaySelectionUpdate.__transientTransactionRetry,
    true,
    "day selection update has transient transaction retry"
  );
  assert.strictEqual(
    selectionService.performDaySelectionUpdate.__preservesPaidPremiumState,
    true,
    "retry wrapper preserves paid Premium update metadata"
  );
  assert.strictEqual(
    selectionService.performDaySelectionValidation.__preservesPaidPremiumState,
    true,
    "validation keeps paid Premium state protection"
  );
  assert.strictEqual(
    selectionService.performDayPlanningConfirmation.__transientTransactionRetry,
    true,
    "day confirmation has transient transaction retry"
  );

  const app = createApp();
  assert(app && typeof app.use === "function", "Express app is created after repair composition");

  console.log("subscriptionRepairCompositionStartup.test.js passed");
}

try {
  run();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
