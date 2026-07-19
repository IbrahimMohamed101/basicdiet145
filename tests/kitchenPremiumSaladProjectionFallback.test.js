"use strict";

const assert = require("assert");
const { buildKitchenDetailsPayload } = require("../src/services/dashboard/opsPayloadService");
const { buildKitchenProjection } = require("../src/services/dashboard/kitchenProjectionService");

function item(index, groupKey, key, ar, en) {
  return {
    groupId: `6a522ed1b3fb649917af${String(index).padStart(4, "0")}`,
    groupKey,
    optionId: `6a522ed1b3fb649917ae${String(index).padStart(4, "0")}`,
    optionKey: key,
    optionName: { ar, en },
    quantity: 1,
  };
}

const displaySelections = [
  item(1, "proteins", "boiled_eggs", "بيض مسلوق", "Boiled Eggs"),
  item(2, "leafy_greens", "cabbage", "ملفوف", "Cabbage"),
  item(3, "leafy_greens", "arugula", "جرجير", "Arugula"),
  ...[
    ["tomato", "طماطم", "Tomato"],
    ["carrot", "جزر", "Carrot"],
    ["cucumber", "خيار", "Cucumber"],
    ["corn", "ذرة", "Corn"],
    ["chickpeas", "حمص", "Chickpeas"],
    ["jalapeno", "هالبينو", "Jalapeno"],
    ["red_beans", "فاصوليا حمراء", "Red Beans"],
    ["beetroot", "شمندر", "Beetroot"],
    ["hot_pepper", "فلفل حار", "Hot Pepper"],
    ["coriander", "كزبرة", "Coriander"],
    ["mushroom", "فطر", "Mushroom"],
    ["broccoli", "بروكلي", "Broccoli"],
    ["salad_grilled_mixed_vegetables", "خضار مشكل مشوي", "Grilled Mixed Vegetables"],
    ["red_onion", "بصل أحمر", "Red Onion"],
    ["green_onion", "بصل أخضر", "Green Onion"],
    ["green_olives", "زيتون أخضر", "Green Olives"],
    ["black_olives", "زيتون أسود", "Black Olives"],
    ["mint", "نعناع", "Mint"],
    ["pickled_onion", "بصل مخلل", "Pickled Onion"],
  ].map(([key, ar, en], offset) => item(offset + 4, "vegetables_legumes", key, ar, en)),
  item(23, "cheese_nuts", "cashew", "كاجو", "Cashew"),
  item(24, "cheese_nuts", "walnut", "عين الجمل", "Walnut"),
  item(25, "fruits", "raspberry", "توت أحمر", "Raspberry"),
  item(26, "fruits", "watermelon", "بطيخ", "Watermelon"),
  item(27, "fruits", "cantaloupe", "شمام", "Cantaloupe"),
  item(28, "fruits", "dates", "تمر", "Dates"),
  item(29, "sauces", "spicy_ranch", "سبايسي رانش", "Spicy Ranch"),
];

const selectedOptions = displaySelections.map((selection) => ({
  groupId: selection.groupId,
  groupKey: selection.groupKey,
  canonicalGroupKey: selection.groupKey === "vegetables_legumes"
    ? "vegetables"
    : (selection.groupKey === "proteins" ? "protein" : (selection.groupKey === "sauces" ? "sauce" : selection.groupKey)),
  optionId: selection.optionId,
  optionKey: selection.optionKey,
  quantity: 1,
}));

const staleProtein = {
  id: "6a522e64b3fb649917aee296",
  key: "spicy_chicken",
  name: { ar: "دجاج سبايسي", en: "Spicy Chicken" },
};
const byGroup = (groupKey) => displaySelections
  .filter((selection) => selection.groupKey === groupKey)
  .map((selection) => ({
    id: selection.optionId,
    key: selection.optionKey,
    name: selection.optionName,
  }));

const day = {
  mealSlots: [{
    slotIndex: 1,
    slotKey: "slot_1",
    status: "complete",
    selectionType: "premium_large_salad",
    productId: "6a522f12b3fb649917aee5cc",
    productKey: "premium_large_salad",
    proteinId: staleProtein.id,
    selectedOptions,
    displaySnapshot: {
      product: {
        id: "6a522f12b3fb649917aee5cc",
        key: "premium_large_salad",
        name: { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" },
      },
      groups: displaySelections,
    },
    // Reproduce the persisted stale/partial legacy snapshot that previously won
    // over the canonical selection and produced 10 items plus the wrong protein.
    salad: {
      groups: {
        protein: [staleProtein],
        leafy_greens: byGroup("leafy_greens"),
        cheese_nuts: byGroup("cheese_nuts"),
        fruits: byGroup("fruits"),
        sauce: byGroup("sauces"),
      },
    },
    isPremium: true,
    premiumKey: "premium_large_salad",
    premiumSource: "paid_extra",
  }],
  materializedMeals: [],
  premiumUpgradeSelections: [],
  addonSelections: [],
};

const catalogMaps = {
  proteinById: new Map([[staleProtein.id, {
    _id: staleProtein.id,
    key: staleProtein.key,
    proteinFamilyKey: staleProtein.key,
    name: staleProtein.name,
  }]]),
};
const kitchenDetails = buildKitchenDetailsPayload(day, { selectedGrams: 100 }, "ar", catalogMaps);
assert.strictEqual(kitchenDetails.mealSlots.length, 1);
assert.strictEqual(kitchenDetails.mealSlots[0].selectedOptions.length, 29);
assert.strictEqual(kitchenDetails.mealSlots[0].proteinName, "بيض مسلوق");

const card = buildKitchenProjection(kitchenDetails).kitchenCards[0];
const allItems = card.sections.flatMap((section) => section.items);
const vegetableSection = card.sections.find((section) => section.key === "vegetables_legumes");
const proteinSection = card.sections.find((section) => section.key === "protein");

assert.strictEqual(allItems.length, 29);
assert.strictEqual(new Set(allItems.map((entry) => entry.id || entry.key)).size, 29);
assert(vegetableSection);
assert.strictEqual(vegetableSection.items.length, 19);
assert(proteinSection);
assert.deepStrictEqual(proteinSection.items.map((entry) => entry.key), ["boiled_eggs"]);
assert.strictEqual(proteinSection.items[0].name, "بيض مسلوق");
assert.strictEqual(card.components.protein.name, "بيض مسلوق");
assert(!allItems.some((entry) => entry.key === "spicy_chicken"));
assert(card.lines.some((line) => line.startsWith("خضروات وبقوليات:")));

console.log("kitchenPremiumSaladProjectionFallback.test.js passed");
