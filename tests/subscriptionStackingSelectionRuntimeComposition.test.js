"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

// Load the HTTP-facing planning service first, exactly as the legacy repair
// composition does at startup. The stacking installer mutates the selection
// service exports afterwards.
const planningService = require("../src/services/subscription/subscriptionPlanningClientService");
const selectionService = require("../src/services/subscription/subscriptionSelectionService");

async function testPlanningServiceResolvesInstalledSelectionFunctionAtCallTime() {
  const original = selectionService.performDaySelectionUpdate;
  const userId = new mongoose.Types.ObjectId();
  const subscriptionId = new mongoose.Types.ObjectId();
  let routed = false;
  selectionService.performDaySelectionUpdate = async (args) => {
    routed = true;
    assert.strictEqual(String(args.userId), String(userId));
    assert.strictEqual(String(args.subscriptionId), String(subscriptionId));
    return {
      idempotent: true,
      subscription: {
        _id: subscriptionId,
        userId,
        selectedMealsPerDay: 1,
        selectedGrams: 100,
      },
      day: {
        _id: new mongoose.Types.ObjectId(),
        date: "2026-08-24",
        status: "open",
        mealSlots: [],
        addonSelections: [],
        toObject() { return { ...this, toObject: undefined }; },
      },
      logMeta: {},
    };
  };

  try {
    const result = await planningService.updateDaySelectionForClient({
      subscriptionId,
      date: "2026-08-24",
      body: { mealSlots: [] },
      userId,
      lang: "en",
      runtime: {},
      writeLogSafelyFn: async () => {},
      loadWalletCatalogMapsSafelyFn: async () => ({ addonNames: new Map() }),
      logWalletIntegrityErrorFn: () => {},
    });
    assert.strictEqual(routed, true);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 200);
  } finally {
    selectionService.performDaySelectionUpdate = original;
  }
}

async function run() {
  await testPlanningServiceResolvesInstalledSelectionFunctionAtCallTime();
  console.log("subscription stacking selection runtime composition tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
