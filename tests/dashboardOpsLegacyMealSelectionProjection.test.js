"use strict";

const assert = require("assert");
const {
  hydrateSubscriptionDayForOps,
  resolveEffectiveMealSlots,
} = require("../src/services/dashboard/subscriptionDayOpsMealSourceService");
const { buildKitchenDetailsPayload } = require("../src/services/dashboard/opsPayloadService");
const { buildKitchenProjection } = require("../src/services/dashboard/kitchenProjectionService");

const mealId = "507f1f77bcf86cd799439011";
const secondMealId = "507f1f77bcf86cd799439012";
const catalogMaps = {
  sandwichById: new Map([
    [mealId, { _id: mealId, name: { ar: "وجبة دجاج مشوي", en: "Grilled Chicken Meal" } }],
    [secondMealId, { _id: secondMealId, name: { ar: "وجبة تونة", en: "Tuna Meal" } }],
  ]),
  sandwichByKey: new Map(),
  productById: new Map(),
  productByKey: new Map(),
  proteinById: new Map(),
  proteinByKey: new Map(),
  carbById: new Map(),
  carbByKey: new Map(),
  optionById: new Map(),
  optionByKey: new Map(),
  saladItemById: new Map(),
  saladItemByKey: new Map(),
  addonById: new Map(),
  addonByKey: new Map(),
  addonPlanById: new Map(),
};

function assertNamedProjection(day, expectedNames) {
  const hydrated = hydrateSubscriptionDayForOps(day);
  const details = buildKitchenDetailsPayload(
    hydrated,
    {
      deliveryMode: "delivery",
      selectedMealsPerDay: expectedNames.length,
      deliveryWindow: "08:00-11:00",
      deliveryAddress: { city: "Jeddah" },
    },
    "ar",
    catalogMaps
  );
  const projection = buildKitchenProjection(details);

  assert.strictEqual(details.selectionMode, "customer_selected");
  assert.strictEqual(projection.kitchenCards.length, expectedNames.length);
  assert.deepStrictEqual(projection.kitchenCards.map((card) => card.title), expectedNames);
  assert.ok(projection.kitchenCards.every((card) => card.type !== "chef_choice"));
}

(function main() {
  const fromSelections = resolveEffectiveMealSlots({ selections: [mealId] });
  assert.strictEqual(fromSelections.length, 1);
  assert.strictEqual(String(fromSelections[0].sandwichId), mealId);
  assert.strictEqual(fromSelections[0].selectionType, "sandwich");
  assertNamedProjection({ selections: [mealId] }, ["وجبة دجاج مشوي"]);

  assertNamedProjection({
    mealSlots: [{ slotIndex: 1, slotKey: "slot_1", status: "empty", selectionType: "standard_meal" }],
    selections: [mealId],
  }, ["وجبة دجاج مشوي"]);

  assertNamedProjection({
    baseMealSlots: [
      { slotKey: "base_slot_1", mealId },
      { slotKey: "base_slot_2", mealId: secondMealId },
    ],
  }, ["وجبة دجاج مشوي", "وجبة تونة"]);

  assertNamedProjection({
    lockedSnapshot: {
      selections: [secondMealId],
      addonSelections: [],
    },
  }, ["وجبة تونة"]);

  const explicit = resolveEffectiveMealSlots({
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "sandwich",
      productId: mealId,
      sandwichId: mealId,
    }],
    selections: [secondMealId],
  });
  assert.strictEqual(String(explicit[0].productId), mealId, "explicit canonical slots must remain authoritative");

  console.log("dashboard ops legacy meal selection projection checks passed");
})();
