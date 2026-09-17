"use strict";

const assert = require("assert");
const {
  buildAvailabilityFromDay,
} = require("../src/services/subscription/subscriptionPickupSlotService");
const {
  hydrateSubscriptionDayMealSources,
} = require("../src/services/subscription/subscriptionDayMealSourceService");
const {
  isActiveSubscriptionForOperations,
} = require("../src/services/dashboard/subscriptionOperationsVisibilityService");

const grilledMealId = "507f1f77bcf86cd799439011";
const tunaMealId = "507f1f77bcf86cd799439012";
const proteinId = "507f1f77bcf86cd799439013";
const carbId = "507f1f77bcf86cd799439014";

const catalogMaps = {
  sandwichById: new Map([
    [grilledMealId, { _id: grilledMealId, name: { ar: "وجبة دجاج مشوي", en: "Grilled Chicken Meal" } }],
    [tunaMealId, { _id: tunaMealId, name: { ar: "وجبة تونة", en: "Tuna Meal" } }],
  ]),
  sandwichByKey: new Map(),
  productById: new Map(),
  productByKey: new Map(),
  proteinById: new Map([
    [proteinId, { _id: proteinId, key: "spicy_chicken", name: { ar: "دجاج سبايسي", en: "Spicy Chicken" } }],
  ]),
  proteinByKey: new Map(),
  carbById: new Map([
    [carbId, { _id: carbId, key: "alfredo_pasta", name: { ar: "باستا ألفريدو", en: "Alfredo Pasta" } }],
  ]),
  carbByKey: new Map(),
  optionById: new Map(),
  optionByKey: new Map(),
  groupById: new Map(),
  groupByKey: new Map(),
  saladItemById: new Map(),
  saladItemByKey: new Map(),
  addonById: new Map(),
  addonByKey: new Map(),
  addonPlanById: new Map(),
};

const subscription = {
  deliveryMode: "pickup",
  remainingMeals: 20,
  totalMeals: 26,
};

function availability(day) {
  return buildAvailabilityFromDay({
    day: { date: "2026-07-21", status: "open", ...day },
    pickupRequests: [],
    subscription,
    catalogMaps,
  });
}

(function main() {
  const fromLegacySelections = availability({ selections: [grilledMealId, tunaMealId] });
  assert.strictEqual(fromLegacySelections.pickupItems.length, 2);
  assert.deepStrictEqual(
    fromLegacySelections.pickupItems.map((item) => item.title.ar),
    ["وجبة دجاج مشوي", "وجبة تونة"]
  );
  assert.deepStrictEqual(fromLegacySelections.availableSlotIds, ["slot_1", "slot_2"]);

  const fromMaterializedMeals = availability({
    materializedMeals: [{
      slotKey: "slot_1",
      selectionType: "standard_meal",
      proteinId,
      carbId,
      operationalSku: "spicy_chicken:alfredo_pasta",
    }],
  });
  assert.strictEqual(fromMaterializedMeals.pickupItems.length, 1);
  assert.match(fromMaterializedMeals.pickupItems[0].title.ar, /دجاج سبايسي/);
  assert.match(fromMaterializedMeals.pickupItems[0].title.ar, /باستا ألفريدو/);

  const fromLockedSnapshot = availability({
    mealSlots: [{ slotIndex: 1, slotKey: "slot_1", status: "empty" }],
    lockedSnapshot: { selections: [tunaMealId] },
  });
  assert.strictEqual(fromLockedSnapshot.pickupItems.length, 1);
  assert.strictEqual(fromLockedSnapshot.pickupItems[0].title.ar, "وجبة تونة");

  const documentLikeDay = {
    toObject() {
      return { baseMealSlots: [{ slotKey: "base_1", mealId: grilledMealId }] };
    },
  };
  const hydratedDocument = hydrateSubscriptionDayMealSources(documentLikeDay);
  assert.strictEqual(hydratedDocument.mealSlots.length, 1);
  assert.strictEqual(hydratedDocument.mealSlots[0].slotKey, "base_1");

  assert.strictEqual(isActiveSubscriptionForOperations({ status: "active" }), true);
  assert.strictEqual(isActiveSubscriptionForOperations({ status: "canceled" }), false);
  assert.strictEqual(isActiveSubscriptionForOperations(null), false);

  console.log("subscription pickup recovered meal availability checks passed");
})();
