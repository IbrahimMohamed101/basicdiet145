const assert = require("assert");

const {
  normalizeKitchenQueueResponse,
} = require("../src/services/dashboard/kitchenQueueContractService");
const {
  buildKitchenDetailsPayload,
} = require("../src/services/dashboard/opsPayloadService");

function assertNoUnsafeDisplay(payload) {
  const json = JSON.stringify(payload);
  assert(!json.includes("[object Object]"));
  assert(!json.includes("حضّر premium_large_salad"));
  assert(!json.includes("حضّر standard_meal"));
  assert(!json.includes('"displayName":"premium_large_salad"'));
  assert(!json.includes('"displayName":"standard_meal"'));
}

function run() {
  const lookupHydratedKitchenDetails = buildKitchenDetailsPayload({
    mealSlots: [{
      slotIndex: 1,
      slotKey: "premium_salad",
      selectionType: "premium_large_salad",
      productKey: "premium_large_salad",
      salad: {
        presetKey: "premium_large_salad",
        groups: {
          leafy_greens: ["6a2453f44a2465a2f7a07189"],
          protein: ["6a2453ea4a2465a2f7a0713e"],
          cheese_nuts: ["6a2453fc4a2465a2f7a071d4"],
          fruits: ["6a2453ff4a2465a2f7a071ec"],
          sauce: ["6a2454044a2465a2f7a0720d"],
        },
      },
    }],
    addonSelections: [{ addonId: "6a2454894a2465a2f7a0763d", qty: 1 }],
  }, { selectedGrams: 100 }, "ar", {
    saladItemById: new Map([
      ["6a2453f44a2465a2f7a07189", { _id: "6a2453f44a2465a2f7a07189", key: "lettuce", name: { ar: "خس", en: "Lettuce" } }],
      ["6a2453fc4a2465a2f7a071d4", { _id: "6a2453fc4a2465a2f7a071d4", key: "cashew", name: { ar: "كاجو", en: "Cashew" } }],
      ["6a2453ff4a2465a2f7a071ec", { _id: "6a2453ff4a2465a2f7a071ec", key: "mango", name: { ar: "مانجا", en: "Mango" } }],
      ["6a2454044a2465a2f7a0720d", { _id: "6a2454044a2465a2f7a0720d", key: "ranch", name: { ar: "رانش", en: "Ranch" } }],
    ]),
    proteinById: new Map([
      ["6a2453ea4a2465a2f7a0713e", { _id: "6a2453ea4a2465a2f7a0713e", key: "grilled_chicken", name: { ar: "دجاج مشوي", en: "Grilled Chicken" } }],
    ]),
    addonById: new Map([
      ["6a2454894a2465a2f7a0763d", { _id: "6a2454894a2465a2f7a0763d", key: "dark_brownies", name: { ar: "براونيز داكن", en: "Dark Brownies" } }],
    ]),
  });
  const lookupResponse = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "day_lookup",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-14",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan: { id: "plan1", key: "fit", name: { ar: "باقة", en: "Plan" } },
      kitchenDetails: lookupHydratedKitchenDetails,
      paymentValidity: { paymentStatus: "not_required", canPrepare: true, canFulfill: false },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });
  const lookupItem = lookupResponse.items[0];
  assert.strictEqual(lookupItem.kitchen.meals[0].salad.groups.leafy_greens[0].displayName, "خس");
  assert.strictEqual(lookupItem.kitchen.meals[0].salad.groups.protein[0].displayName, "دجاج مشوي");
  assert.strictEqual(lookupItem.kitchen.meals[0].salad.groups.cheese_nuts[0].displayName, "كاجو");
  assert.strictEqual(lookupItem.kitchen.meals[0].salad.groups.fruits[0].displayName, "مانجا");
  assert.strictEqual(lookupItem.kitchen.meals[0].salad.groups.sauce[0].displayName, "رانش");
  assert.strictEqual(lookupItem.kitchen.addons[0].displayName, "براونيز داكن");
  assert.strictEqual(lookupItem.kitchen.addons[0].name.ar, "براونيز داكن");
  assert.strictEqual(lookupItem.dataQuality.isComplete, true);
  assert(!lookupItem.dataQuality.warnings.some((warning) => warning.code === "UNRESOLVED_SALAD_GROUP_ITEM"));
  assert(!lookupItem.dataQuality.warnings.some((warning) => warning.code === "MISSING_PRODUCT"));
  assert(!lookupItem.dataQuality.warnings.some((warning) => warning.code === "MISSING_PRODUCT_NAME"));
  assert(!JSON.stringify(lookupResponse).includes('"displayName":"عنصر غير معروف"'));

  // --- premium_meal semantic product: must never emit product-missing warnings ---
  const premiumMealResponse = normalizeKitchenQueueResponse({
    date: "2026-06-13",
    items: [{
      entityId: "premiumMealDay",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-13",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan: { id: "plan1", key: "fit", name: { ar: "باقة", en: "Plan" } },
      kitchenDetails: {
        mealSlots: [{
          slotIndex: 1,
          slotKey: "premium_meal_slot",
          selectionType: "premium_meal",
          // intentionally no productId, no productKey, no productNameI18n
          proteinKey: "beef",
          proteinNameI18n: { ar: "لحم", en: "Beef" },
          proteinGrams: 200,
          carbSelections: [{ carbId: "carb1", key: "rice", nameI18n: { ar: "رز أبيض", en: "White Rice" }, grams: 150 }],
        }],
        addons: [],
      },
      paymentValidity: { paymentStatus: "not_required", canPrepare: true, canFulfill: false },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });
  const premiumMealItem = premiumMealResponse.items[0];
  const premiumMeal = premiumMealItem.kitchen.meals[0];
  // Semantic label must resolve correctly
  assert.strictEqual(premiumMeal.mealType, "premium_meal");
  assert.strictEqual(premiumMeal.mealTypeLabel.ar, "وجبة مميزة");
  assert.strictEqual(premiumMeal.product.displayName, "وجبة مميزة");
  assert.strictEqual(premiumMeal.product.name.ar, "وجبة مميزة");
  assert.strictEqual(premiumMeal.product.name.en, "Premium meal");
  assert(premiumMeal.display.titleAr.includes("وجبة مميزة"));
  assert(premiumMeal.display.preparationTextAr.includes("وجبة مميزة"));
  // No spurious product warnings
  const premiumMealWarningCodes = premiumMealItem.dataQuality.warnings.map((w) => w.code);
  assert(!premiumMealWarningCodes.includes("MISSING_PRODUCT"), "premium_meal must not emit MISSING_PRODUCT");
  assert(!premiumMealWarningCodes.includes("MISSING_PRODUCT_NAME"), "premium_meal must not emit MISSING_PRODUCT_NAME");
  assert(!premiumMealWarningCodes.includes("FALLBACK_DISPLAY_NAME_USED"), "premium_meal must not emit FALLBACK_DISPLAY_NAME_USED");
  // Fully resolved: isComplete should be true
  assert.strictEqual(premiumMealItem.dataQuality.isComplete, true, `Expected isComplete=true, got warnings: ${JSON.stringify(premiumMealItem.dataQuality.warnings)}`);
  assert.deepStrictEqual(premiumMealItem.dataQuality.warnings, [], `Expected empty warnings, got: ${JSON.stringify(premiumMealItem.dataQuality.warnings)}`);


  const missingArabicAddonResponse = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "day_addon_missing_ar",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-14",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan: { id: "plan1", key: "fit", name: { ar: "باقة", en: "Plan" } },
      kitchenDetails: {
        mealSlots: [{ slotIndex: 1, slotKey: "standard", selectionType: "standard_meal", productKey: "standard_meal" }],
        addons: [{ id: "addon_en", key: "english_only", nameI18n: { ar: "", en: "English Only" }, quantity: 1 }],
      },
      paymentValidity: { paymentStatus: "not_required", canPrepare: true, canFulfill: false },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });
  assert.strictEqual(missingArabicAddonResponse.items[0].kitchen.addons[0].displayName, "English Only");
  assert(missingArabicAddonResponse.items[0].dataQuality.warnings.some((warning) => (
    warning.code === "MISSING_ARABIC_ADDON_NAME"
      && warning.field === "kitchen.addons[0].name.ar"
  )));

  const response = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "day1",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-14",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan: {
        id: "plan1",
        key: "fit",
        name: { ar: "باقة", en: "Plan" },
        proteinGrams: 100,
        portionSize: "100g",
        selectedMealsPerDay: 2,
        totalMeals: 20,
        remainingMeals: 18,
      },
      kitchenDetails: {
        mealSlots: [{
          slotIndex: 1,
          slotKey: "standard",
          selectionType: "standard_meal",
          productKey: "standard_meal",
          proteinKey: "meatballs",
          proteinNameI18n: { ar: "كرات لحم", en: "Meatballs" },
          proteinGrams: 100,
          carbSelections: [{ carbId: "carb1", key: "rice", nameI18n: { ar: "رز أبيض", en: "White Rice" }, grams: 120 }],
        }, {
          slotIndex: 2,
          slotKey: "premium_salad",
          selectionType: "premium_large_salad",
          productKey: "premium_large_salad",
          proteinGrams: 100,
          salad: {
            presetKey: "premium_large_salad",
            groups: {
              leafy_greens: [{ id: "leaf1", key: "lettuce", name: { ar: "خس", en: "Lettuce" } }],
              cheese_nuts: ["6a2ce701c2ce6c0528b5c9da"],
            },
          },
        }, {
          slotIndex: 3,
          slotKey: "sandwich",
          selectionType: "sandwich",
          sandwichId: "sandwich1",
          sandwichKey: "chicken_sandwich",
          sandwichNameI18n: { ar: "ساندويتش دجاج", en: "Chicken Sandwich" },
        }],
        addons: [{
          id: "addon1",
          key: "soup",
          nameI18n: { ar: "شوربة", en: "Soup" },
          quantity: 1,
        }],
      },
      paymentValidity: { paymentStatus: "not_required", canPrepare: true, canFulfill: false },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });

  const item = response.items[0];
  const standard = item.kitchen.meals[0];
  const premiumSalad = item.kitchen.meals[1];
  const sandwich = item.kitchen.meals[2];

  assertNoUnsafeDisplay(response);
  assert.strictEqual(standard.product.displayName, "وجبة");
  assert.strictEqual(standard.protein.displayName, "كرات لحم");
  assert.strictEqual(standard.carbs[0].displayName, "رز أبيض");
  assert(standard.display.titleAr.includes("وجبة"));
  assert(standard.display.preparationTextAr.includes("وجبة"));
  assert.strictEqual(premiumSalad.product.displayName, "سلطة كبيرة مميزة");
  assert.strictEqual(premiumSalad.salad.displayName, "سلطة كبيرة مميزة");
  assert.strictEqual(premiumSalad.salad.groups.leafy_greens[0].displayName, "خس");
  assert.strictEqual(premiumSalad.salad.groups.cheese_nuts[0].displayName, "عنصر غير معروف");
  assert(premiumSalad.dataQuality === undefined);
  assert(premiumSalad.display.titleAr.includes("سلطة كبيرة مميزة"));
  assert(premiumSalad.display.preparationTextAr.includes("سلطة كبيرة مميزة"));
  assert.strictEqual(sandwich.sandwich.displayName, "ساندويتش دجاج");
  assert.strictEqual(sandwich.protein, null);
  assert.strictEqual(item.kitchen.addons[0].displayName, "شوربة");
  assert(item.dataQuality.warnings.some((warning) => warning.code === "UNRESOLVED_SALAD_GROUP_ITEM"));

  const empty = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "empty",
      entityType: "subscription_day",
      customer: { id: "user1", name: "Sara" },
      status: "locked",
      kitchenDetails: { mealSlots: [], addons: [] },
      paymentValidity: { paymentStatus: "not_required", canPrepare: true },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  }, { includeCanceled: true });
  assert.strictEqual(empty.items[0].payment.canPrepare, false);
  assert(!empty.items[0].actions.allowed.some((action) => action.id === "prepare"));

  console.log("✅ dashboard kitchen Arabic hydration contract is safe");
}

run();
