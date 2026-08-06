"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  assertBaseMealsOnly,
} = require("../src/services/subscription/subscriptionStackingSelectionWriteService");

function testPlainBaseMealsAreAllowed() {
  assert.doesNotThrow(() => assertBaseMealsOnly({
    mealSlots: [
      {
        slotIndex: 1,
        slotKey: "slot_1",
        selectionType: "standard_meal",
        isPremium: false,
        premiumSource: "none",
      },
    ],
    draft: { premiumUpgradeSelections: [] },
    requestedOneTimeAddonIds: [],
    existingDay: { addonSelections: [], premiumUpgradeSelections: [] },
  }));
}

function testPremiumRequestFailsBeforePersistence() {
  assert.throws(
    () => assertBaseMealsOnly({
      mealSlots: [{
        slotIndex: 1,
        slotKey: "slot_1",
        selectionType: "premium_meal",
        isPremium: true,
        premiumKey: "shrimp",
        premiumSource: "balance",
      }],
      draft: { premiumUpgradeSelections: [] },
      requestedOneTimeAddonIds: [],
      existingDay: { addonSelections: [], premiumUpgradeSelections: [] },
    }),
    (err) => Boolean(
      err
      && err.code === "STACKING_PREMIUM_SELECTION_NOT_READY"
      && err.status === 503
    )
  );
}

function testDraftPremiumFailsEvenIfInputWasNormalized() {
  assert.throws(
    () => assertBaseMealsOnly({
      mealSlots: [{ slotIndex: 1, slotKey: "slot_1" }],
      draft: {
        premiumUpgradeSelections: [{ premiumKey: "salmon" }],
      },
      requestedOneTimeAddonIds: [],
      existingDay: { addonSelections: [], premiumUpgradeSelections: [] },
    }),
    (err) => Boolean(err && err.code === "STACKING_PREMIUM_SELECTION_NOT_READY")
  );
}

function testRequestedAddonFailsBeforePersistence() {
  assert.throws(
    () => assertBaseMealsOnly({
      mealSlots: [],
      draft: { premiumUpgradeSelections: [] },
      requestedOneTimeAddonIds: ["addon-1"],
      existingDay: { addonSelections: [], premiumUpgradeSelections: [] },
    }),
    (err) => Boolean(
      err
      && err.code === "STACKING_ADDON_SELECTION_NOT_READY"
      && err.status === 503
    )
  );
}

function testExistingPremiumOrAddonDayFailsClosed() {
  assert.throws(
    () => assertBaseMealsOnly({
      mealSlots: [],
      requestedOneTimeAddonIds: [],
      existingDay: {
        addonSelections: [{ addonId: "addon-1" }],
        premiumUpgradeSelections: [],
      },
    }),
    (err) => Boolean(err && err.code === "STACKING_ADDON_SELECTION_NOT_READY")
  );
  assert.throws(
    () => assertBaseMealsOnly({
      mealSlots: [],
      requestedOneTimeAddonIds: [],
      existingDay: {
        addonSelections: [],
        premiumUpgradeSelections: [{ premiumKey: "shrimp" }],
      },
    }),
    (err) => Boolean(err && err.code === "STACKING_PREMIUM_SELECTION_NOT_READY")
  );
}

function run() {
  testPlainBaseMealsAreAllowed();
  testPremiumRequestFailsBeforePersistence();
  testDraftPremiumFailsEvenIfInputWasNormalized();
  testRequestedAddonFailsBeforePersistence();
  testExistingPremiumOrAddonDayFailsClosed();
  console.log("subscription stacking selection write guard tests passed");
}

run();
