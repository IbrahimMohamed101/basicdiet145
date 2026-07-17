"use strict";

const assert = require("assert");

const opsController = require("../src/controllers/dashboard/opsController");
const opsReadService = require("../src/services/dashboard/opsReadService");
const { mapOrderToDTO, mapSubscriptionDayToDTO } = require("../src/services/dashboard/dashboardDtoService");
const { serializeKitchenOperation } = require("../src/services/dashboard/kitchenOperationsContractService");
const { listKitchenOperations } = require("../src/services/kitchenOperations/KitchenOperationsListService");

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function run() {
  const ids = {
    order: "6a522ed1b3fb649917aee601",
    basicSalad: "6a522ed1b3fb649917aee497",
    group: "6a522ed1b3fb649917aee602",
    arugula: "6a522ed1b3fb649917aee603",
    extraChicken: "6a522ed1b3fb649917aee604",
    day: "6a522ed1b3fb649917aee605",
    subscription: "6a522ed1b3fb649917aee606",
    sandwich: "6a522f6ab3fb649917aee76a",
    premiumSalad: "6a522ed1b3fb649917aee607",
    lettuce: "6a522ed1b3fb649917aee608",
    ranch: "6a522ed1b3fb649917aee609",
    addonProduct: "6a522ed1b3fb649917aee610",
    addonPlan: "6a522ed1b3fb649917aee611",
    addonBucket: "6a522ed1b3fb649917aee612",
  };
  const basicOptions = [{
    groupId: ids.group,
    groupName: { ar: "ورقيات", en: "Leafy greens" },
    optionId: ids.arugula,
    optionKey: "arugula",
    name: { ar: "جرجير", en: "Arugula" },
    qty: 1,
  }, {
    groupId: "6a522ed1b3fb649917aee613",
    groupName: { ar: "إضافة بروتين", en: "Extra protein" },
    optionId: ids.extraChicken,
    optionKey: "extra_chicken_50g",
    name: { ar: "زيادة 50 جرام من الدجاج", en: "Extra 50g chicken" },
    qty: 1,
    extraPriceHalala: 500,
    totalHalala: 500,
  }];
  const order = {
    _id: ids.order,
    orderNumber: "ORD-V2-1",
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentMethod: "pickup",
    fulfillmentDate: "2026-07-17",
    pickup: {
      branchId: "main",
      branchName: { ar: "الفرع الرئيسي", en: "Main Branch" },
      pickupWindow: "18:00-20:00",
    },
    pricing: {
      subtotalHalala: 3400,
      deliveryFeeHalala: 0,
      discountHalala: 0,
      totalHalala: 3400,
      vatPercentage: 16,
      vatHalala: 469,
      vatIncluded: true,
      currency: "SAR",
    },
    userId: { _id: "6a522ed1b3fb649917aee620", name: "Order User", phone: "0100" },
    items: [{
      itemType: "basic_salad",
      productId: ids.basicSalad,
      name: { ar: "سلطة على مزاجك – 100جرام بروتين", en: "Build Your Salad" },
      productSnapshot: { key: "basic_salad" },
      qty: 1,
      unitPriceHalala: 3400,
      lineTotalHalala: 3400,
      currency: "SAR",
      pricingSnapshot: {
        basePriceHalala: 2900,
        optionsTotalHalala: 500,
        unitPriceHalala: 3400,
        lineTotalHalala: 3400,
        currency: "SAR",
        vatIncluded: true,
      },
      selectedOptions: basicOptions,
      selections: { selectedOptions: basicOptions.map((option) => ({ ...option })) },
    }],
  };
  const catalogMaps = {
    optionById: new Map(basicOptions.map((option) => [option.optionId, {
      _id: option.optionId,
      key: option.optionKey,
      name: option.name,
    }])),
    optionByKey: new Map(),
    productById: new Map([
      [ids.premiumSalad, { _id: ids.premiumSalad, key: "premium_large_salad", name: { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" } }],
      [ids.addonProduct, { _id: ids.addonProduct, key: "orange_juice", name: { ar: "عصير برتقال", en: "Orange Juice" }, priceHalala: 900 }],
    ]),
    productByKey: new Map(),
    sandwichById: new Map([[ids.sandwich, {
      _id: ids.sandwich,
      key: "beef_burger_sandwich",
      name: { ar: "برجر لحم", en: "Beef Burger" },
    }]]),
    sandwichByKey: new Map(),
    saladItemById: new Map([
      [ids.lettuce, { _id: ids.lettuce, key: "lettuce", name: { ar: "خس", en: "Lettuce" } }],
      [ids.ranch, { _id: ids.ranch, key: "ranch", name: { ar: "رانش", en: "Ranch" } }],
    ]),
    saladItemByKey: new Map(),
    proteinById: new Map(),
    proteinByKey: new Map(),
    addonPlanById: new Map([[ids.addonPlan, {
      _id: ids.addonPlan,
      name: { ar: "عصائر", en: "Juices" },
    }]]),
    addonById: new Map(),
    addonByKey: new Map(),
  };

  const orderDto = mapOrderToDTO(order, null, order.userId, "kitchen", "ar", catalogMaps);
  const cleanOrder = serializeKitchenOperation(orderDto);
  assert.strictEqual(cleanOrder.kitchen.version, "v2");
  assert.strictEqual(cleanOrder.kitchen.cards[0].title, "سلطة على مزاجك – 100جرام بروتين");
  assert(cleanOrder.kitchen.cards[0].lines.length > 0);
  assert(cleanOrder.kitchen.cards[0].sections.length > 0);
  assert(cleanOrder.kitchen.cards[0].components.salad);
  assert.strictEqual(cleanOrder.kitchen.cards[0].components.salad.sections, undefined);
  assert.strictEqual(
    cleanOrder.kitchen.cards[0].components.salad.sectionCount,
    cleanOrder.kitchen.cards[0].sections.length
  );
  assert.strictEqual(
    cleanOrder.kitchen.cards[0].components.salad.itemCount,
    cleanOrder.kitchen.cards[0].sections.flatMap((section) => section.items).length
  );
  assert.strictEqual(cleanOrder.kitchen.cards[0].rawSelection, undefined);
  assert.strictEqual(cleanOrder.kitchenDetails, undefined);
  assert.strictEqual(cleanOrder.kitchenCards, undefined);
  assert.strictEqual(cleanOrder.kitchenAddonGroups, undefined);
  assert.strictEqual(cleanOrder.customer.name, "Order User");
  assert.deepStrictEqual(cleanOrder.allowedActions.map((action) => action.id), ["prepare", "cancel"]);
  assert.strictEqual(cleanOrder.items[0].selectedOptions.length, basicOptions.length);
  assert.strictEqual(cleanOrder.items[0].pricingSnapshot.basePriceHalala, 2900);
  assert.strictEqual(cleanOrder.items[0].pricingSnapshot.optionsTotalHalala, 500);
  assert.strictEqual(cleanOrder.items[0].pricingSnapshot.lineTotalHalala, 3400);
  assert.strictEqual(cleanOrder.pricing.totalHalala, 3400);
  assert.strictEqual(cleanOrder.fulfillment.pickup.branchName.ar, "الفرع الرئيسي");
  assert.strictEqual(cleanOrder.fulfillment.pickup.pickupWindow, "18:00-20:00");
  assert(!JSON.stringify(cleanOrder.kitchen).includes("selectedOptions"));
  assert(!JSON.stringify(cleanOrder).includes('"priceHalala"'));

  const rawOrder = serializeKitchenOperation(orderDto, { includeRaw: true });
  assert(rawOrder.kitchen.cards[0].rawSelection);
  assert.deepStrictEqual(
    rawOrder.kitchen.cards[0].components.salad.sections,
    rawOrder.kitchen.cards[0].sections
  );
  assert.strictEqual(rawOrder.kitchen.resolverDebug.sourceProjectionVersion, "v1");
  const legacyOrder = serializeKitchenOperation(orderDto, { includeLegacy: true });
  assert(legacyOrder.kitchenDetails);
  assert.strictEqual(legacyOrder.kitchenDetails.mealSlots[0].selectedOptions.length, basicOptions.length);
  assert(Array.isArray(legacyOrder.kitchenCards));
  assert(Array.isArray(legacyOrder.kitchenAddonGroups));

  const subscription = {
    _id: ids.subscription,
    planId: { _id: "6a522ed1b3fb649917aee621", key: "basic", name: { ar: "أساسي", en: "Basic" } },
    selectedGrams: 100,
    selectedMealsPerDay: 2,
    totalMeals: 20,
    remainingMeals: 18,
    deliveryMode: "delivery",
    addonSubscriptions: [{
      addonPlanId: ids.addonPlan,
      balanceBucketId: ids.addonBucket,
      addonPlanNameI18n: { ar: "عصائر", en: "Juices" },
      entitlementKey: "juice",
      menuProductsSnapshot: [{
        id: ids.addonProduct,
        key: "orange_juice",
        name: { ar: "عصير برتقال", en: "Orange Juice" },
        priceHalala: 900,
      }],
    }],
  };
  const day = {
    _id: ids.day,
    subscriptionId: ids.subscription,
    date: "2026-07-17",
    status: "open",
    mealSlots: [{
      slotIndex: 1,
      slotKey: "sandwich",
      selectionType: "sandwich",
      sandwichId: ids.sandwich,
    }, {
      slotIndex: 2,
      slotKey: "premium_salad",
      selectionType: "premium_large_salad",
      salad: { groups: { leafy_greens: [ids.lettuce], sauce: [ids.ranch] } },
    }],
    premiumUpgradeSelections: [{
      baseSlotKey: "premium_salad",
      sourceProductId: ids.premiumSalad,
      sourceKey: "premium_large_salad",
      nameI18n: { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" },
    }],
    addonSelections: [{
      addonId: ids.addonProduct,
      productId: ids.addonProduct,
      productKey: "orange_juice",
      addonPlanId: ids.addonPlan,
      balanceBucketId: ids.addonBucket,
      qty: 1,
      priceHalala: 0,
      unitPriceHalala: 20000,
      payableTotalHalala: 0,
    }],
  };
  const dayDto = mapSubscriptionDayToDTO(day, null, subscription, null, "kitchen", "ar", catalogMaps);
  const cleanDay = serializeKitchenOperation(dayDto);
  assert.strictEqual(cleanDay.subscriptionId, ids.subscription);
  assert.strictEqual(cleanDay.kitchen.cards.find((card) => card.type === "sandwich").title, "برجر لحم");
  const premiumSalad = cleanDay.kitchen.cards.find((card) => card.type === "premium_large_salad");
  assert.strictEqual(premiumSalad.title, "سلطة كبيرة مميزة");
  assert(premiumSalad.sections.length > 0);
  assert.strictEqual(cleanDay.kitchen.addonGroups.length, 1);
  assert.strictEqual(cleanDay.kitchen.addonGroups[0].addonPlanId, ids.addonPlan);
  assert.strictEqual(cleanDay.kitchen.addonGroups[0].items[0].payableTotalHalala, 0);
  assert(!Object.prototype.hasOwnProperty.call(cleanDay, "kitchenAddonGroups"));
  assert(!JSON.stringify(cleanDay).includes('"priceHalala"'));

  const originalListOperations = opsReadService.listOperations;
  try {
    opsReadService.listOperations = async () => [orderDto];
    const defaultResponse = mockResponse();
    await opsController.listOperations({
      query: { date: "2026-07-17" },
      userRole: "kitchen",
      headers: {},
    }, defaultResponse);
    assert.strictEqual(defaultResponse.statusCode, 200);
    assert.strictEqual(defaultResponse.body.data[0].kitchen.version, "v2");
    assert.strictEqual(defaultResponse.body.data[0].kitchenDetails, undefined);

    const legacyResponse = mockResponse();
    await opsController.listOperations({
      query: { date: "2026-07-17", includeLegacy: "true", includeRaw: "true" },
      userRole: "kitchen",
      headers: {},
    }, legacyResponse);
    assert(legacyResponse.body.data[0].kitchenDetails);
    assert(legacyResponse.body.data[0].kitchen.cards[0].rawSelection);
  } finally {
    opsReadService.listOperations = originalListOperations;
  }

  const kitchenList = await listKitchenOperations({
    date: "2026-07-17",
    tab: "orders",
  }, {
    runtime: {
      fetchOrdersByDate: async () => [order],
      fetchMealNameMap: async () => new Map(),
      fetchAddonNameMap: async () => new Map(),
      buildKitchenCatalogMaps: async () => catalogMaps,
    },
  });
  assert.strictEqual(kitchenList.rows[0].kitchen.version, "v2");
  assert.strictEqual(kitchenList.rows[0].kitchenDetails, undefined);
  assert.strictEqual(kitchenList.rows[0].kitchen.cards[0].rawSelection, undefined);

  console.log("✅ operations and kitchen default responses use the clean v2 contract");
}

run().catch((error) => {
  console.error(`❌ kitchen operations v2 contract failed: ${error.stack || error.message}`);
  process.exit(1);
});
