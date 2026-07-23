"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const {
  canonicalSaladGroupKey,
  collectLegacyPlannerIds,
  convertLegacyPlannerSlotsToCanonical,
} = require("../src/services/installFlutterMealPlannerPayloadCompatibility");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function id(value) {
  return String(value);
}

function option(group, key) {
  return {
    _id: objectId(),
    groupId: group._id,
    key,
  };
}

function main() {
  const groups = {
    proteins: { _id: objectId(), key: "proteins" },
    carbs: { _id: objectId(), key: "carbs" },
    leafyGreens: { _id: objectId(), key: "leafy_greens" },
    vegetables: { _id: objectId(), key: "vegetables" },
    saladProtein: { _id: objectId(), key: "protein" },
    cheeseNuts: { _id: objectId(), key: "cheese_nuts" },
    fruits: { _id: objectId(), key: "fruits" },
    sauce: { _id: objectId(), key: "sauce" },
  };

  const options = {
    mealProtein: option(groups.proteins, "grilled_chicken"),
    carb: option(groups.carbs, "white_rice"),
    lettuce: option(groups.leafyGreens, "lettuce"),
    tomato: option(groups.vegetables, "tomato"),
    saladProtein: option(groups.saladProtein, "grilled_chicken"),
    feta: option(groups.cheeseNuts, "feta"),
    mango: option(groups.fruits, "mango"),
    ranch: option(groups.sauce, "ranch"),
  };

  const products = {
    basicMeal: { _id: objectId(), key: "basic_meal" },
    premiumLargeSalad: { _id: objectId(), key: "premium_large_salad" },
    directMeal: { _id: objectId(), key: "sandwiches_tuna", itemType: "cold_sandwich" },
  };

  const mealSlots = [
    {
      slotIndex: 1,
      slotKey: "slot_1",
      selectionType: "standard_meal",
      proteinId: id(options.mealProtein._id),
      carbs: [{ carbId: id(options.carb._id), grams: 150 }],
    },
    {
      slotIndex: 2,
      slotKey: "slot_2",
      selectionType: "premium_large_salad",
      proteinId: id(options.saladProtein._id),
      salad: {
        presetKey: "large_salad",
        groups: {
          leafy_greens: [id(options.lettuce._id)],
          vegetables: [id(options.tomato._id)],
          protein: [id(options.saladProtein._id)],
          cheese_nuts: [id(options.feta._id)],
          fruits: [id(options.mango._id)],
          sauce: [id(options.ranch._id)],
        },
      },
    },
    {
      slotIndex: 3,
      slotKey: "slot_3",
      selectionType: "full_meal_product",
      sandwichId: id(products.directMeal._id),
    },
  ];

  const productsByKey = new Map([
    [products.basicMeal.key, products.basicMeal],
    [products.premiumLargeSalad.key, products.premiumLargeSalad],
  ]);
  const productsById = new Map([
    [id(products.directMeal._id), products.directMeal],
  ]);
  const optionsById = new Map(
    Object.values(options).map((row) => [id(row._id), row])
  );
  const groupsById = new Map(
    Object.values(groups).map((row) => [id(row._id), row])
  );

  const converted = convertLegacyPlannerSlotsToCanonical({
    mealSlots,
    productsByKey,
    productsById,
    optionsById,
    groupsById,
  });

  assert(converted, "Flutter legacy planner payload should convert to canonical slots");
  assert.strictEqual(converted.length, 3);

  assert.strictEqual(converted[0].productId, id(products.basicMeal._id));
  assert.strictEqual(converted[0].selectedOptions.length, 2);
  assert.strictEqual(converted[0].selectedOptions[0].optionId, id(options.mealProtein._id));
  assert.strictEqual(converted[0].selectedOptions[1].optionId, id(options.carb._id));
  assert.strictEqual(converted[0].selectedOptions[1].grams, 150);
  assert.strictEqual(converted[0].proteinId, undefined, "legacy identities must not leak into canonical slots");

  assert.strictEqual(converted[1].productId, id(products.premiumLargeSalad._id));
  assert.strictEqual(converted[1].selectionType, "premium_large_salad");
  assert.strictEqual(converted[1].selectedOptions.length, 6);
  assert.deepStrictEqual(
    new Set(converted[1].selectedOptions.map((row) => row.optionId)),
    new Set([
      id(options.lettuce._id),
      id(options.tomato._id),
      id(options.saladProtein._id),
      id(options.feta._id),
      id(options.mango._id),
      id(options.ranch._id),
    ])
  );
  assert.strictEqual(converted[1].salad, undefined, "legacy salad envelope must not reach canonical validation");

  assert.strictEqual(converted[2].productId, id(products.directMeal._id));
  assert.deepStrictEqual(converted[2].selectedOptions, []);
  assert.strictEqual(converted[2].sandwichId, undefined);

  const collected = collectLegacyPlannerIds(mealSlots);
  assert(collected.optionIds.includes(id(options.saladProtein._id)));
  assert(collected.optionIds.includes(id(options.carb._id)));
  assert(collected.directProductIds.includes(id(products.directMeal._id)));

  assert.strictEqual(canonicalSaladGroupKey("salad_greens"), "leafy_greens");
  assert.strictEqual(canonicalSaladGroupKey("salad_vegetables_legumes"), "vegetables");
  assert.strictEqual(canonicalSaladGroupKey("salad_proteins"), "protein");
  assert.strictEqual(canonicalSaladGroupKey("salad_sauces"), "sauce");

  const invalid = convertLegacyPlannerSlotsToCanonical({
    mealSlots: [{
      slotIndex: 1,
      selectionType: "premium_large_salad",
      proteinId: id(options.saladProtein._id),
      salad: {
        groups: {
          protein: [id(options.saladProtein._id)],
          sauce: [id(objectId())],
        },
      },
    }],
    productsByKey,
    productsById,
    optionsById,
    groupsById,
  });
  assert.strictEqual(invalid, null, "unknown option IDs must fail closed");

  const startupInstallerSource = fs.readFileSync(
    path.join(__dirname, "../src/services/installSubscriptionDayFullMealCompatibility.js"),
    "utf8"
  );
  assert(
    startupInstallerSource.includes('require("./installFlutterMealPlannerPayloadCompatibility")'),
    "Flutter planner bridge must be installed before route modules capture planner services"
  );

  console.log("flutterMealPlannerPayloadCompatibility.test.js passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
