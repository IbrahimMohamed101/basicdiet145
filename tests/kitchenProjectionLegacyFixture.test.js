"use strict";

const assert = require("assert");

const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOption = require("../src/models/MenuOption");
const SaladIngredient = require("../src/models/SaladIngredient");
const Addon = require("../src/models/Addon");
const Meal = require("../src/models/Meal");
const Sandwich = require("../src/models/Sandwich");
const { buildKitchenCatalogMaps } = require("../src/services/dashboard/kitchenCatalogService");
const { mapSubscriptionDayToDTO } = require("../src/services/dashboard/dashboardDtoService");
const {
  mapSubscriptionDayToRow,
  sanitizeRow,
} = require("../src/services/kitchenOperations/KitchenOperationsMapper");

function mockQuery(rows) {
  return {
    select() { return this; },
    lean() { return Promise.resolve(rows); },
  };
}

async function run() {
  const ids = {
    sandwich: "6a522f6ab3fb649917aee76a",
    protein: "6a522f6ab3fb649917aee701",
    pasta: "6a522f6ab3fb649917aee702",
    rice: "6a522f6ab3fb649917aee703",
    premiumSalad: "6a522f12b3fb649917aee704",
    egg: "6a522f6ab3fb649917aee705",
    lettuce: "6a522f6ab3fb649917aee706",
    ranch: "6a522f6ab3fb649917aee707",
    iceCream: "6a522f6ab3fb649917aee708",
    snack: "6a522f6ab3fb649917aee709",
    iceCreamPlan: "6a522f6ab3fb649917aee710",
    snackPlan: "6a522f6ab3fb649917aee711",
    iceBucket: "6a522f6ab3fb649917aee712",
    snackBucket: "6a522f6ab3fb649917aee713",
  };

  const day = {
    _id: "6a522f6ab3fb649917aee799",
    subscriptionId: "6a522f6ab3fb649917aee798",
    date: "2026-07-17",
    status: "open",
    mealSlots: [{
      slotIndex: 1,
      slotKey: "sandwich_slot",
      selectionType: "sandwich",
      sandwichId: ids.sandwich,
    }, {
      slotIndex: 2,
      slotKey: "standard_slot",
      selectionType: "standard_meal",
      proteinId: ids.protein,
      proteinFamilyKey: "chicken",
      carbs: [
        { carbId: ids.pasta, grams: 250 },
        { carbId: ids.rice, grams: 50 },
      ],
    }, {
      slotIndex: 3,
      slotKey: "premium_salad_slot",
      selectionType: "premium_large_salad",
      salad: {
        presetKey: "premium_large_salad",
        groups: {
          protein: [ids.egg],
          leafy_greens: [ids.lettuce],
          sauce: [ids.ranch],
        },
      },
    }],
    premiumUpgradeSelections: [{
      baseSlotKey: "premium_salad_slot",
      sourceProductId: ids.premiumSalad,
      sourceKey: "premium_large_salad",
      nameI18n: { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" },
    }],
    addonSelections: [{
      addonId: ids.iceCream,
      productId: ids.iceCream,
      productKey: "vanilla_ice_cream",
      addonPlanId: ids.iceCreamPlan,
      balanceBucketId: ids.iceBucket,
      entitlementKey: "ice_cream",
      category: "snack",
      qty: 1,
      priceHalala: 0,
      unitPriceHalala: 20000,
      payableTotalHalala: 0,
    }, {
      addonId: ids.snack,
      productId: ids.snack,
      productKey: "protein_bar",
      addonPlanId: ids.snackPlan,
      balanceBucketId: ids.snackBucket,
      entitlementKey: "snack",
      category: "snack",
      qty: 1,
      priceHalala: 0,
      unitPriceHalala: 15000,
      payableTotalHalala: 0,
    }],
  };

  const subscription = {
    _id: day.subscriptionId,
    planId: { _id: "6a522f6ab3fb649917aee797", key: "basic", name: { ar: "أساسي", en: "Basic" } },
    selectedGrams: 100,
    selectedMealsPerDay: 3,
    totalMeals: 30,
    remainingMeals: 27,
    deliveryMode: "delivery",
    deliveryWindow: "10:00 - 12:00",
    deliveryAddress: { city: "Cairo" },
    addonSubscriptions: [{
      addonPlanId: ids.iceCreamPlan,
      balanceBucketId: ids.iceBucket,
      entitlementKey: "ice_cream",
      addonPlanNameI18n: { ar: "آيس كريم", en: "Ice Cream" },
      category: "snack",
      menuProductsSnapshot: [{
        id: ids.iceCream,
        key: "vanilla_ice_cream",
        name: { ar: "آيس كريم فانيليا", en: "Vanilla Ice Cream" },
        priceHalala: 1300,
      }],
    }, {
      addonPlanId: ids.snackPlan,
      balanceBucketId: ids.snackBucket,
      entitlementKey: "snack",
      addonPlanNameI18n: { ar: "سناك", en: "Snack" },
      category: "snack",
      menuProductsSnapshot: [{
        id: ids.snack,
        key: "protein_bar",
        name: { ar: "بار بروتين", en: "Protein Bar" },
        priceHalala: 700,
      }],
    }],
  };

  const originals = new Map([
    [BuilderProtein, BuilderProtein.find],
    [BuilderCarb, BuilderCarb.find],
    [MenuProduct, MenuProduct.find],
    [MenuOption, MenuOption.find],
    [SaladIngredient, SaladIngredient.find],
    [Addon, Addon.find],
    [Meal, Meal.find],
    [Sandwich, Sandwich.find],
  ]);

  BuilderProtein.find = () => mockQuery([
    { _id: ids.protein, key: "chicken", proteinFamilyKey: "chicken", name: { ar: "دجاج", en: "Chicken" } },
    { _id: ids.egg, key: "boiled_egg", name: { ar: "بيض مسلوق", en: "Boiled Egg" } },
  ]);
  BuilderCarb.find = () => mockQuery([
    { _id: ids.pasta, key: "alfredo_pasta", name: { ar: "باستا الفريدو", en: "Alfredo Pasta" } },
    { _id: ids.rice, key: "white_rice", name: { ar: "رز أبيض", en: "White Rice" } },
  ]);
  const menuProducts = [
    { _id: ids.sandwich, key: "beef_burger_sandwich", name: { ar: "برجر لحم", en: "Beef Burger" }, itemType: "cold_sandwich", priceHalala: 1800 },
    { _id: ids.premiumSalad, key: "premium_large_salad", name: { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" }, priceHalala: 2200 },
    { _id: ids.iceCream, key: "vanilla_ice_cream", name: { ar: "آيس كريم فانيليا", en: "Vanilla Ice Cream" }, priceHalala: 1300 },
    { _id: ids.snack, key: "protein_bar", name: { ar: "بار بروتين", en: "Protein Bar" }, priceHalala: 700 },
  ];
  MenuProduct.find = (query = {}) => {
    const clauses = Array.isArray(query.$or) ? query.$or : [];
    const queriedIds = new Set(clauses.flatMap((clause) => (
      clause._id && clause._id.$in ? clause._id.$in.map(String) : []
    )));
    const queriedKeys = new Set(clauses.flatMap((clause) => (
      clause.key && clause.key.$in ? clause.key.$in.map(String) : []
    )));
    return mockQuery(menuProducts.filter((product) => (
      queriedIds.has(String(product._id)) || queriedKeys.has(String(product.key))
    )));
  };
  MenuOption.find = () => mockQuery([]);
  SaladIngredient.find = () => mockQuery([
    { _id: ids.lettuce, key: "lettuce", name: { ar: "خس", en: "Lettuce" }, groupKey: "leafy_greens" },
    { _id: ids.ranch, key: "ranch", name: { ar: "رانش", en: "Ranch" }, groupKey: "sauce" },
  ]);
  Addon.find = () => mockQuery([
    { _id: ids.iceCreamPlan, name: { ar: "آيس كريم", en: "Ice Cream" }, displayKey: "ice_cream", category: "snack" },
    { _id: ids.snackPlan, name: { ar: "سناك", en: "Snack" }, displayKey: "snack", category: "snack" },
  ]);
  Meal.find = () => mockQuery([]);
  Sandwich.find = () => mockQuery([]);

  try {
    const catalogMaps = await buildKitchenCatalogMaps([day]);
    const dto = mapSubscriptionDayToDTO(
      day,
      null,
      subscription,
      { _id: "6a522f6ab3fb649917aee796", name: "Legacy User", phone: "01000000000" },
      "kitchen",
      "ar",
      catalogMaps
    );

    assert(dto.kitchenDetails, "the backwards-compatible kitchenDetails field remains present");
    assert.strictEqual(dto.kitchenProjectionVersion, "v1");
    assert.strictEqual(dto.kitchenCards.length, 3);

    const sandwich = dto.kitchenCards.find((card) => card.type === "sandwich");
    assert.strictEqual(sandwich.title, "برجر لحم");
    assert.strictEqual(sandwich.components.product.key, "beef_burger_sandwich");
    assert.deepStrictEqual(sandwich.lines, ["ساندويتش: برجر لحم"]);
    const legacySandwich = dto.kitchenDetails.mealSlots.find((slot) => slot.selectionType === "sandwich");
    assert.strictEqual(legacySandwich.productId, ids.sandwich);
    assert.strictEqual(legacySandwich.productKey, "beef_burger_sandwich");
    assert.strictEqual(legacySandwich.sandwichName, "برجر لحم");

    const standard = dto.kitchenCards.find((card) => card.type === "standard_meal");
    assert.strictEqual(standard.title, "وجبة دجاج 100g");
    assert.deepStrictEqual(standard.lines, [
      "بروتين: دجاج - 100g",
      "كارب: باستا الفريدو 250g",
      "كارب: رز أبيض 50g",
    ]);
    const legacyStandard = dto.kitchenDetails.mealSlots.find((slot) => slot.selectionType === "standard_meal");
    assert.strictEqual(legacyStandard.proteinKey, "chicken");
    assert.deepStrictEqual(legacyStandard.carbSelections.map((carb) => carb.key), ["alfredo_pasta", "white_rice"]);

    const salad = dto.kitchenCards.find((card) => card.type === "premium_large_salad");
    assert.strictEqual(salad.title, "سلطة كبيرة مميزة");
    assert.strictEqual(salad.components.product.key, "premium_large_salad");
    assert(salad.lines.includes("بروتين: بيض مسلوق"));
    assert(salad.lines.includes("ورقيات: خس"));
    assert(salad.lines.includes("صوص: رانش"));
    assert(!Object.prototype.hasOwnProperty.call(salad.components.salad, "groups"));
    assert(salad.rawSelection.salad.groups, "raw salad groups remain available only through rawSelection/debug");

    assert.strictEqual(dto.kitchenAddonGroups.length, 2, "same-category plans must remain separate");
    const iceCreamGroup = dto.kitchenAddonGroups.find((group) => group.addonPlanId === ids.iceCreamPlan);
    const snackGroup = dto.kitchenAddonGroups.find((group) => group.addonPlanId === ids.snackPlan);
    assert(iceCreamGroup && snackGroup);
    assert.strictEqual(iceCreamGroup.label, "آيس كريم");
    assert.strictEqual(iceCreamGroup.items[0].productUnitPriceHalala, 1300);
    assert.strictEqual(iceCreamGroup.items[0].payableTotalHalala, 0);
    assert.strictEqual(snackGroup.items[0].productUnitPriceHalala, 700);
    assert.strictEqual(snackGroup.items[0].payableTotalHalala, 0);
    assert.strictEqual(dto.kitchenDetails.addons[0].priceHalala, 0, "zero covered price must not fall through to the plan price");

    const mappedKitchenOperationsRow = mapSubscriptionDayToRow({
      ...day,
      subscriptionId: subscription,
    }, {
      catalogMaps,
      mealNameById: new Map(),
      addonNameById: new Map(),
    });
    const kitchenOperationsRow = sanitizeRow(mappedKitchenOperationsRow);
    assert.strictEqual(kitchenOperationsRow.kitchen.version, "v2");
    assert.strictEqual(kitchenOperationsRow.kitchen.cards.find((card) => card.type === "sandwich").title, "برجر لحم");
    assert.strictEqual(kitchenOperationsRow.kitchen.addonGroups.length, 2);
    assert.strictEqual(kitchenOperationsRow.kitchenDetails, undefined);
    const legacyKitchenOperationsRow = sanitizeRow(mappedKitchenOperationsRow, { includeLegacy: true });
    assert(legacyKitchenOperationsRow.kitchenDetails, "includeLegacy restores kitchenDetails");

    console.log("✅ legacy kitchen fixture projects resolved cards and addon-plan groups");
  } finally {
    for (const [model, find] of originals.entries()) model.find = find;
  }
}

run().catch((error) => {
  console.error(`❌ kitchen projection legacy fixture failed: ${error.stack || error.message}`);
  process.exit(1);
});
