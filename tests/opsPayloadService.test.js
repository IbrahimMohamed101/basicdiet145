const assert = require("assert");

const {
  buildDeliveryPayload,
  buildKitchenDetailsPayload,
  buildOrderKitchenDetailsPayload,
  buildPaymentValidityPayload,
  buildPickupPayload,
  buildPlanPayload,
} = require("../src/services/dashboard/opsPayloadService");
const {
  CONTRACT_VERSION,
  normalizeDashboardQueueResponse,
  normalizeKitchenQueueResponse,
  shouldUseCleanQueueContract,
} = require("../src/services/dashboard/kitchenQueueContractService");
const {
  serializeManualDeductionLog,
} = require("../src/services/dashboard/manualSubscriptionDeductionService");

function assertNoObjectObject(value, path = "root") {
  if (typeof value === "string") {
    assert(!value.includes("[object Object]"), `${path} contains [object Object]`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoObjectObject(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => assertNoObjectObject(entry, `${path}.${key}`));
  }
}

function assertDisplayText(value, path) {
  assert.strictEqual(typeof value, "string", `${path} should be a string`);
  assert(value.trim() !== "", `${path} should not be empty`);
  assert(!value.includes("[object Object]"), `${path} should not contain [object Object]`);
}

function assertKitchenDisplayFields(item) {
  assertDisplayText(item.orderSummary.display.titleAr, "orderSummary.display.titleAr");
  (item.actions.allowed || []).forEach((action, index) => {
    assert(action.label && typeof action.label === "object", `actions.allowed[${index}].label should be localized`);
    assertDisplayText(action.label.ar || action.label.en, `actions.allowed[${index}].label`);
  });
  item.kitchen.meals.forEach((meal, mealIndex) => {
    assertDisplayText(meal.product.displayName, `kitchen.meals[${mealIndex}].product.displayName`);
    if (meal.sandwich) assertDisplayText(meal.sandwich.displayName, `kitchen.meals[${mealIndex}].sandwich.displayName`);
    if (meal.protein) assertDisplayText(meal.protein.displayName, `kitchen.meals[${mealIndex}].protein.displayName`);
    meal.carbs.forEach((carb, carbIndex) => {
      assertDisplayText(carb.displayName, `kitchen.meals[${mealIndex}].carbs[${carbIndex}].displayName`);
    });
    assertDisplayText(meal.display.titleAr, `kitchen.meals[${mealIndex}].display.titleAr`);
    assertDisplayText(meal.display.preparationTextAr, `kitchen.meals[${mealIndex}].display.preparationTextAr`);
  });
}

function run() {
  const subscription = {
    _id: "sub1",
    planId: {
      _id: "plan1",
      key: "monthly_fit",
      name: { en: "Monthly Fit", ar: "شهري" },
      daysCount: 28,
      durationDays: 28,
    },
    totalMeals: 56,
    remainingMeals: 42,
    selectedMealsPerDay: 2,
    selectedGrams: 200,
    deliveryMode: "delivery",
    pickupLocationId: "main",
  };

  const day = {
    _id: "day1",
    date: "2026-06-11",
    status: "ready_for_pickup",
    plannerState: "confirmed",
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      partialSlotCount: 0,
      isDraftValid: true,
    },
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "premium_meal",
      productId: "product1",
      productKey: "basic_meal",
      proteinId: "protein1",
      proteinFamilyKey: "beef",
      carbs: [{ carbId: "carb1", grams: 150, name: { en: "Rice" } }],
      selectedOptions: [
        { groupKey: "sauce", optionId: "sauce1", optionKey: "bbq", quantity: 1, name: { en: "BBQ" } },
        { groupKey: "side", optionId: "side1", optionKey: "veg", quantity: 1, name: { en: "Vegetables" } },
      ],
      confirmationSnapshot: {
        product: { id: "product1", key: "basic_meal", name: { en: "Basic Meal" } },
        protein: { name: { en: "Beef" } },
      },
      isPremium: true,
      premiumKey: "beef_premium",
      premiumSource: "paid",
    }],
    addonSelections: [{
      addonId: "addon1",
      name: { en: "Protein Bar" },
      qty: 2,
      priceHalala: 1200,
    }],
  };

  const plan = buildPlanPayload(subscription, "en");
  assert.strictEqual(plan.id, "plan1");
  assert.strictEqual(plan.key, "monthly_fit");
  assert.strictEqual(plan.name, "Monthly Fit");
  assert.strictEqual(plan.totalMeals, 56);
  assert.strictEqual(plan.remainingMeals, 42);
  assert.strictEqual(plan.selectedMealsPerDay, 2);
  assert.strictEqual(plan.deliveryMode, "delivery");
  assert.strictEqual(plan.proteinGrams, 200);
  assert.strictEqual(plan.portionSize, "200g");

  const kitchenDetails = buildKitchenDetailsPayload(day, subscription, "en");
  assert.strictEqual(kitchenDetails.mealSlots.length, 1);
  assert.strictEqual(kitchenDetails.mealSlots[0].slotKey, "slot_1");
  assert.strictEqual(kitchenDetails.mealSlots[0].productName, "Basic Meal");
  assert.strictEqual(kitchenDetails.mealSlots[0].proteinName, "Beef");
  assert.strictEqual(kitchenDetails.mealSlots[0].proteinGrams, 200);
  assert.strictEqual(kitchenDetails.mealSlots[0].carbSelections[0].carbId, "carb1");
  assert.strictEqual(kitchenDetails.mealSlots[0].sauce[0].optionKey, "bbq");
  assert.strictEqual(kitchenDetails.mealSlots[0].sides[0].optionKey, "veg");
  assert.strictEqual(kitchenDetails.mealSlots[0].isPremium, true);
  assert.strictEqual(kitchenDetails.mealSlots[0].premiumKey, "beef_premium");
  assert.strictEqual(kitchenDetails.mealSlots[0].quantity, 1);
  assert.strictEqual(kitchenDetails.addons.length, 1);
  assert.strictEqual(kitchenDetails.addons[0].id, "addon1");
  assert.strictEqual(kitchenDetails.addons[0].quantity, 2);

  const paidValidity = buildPaymentValidityPayload(day);
  assert.strictEqual(paidValidity.paymentRequired, false);
  assert.strictEqual(paidValidity.pendingUnpaid, false);
  assert.strictEqual(paidValidity.canFulfill, true);

  const pendingValidity = buildPaymentValidityPayload({
    ...day,
    status: "ready_for_pickup",
    mealSlots: [{ ...day.mealSlots[0], premiumSource: "pending_payment", premiumExtraFeeHalala: 1200 }],
    plannerMeta: { ...day.plannerMeta, premiumSlotCount: 1, premiumPendingPaymentCount: 1, premiumTotalHalala: 1200 },
    premiumExtraPayment: { status: "pending", amountHalala: 1200, revisionHash: "rev1" },
  });
  assert.strictEqual(pendingValidity.paymentRequired, true);
  assert.strictEqual(pendingValidity.pendingUnpaid, true);
  assert.strictEqual(pendingValidity.canFulfill, false);

  const supersededValidity = buildPaymentValidityPayload({
    ...day,
    premiumExtraPayment: { status: "paid", metadata: { isSuperseded: true } },
  });
  assert.strictEqual(supersededValidity.superseded, true);
  assert.strictEqual(supersededValidity.canFulfill, false);

  const delivery = buildDeliveryPayload({ _id: "delivery1", date: "2026-06-11", status: "out_for_delivery" });
  assert.strictEqual(delivery.deliveryId, "delivery1");
  assert.strictEqual(delivery.date, "2026-06-11");
  assert.strictEqual(delivery.status, "out_for_delivery");

  const pickup = buildPickupPayload({
    pickupRequest: {
      _id: "pickup1",
      mealCount: 3,
      creditsReserved: true,
      creditsConsumedAt: null,
      creditsReleasedAt: null,
      pickupCode: "123456",
    },
    subscription,
  });
  assert.strictEqual(pickup.pickupRequestId, "pickup1");
  assert.strictEqual(pickup.mealCount, 3);
  assert.strictEqual(pickup.reserved, true);
  assert.strictEqual(pickup.remainingMeals, 42);

  const orderKitchenDetails = buildOrderKitchenDetailsPayload({
    items: [{
      itemType: "standard_meal",
      productId: "orderProduct1",
      name: { en: "Chicken Bowl" },
      qty: 2,
      selections: {
        proteinId: "protein1",
        proteinName: { en: "Chicken" },
        carbs: [{ carbId: "carb1", name: { en: "Rice" }, grams: 150 }],
      },
      selectedOptions: [{ groupKey: "sauce", optionKey: "garlic", name: { en: "Garlic" } }],
    }],
  }, "en");
  assert.strictEqual(orderKitchenDetails.mealSlots.length, 1);
  assert.strictEqual(orderKitchenDetails.mealSlots[0].productName, "Chicken Bowl");
  assert.strictEqual(orderKitchenDetails.mealSlots[0].quantity, 2);
  assert.strictEqual(orderKitchenDetails.mealSlots[0].proteinName, "Chicken");
  assert.strictEqual(orderKitchenDetails.mealSlots[0].sauce[0].optionKey, "garlic");

  const cleanResponse = normalizeKitchenQueueResponse({
    date: "2026-06-12",
    businessDate: "2026-06-12",
    items: [{
      id: "day1",
      entityId: "day1",
      entityType: "subscription_day",
      subscriptionDayId: "day1",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-12",
      status: "ready_for_pickup",
      fulfillmentType: "branch_pickup",
      plan,
      kitchenDetails,
      paymentValidity: paidValidity,
      pickup,
      delivery,
      mealSlots: day.mealSlots,
      materializedMeals: [{ operationalSku: "internal-heavy-sku" }],
      allowedActions: [{ id: "fulfill", method: "POST", endpoint: "/actions/fulfill" }],
      timestamps: { createdAt: "2026-06-12T08:00:00.000Z", updatedAt: "2026-06-12T08:30:00.000Z" },
    }],
  });
  assert.strictEqual(cleanResponse.contractVersion, CONTRACT_VERSION);
  assert.strictEqual(cleanResponse.contractVersion, "dashboard_kitchen_queue.v2");
  assert.strictEqual(cleanResponse.count, 1);
  const cleanItem = cleanResponse.items[0];
  assert(cleanItem.ids, "clean item includes ids section");
  assert(cleanItem.customer, "clean item includes customer section");
  assert(cleanItem.source, "clean item includes source section");
  assert(cleanItem.subscription, "clean item includes subscription section");
  assert(cleanItem.orderSummary, "clean item includes orderSummary section");
  assert(cleanItem.kitchen, "clean item includes kitchen section");
  assert(cleanItem.fulfillment, "clean item includes fulfillment section");
  assert(cleanItem.payment, "clean item includes payment section");
  assert(cleanItem.actions, "clean item includes actions section");
  assert.strictEqual(cleanItem.subscription.plan.proteinGrams, 200);
  assert.strictEqual(cleanItem.subscription.plan.portionSize, "200g");
  assert.strictEqual(cleanItem.kitchen.meals[0].protein.grams, 200);
  assert.strictEqual(cleanItem.orderSummary.mealCount, 1);
  assert.strictEqual(cleanItem.kitchen.meals.length, 1);
  assert.strictEqual(cleanItem.orderSummary.hasPremium, true);
  assert.strictEqual(cleanItem.orderSummary.hasAddons, true);
  assert.strictEqual(cleanItem.kitchen.addons.length, 1);
  assert.strictEqual(cleanItem.kitchen.addons[0].name.en, "Protein Bar");
  assert.strictEqual(cleanItem.kitchen.addons[0].displayName, "Protein Bar");
  assert.strictEqual(cleanItem.payment.canFulfill, true);
  assert.strictEqual(cleanItem.actions.canFulfill, true);
  assert.strictEqual(cleanItem.fulfillment.delivery.deliveryId, "delivery1");
  assert.strictEqual(cleanItem.fulfillment.delivery.status, "out_for_delivery");
  assert.strictEqual(cleanItem.fulfillment.pickup.pickupRequestId, "pickup1");
  assert.strictEqual(cleanItem.fulfillment.pickup.mealCount, 3);
  assert.strictEqual(cleanItem.raw, undefined);
  assert.strictEqual(cleanItem.mealSlots, undefined);
  assert.strictEqual(cleanItem.materializedMeals, undefined);
  assert.strictEqual(cleanItem.entityId, undefined);
  assert.strictEqual(cleanItem.allowedActions, undefined);
  assert(cleanItem.orderSummary.display.titleAr);
  assert(cleanItem.kitchen.meals[0].display.titleAr);
  assert(cleanItem.kitchen.meals[0].display.preparationTextAr);
  assertKitchenDisplayFields(cleanItem);

  const rawResponse = normalizeKitchenQueueResponse({
    date: "2026-06-12",
    items: [{ entityId: "day1", entityType: "subscription_day", kitchenDetails, paymentValidity: paidValidity, mealSlots: day.mealSlots }],
  }, { includeRaw: true });
  assert(Array.isArray(rawResponse.items[0].raw.mealSlots), "includeRaw attaches legacy internals under raw only");
  assert.strictEqual(rawResponse.items[0].entityId, "day1", "includeRaw keeps temporary legacy aliases");

  const pendingClean = normalizeKitchenQueueResponse({
    date: "2026-06-12",
    items: [{
      entityId: "pendingDay",
      entityType: "subscription_day",
      date: "2026-06-12",
      status: "ready_for_pickup",
      kitchenDetails,
      paymentValidity: pendingValidity,
      allowedActions: [{ id: "fulfill" }],
    }],
  }).items[0];
  assert.strictEqual(pendingClean.payment.pendingUnpaid, true);
  assert.strictEqual(pendingClean.payment.canFulfill, false);
  assert.strictEqual(pendingClean.actions.canFulfill, false);

  const supersededClean = normalizeKitchenQueueResponse({
    date: "2026-06-12",
    items: [{
      entityId: "supersededDay",
      entityType: "subscription_day",
      date: "2026-06-12",
      status: "ready_for_pickup",
      kitchenDetails,
      paymentValidity: supersededValidity,
      allowedActions: [{ id: "fulfill" }],
    }],
  }).items[0];
  assert.strictEqual(supersededClean.payment.superseded, true);
  assert.strictEqual(supersededClean.payment.canFulfill, false);

  const pickupQueue = normalizeDashboardQueueResponse({
    date: "2026-06-12",
    businessDate: "2026-06-12",
    items: [{
      entityId: "pickupRequest1",
      entityType: "subscription_pickup_request",
      requestId: "pickupRequest1",
      subscriptionId: "sub1",
      customer: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-12",
      status: "locked",
      fulfillmentType: "pickup_request",
      plan,
      kitchenDetails,
      paymentValidity: {
        paymentRequired: false,
        paymentStatus: "reserved",
        paymentApplied: true,
        pendingUnpaid: false,
        superseded: false,
        revisionMismatch: false,
        canPrepare: true,
        canFulfill: false,
      },
      pickup,
      snapshot: { raw: "hidden by default" },
      allowedActions: [{ id: "prepare" }, { id: "cancel" }],
    }],
  });
  const courierQueue = normalizeDashboardQueueResponse({
    date: "2026-06-12",
    businessDate: "2026-06-12",
    items: [{
      entityId: "deliveryDay1",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      subscriptionDayId: "deliveryDay1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-12",
      status: "out_for_delivery",
      fulfillmentType: "home_delivery",
      plan,
      kitchenDetails,
      paymentValidity: paidValidity,
      delivery,
      mealSlots: day.mealSlots,
      allowedActions: [{ id: "notify_arrival" }, { id: "fulfill" }],
    }],
  });
  assert.strictEqual(pickupQueue.contractVersion, CONTRACT_VERSION);
  assert.strictEqual(courierQueue.contractVersion, CONTRACT_VERSION);
  assert.strictEqual(pickupQueue.items[0].source.type, "pickup_request");
  assert.strictEqual(pickupQueue.items[0].fulfillment.type, "branch_pickup");
  assert.strictEqual(pickupQueue.items[0].fulfillment.pickup.pickupRequestId, "pickup1");
  assert.strictEqual(pickupQueue.items[0].fulfillment.pickup.mealCount, 3);
  assert.strictEqual(courierQueue.items[0].source.type, "subscription_day");
  assert.strictEqual(courierQueue.items[0].fulfillment.type, "home_delivery");
  assert.strictEqual(courierQueue.items[0].fulfillment.delivery.deliveryId, "delivery1");
  assert.strictEqual(courierQueue.items[0].payment.paymentStatus, "not_required");
  assert.deepStrictEqual(
    Object.keys(cleanResponse.items[0].actions).sort(),
    Object.keys(pickupQueue.items[0].actions).sort()
  );
  assert.deepStrictEqual(
    Object.keys(cleanResponse.items[0].actions).sort(),
    Object.keys(courierQueue.items[0].actions).sort()
  );
  assert.strictEqual(pickupQueue.items[0].snapshot, undefined);
  assert.strictEqual(courierQueue.items[0].mealSlots, undefined);
  const pickupRawQueue = normalizeDashboardQueueResponse({
    date: "2026-06-12",
    items: [{ entityId: "pickupRequest1", entityType: "subscription_pickup_request", kitchenDetails, paymentValidity: paidValidity, snapshot: { raw: true } }],
  }, { includeRaw: true });
  assert.deepStrictEqual(pickupRawQueue.items[0].raw.snapshot, { raw: true });
  assert.strictEqual(shouldUseCleanQueueContract("kitchen", {}), true);
  assert.strictEqual(shouldUseCleanQueueContract("pickup", {}), true);
  assert.strictEqual(shouldUseCleanQueueContract("courier", {}), true);
  assert.strictEqual(shouldUseCleanQueueContract("pickup", { view: "legacy" }), false);
  assert.strictEqual(shouldUseCleanQueueContract("courier", { view: "legacy" }), false);

  const sandwichResponse = normalizeKitchenQueueResponse({
    date: "2026-06-13",
    items: [{
      entityId: "sandwichDay",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-13",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan: buildPlanPayload({
        ...subscription,
        selectedGrams: 100,
      }, "ar"),
      kitchenDetails: {
        mealSlots: [{
          slotIndex: 1,
          slotKey: "slot_1",
          selectionType: "sandwich",
          productId: "sandwich1",
          productKey: "chicken_sandwich",
          productNameI18n: { ar: "ساندويتش دجاج", en: "Chicken Sandwich" },
          sandwichId: "sandwich1",
          sandwichKey: "chicken_sandwich",
          sandwichNameI18n: { ar: "ساندويتش دجاج", en: "Chicken Sandwich" },
          proteinKey: "beef",
          proteinNameI18n: { ar: "لحم", en: "Beef" },
          proteinGrams: 100,
          carbSelections: [{ carbId: "carb1", key: "rice", nameI18n: { ar: "أرز", en: "Rice" }, grams: 150 }],
          quantity: 1,
        }],
        addons: [{ id: "addon1", key: "soup", nameI18n: { ar: "شوربة", en: "Soup" }, quantity: 1 }],
      },
      paymentValidity: paidValidity,
      pickup: { pickupRequestId: "dummy" },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });
  const sandwichItem = sandwichResponse.items[0];
  const sandwichMeal = sandwichItem.kitchen.meals[0];
  assert.strictEqual(sandwichMeal.mealType, "sandwich");
  assert.strictEqual(sandwichMeal.mealTypeLabel.ar, "ساندويتش");
  assert.strictEqual(sandwichMeal.product.id, "sandwich1");
  assert.strictEqual(sandwichMeal.product.key, "chicken_sandwich");
  assert.strictEqual(sandwichMeal.product.name.ar, "ساندويتش دجاج");
  assert.strictEqual(sandwichMeal.product.name.en, "Chicken Sandwich");
  assert.strictEqual(sandwichMeal.product.displayName, "ساندويتش دجاج");
  assert.strictEqual(sandwichMeal.sandwich.id, "sandwich1");
  assert.strictEqual(sandwichMeal.sandwich.displayName, "ساندويتش دجاج");
  assert.strictEqual(sandwichMeal.protein.name.ar, "لحم");
  assert.strictEqual(sandwichMeal.protein.displayName, "لحم");
  assert.strictEqual(sandwichMeal.protein.grams, 100);
  assert.strictEqual(sandwichItem.subscription.plan.proteinGrams, 100);
  assert.strictEqual(sandwichMeal.carbs[0].name.ar, "أرز");
  assert.strictEqual(sandwichMeal.carbs[0].displayName, "أرز");
  assert.strictEqual(sandwichItem.orderSummary.addonCount, 1);
  assert.strictEqual(sandwichItem.orderSummary.itemCount, 2);
  assert.strictEqual(sandwichItem.kitchen.addons[0].name.ar, "شوربة");
  assert.strictEqual(sandwichItem.dataQuality.isComplete, true);
  assertKitchenDisplayFields(sandwichItem);

  const missingResponse = normalizeKitchenQueueResponse({
    date: "2026-06-13",
    items: [{
      entityId: "badDay",
      entityType: "subscription_day",
      date: "2026-06-13",
      status: "locked",
      kitchenDetails: {
        mealSlots: [{ slotIndex: 1, slotKey: "slot_1", selectionType: "sandwich", proteinKey: "unknown", carbSelections: [{ carbId: "missingCarb", grams: 150 }] }],
        addons: [],
      },
      paymentValidity: paidValidity,
      allowedActions: [],
    }],
  });
  const warningCodes = missingResponse.items[0].dataQuality.warnings.map((warning) => warning.code);
  assert.strictEqual(missingResponse.items[0].dataQuality.isComplete, false);
  assert(warningCodes.includes("MISSING_PRODUCT"));
  assert(warningCodes.includes("MISSING_SANDWICH"));
  assert(warningCodes.includes("MISSING_PRODUCT_NAME"));
  assert(warningCodes.includes("MISSING_PROTEIN_NAME"));
  assert(warningCodes.includes("MISSING_CARB_NAME"));
  assertDisplayText(missingResponse.items[0].kitchen.meals[0].product.displayName, "fallback product.displayName");
  assertDisplayText(missingResponse.items[0].kitchen.meals[0].sandwich.displayName, "fallback sandwich.displayName");
  assertDisplayText(missingResponse.items[0].kitchen.meals[0].protein.displayName, "fallback protein.displayName");
  assertDisplayText(missingResponse.items[0].kitchen.meals[0].carbs[0].displayName, "fallback carb.displayName");
  assertNoObjectObject(missingResponse);

  const canceledResponse = normalizeKitchenQueueResponse({
    date: "2026-06-13",
    items: [{ entityId: "canceled", entityType: "subscription_day", status: "canceled_at_branch", kitchenDetails: { mealSlots: [], addons: [] }, paymentValidity: paidValidity }],
  });
  assert.strictEqual(canceledResponse.items.length, 0);
  const includedCanceled = normalizeKitchenQueueResponse({
    date: "2026-06-13",
    items: [{ entityId: "canceled", entityType: "subscription_day", status: "canceled_at_branch", kitchenDetails: { mealSlots: [], addons: [] }, paymentValidity: paidValidity }],
  }, { includeCanceled: true });
  assert.strictEqual(includedCanceled.items[0].source.lifecycleGroup, "archived");
  assert.strictEqual(includedCanceled.items[0].source.isActionable, false);
  assert(includedCanceled.items[0].dataQuality.warnings.some((warning) => warning.code === "CANCELED_EMPTY_ROW"));

  const nestedNameResponse = normalizeKitchenQueueResponse({
    date: "2026-06-13",
    items: [{
      entityId: "nestedNames",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-13",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan: {
        id: "plan1",
        key: "nested_plan",
        name: { title: { ar: "باقة", en: "Package" } },
        proteinGrams: 100,
        portionSize: "100g",
        selectedMealsPerDay: 1,
        totalMeals: 10,
        remainingMeals: 8,
        deliveryMode: "pickup",
      },
      kitchenDetails: {
        mealSlots: [{
          slotIndex: 1,
          slotKey: "slot_1",
          selectionType: "sandwich",
          productId: "product1",
          productKey: "nested_product",
          productNameI18n: { name: { ar: "ساندويتش متداخل", en: "Nested Sandwich" } },
          sandwichId: "product1",
          sandwichKey: "nested_product",
          sandwichNameI18n: { displayName: { ar: "ساندويتش متداخل", en: "Nested Sandwich" } },
          proteinKey: "beef",
          proteinNameI18n: { value: { ar: "لحم", en: "Beef" } },
          proteinGrams: 100,
          carbSelections: [{ carbId: "carb1", key: "rice", nameI18n: { label: { ar: "أرز", en: "Rice" } }, grams: 150 }],
          sauce: [{ optionKey: "hot", name: { name: { ar: "حار", en: "Hot" } } }],
          sides: [{ optionKey: "veg", name: { title: { ar: "خضار", en: "Vegetables" } } }],
          selectedOptions: [{ optionKey: "extra", label: { value: { ar: "إضافي", en: "Extra" } } }],
          quantity: 1,
        }],
        addons: [{ id: "addon1", key: "soup", nameI18n: { displayName: { ar: "شوربة", en: "Soup" } }, quantity: 1 }],
      },
      paymentValidity: paidValidity,
      pickup: { pickupRequestId: "dummy" },
      allowedActions: [{ id: "prepare", label: { name: { ar: "تحضير", en: "Prepare" } } }],
    }],
  });
  const nestedItem = nestedNameResponse.items[0];
  assertNoObjectObject(nestedNameResponse);
  assert.strictEqual(nestedItem.subscription.plan.name.ar, "باقة");
  assert.strictEqual(nestedItem.kitchen.meals[0].product.name.ar, "ساندويتش متداخل");
  assert.strictEqual(nestedItem.kitchen.meals[0].product.displayName, "ساندويتش متداخل");
  assert.strictEqual(nestedItem.kitchen.meals[0].protein.name.ar, "لحم");
  assert.strictEqual(nestedItem.kitchen.meals[0].protein.displayName, "لحم");
  assert.strictEqual(nestedItem.kitchen.meals[0].carbs[0].name.ar, "أرز");
  assert.strictEqual(nestedItem.kitchen.meals[0].sauce[0].displayName, "حار");
  assert.strictEqual(nestedItem.kitchen.meals[0].sides[0].displayName, "خضار");
  assert.strictEqual(nestedItem.kitchen.meals[0].options[0].displayName, "إضافي");
  assert.strictEqual(nestedItem.kitchen.addons[0].displayName, "شوربة");
  assert.strictEqual(nestedItem.actions.allowed[0].label.ar, "تحضير");
  assert.strictEqual(nestedItem.kitchen.meals[0].display.titleAr, "ساندويتش متداخل - 100g");
  assert.strictEqual(nestedItem.kitchen.meals[0].display.preparationTextAr, "حضّر ساندويتش متداخل مع بروتين 100g");
  assertKitchenDisplayFields(nestedItem);

  const hydrationResponse = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "hydrationDay",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-14",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan,
      kitchenDetails: {
        mealSlots: [
          {
            slotIndex: 1,
            slotKey: "standard",
            selectionType: "standard_meal",
            productKey: "standard_meal",
            proteinKey: "meatballs",
            proteinNameI18n: { ar: "كرات لحم", en: "Meatballs" },
            proteinGrams: 100,
            carbSelections: [
              { carbId: "carb_pasta", key: "alfredo_pasta", nameI18n: { ar: "باستا الفريدو", en: "Alfredo Pasta" }, grams: 250 },
              { carbId: "6a2ce701c2ce6c0528b5c9da", grams: 120 },
            ],
            quantity: 1,
          },
          {
            slotIndex: 2,
            slotKey: "premium_salad",
            selectionType: "premium_large_salad",
            productKey: "premium_large_salad",
            proteinNameI18n: { ar: "دجاج", en: "Chicken" },
            proteinGrams: 100,
            salad: {
              presetKey: "premium_large_salad",
              groups: {
                leafy_greens: [
                  { id: "leaf1", key: "rocket", name: { ar: "جرجير", en: "Rocket" } },
                ],
                cheese_nuts: ["6a2ce701c2ce6c0528b5c9db"],
              },
            },
            quantity: 1,
          },
          {
            slotIndex: 3,
            slotKey: "sandwich",
            selectionType: "sandwich",
            sandwichId: "sandwich1",
            sandwichKey: "turkey_sandwich",
            sandwichNameI18n: { ar: "ساندويتش ديك رومي", en: "Turkey Sandwich" },
            proteinGrams: 100,
            quantity: 1,
          },
        ],
        addons: [
          { id: "addon1", key: "juice", nameI18n: { ar: "عصير", en: "Juice" }, quantity: 1 },
          { id: "6a2ce701c2ce6c0528b5c9dc", quantity: 1 },
        ],
      },
      paymentValidity: paidValidity,
      pickup: { pickupRequestId: "dummy" },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });
  const hydrationPayload = hydrationResponse.items[0];
  const hydrationJson = JSON.stringify(hydrationResponse);
  assert(!hydrationJson.includes("[object Object]"));
  assert(!hydrationJson.includes("حضّر premium_large_salad"));
  assert(!hydrationJson.includes("حضّر standard_meal"));
  assert(!hydrationJson.includes('"displayName":"premium_large_salad"'));
  assert(!hydrationJson.includes('"displayName":"standard_meal"'));
  assert.strictEqual(hydrationPayload.kitchen.meals[0].product.displayName, "وجبة");
  assert(hydrationPayload.kitchen.meals[0].display.titleAr.includes("وجبة"));
  assert(hydrationPayload.kitchen.meals[0].display.preparationTextAr.includes("وجبة"));
  assert.strictEqual(hydrationPayload.kitchen.meals[0].protein.displayName, "كرات لحم");
  assert.strictEqual(hydrationPayload.kitchen.meals[0].carbs[0].displayName, "باستا الفريدو");
  assert.strictEqual(hydrationPayload.kitchen.meals[0].carbs[1].displayName, "عنصر غير معروف");
  assert.strictEqual(hydrationPayload.kitchen.meals[1].mealTypeLabel.ar, "سلطة كبيرة مميزة");
  assert.strictEqual(hydrationPayload.kitchen.meals[1].product.displayName, "سلطة كبيرة مميزة");
  assert(hydrationPayload.kitchen.meals[1].display.titleAr.includes("سلطة كبيرة مميزة"));
  assert(hydrationPayload.kitchen.meals[1].display.preparationTextAr.includes("سلطة كبيرة مميزة"));
  assert.strictEqual(hydrationPayload.kitchen.meals[1].salad.displayName, "سلطة كبيرة مميزة");
  assert.strictEqual(hydrationPayload.kitchen.meals[1].salad.groups.leafy_greens[0].displayName, "جرجير");
  assert.strictEqual(hydrationPayload.kitchen.meals[1].salad.groups.cheese_nuts[0].displayName, "عنصر غير معروف");
  assert.deepStrictEqual(hydrationPayload.kitchen.meals[1].salad.rawIds.cheese_nuts, ["6a2ce701c2ce6c0528b5c9db"]);
  assert.strictEqual(hydrationPayload.kitchen.meals[2].sandwich.displayName, "ساندويتش ديك رومي");
  assert.strictEqual(hydrationPayload.kitchen.addons[0].displayName, "عصير");
  assert.strictEqual(hydrationPayload.kitchen.addons[1].displayName, "عنصر غير معروف");
  assert(hydrationPayload.dataQuality.warnings.some((warning) => warning.code === "UNRESOLVED_OPTION_NAME"));
  assert(hydrationPayload.dataQuality.warnings.some((warning) => warning.code === "UNRESOLVED_ADDON_NAME"));
  assert(hydrationPayload.dataQuality.warnings.some((warning) => warning.code === "UNRESOLVED_SALAD_GROUP_ITEM"));

  const semanticCompleteResponse = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "semanticDay",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-14",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan,
      kitchenDetails: {
        mealSlots: [
          { slotIndex: 1, slotKey: "standard", selectionType: "standard_meal", productKey: "standard_meal", quantity: 1 },
          { slotIndex: 2, slotKey: "premium_salad", selectionType: "premium_large_salad", productKey: "premium_large_salad", salad: { presetKey: "premium_large_salad", groups: {} }, quantity: 1 },
          // premium_meal: no productId, no productKey, no productNameI18n — must resolve via semantic label
          { slotIndex: 3, slotKey: "premium_meal", selectionType: "premium_meal", quantity: 1 },
        ],
        addons: [],
      },
      paymentValidity: paidValidity,
      pickup: { pickupRequestId: "dummy" },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });
  const semanticWarnings = semanticCompleteResponse.items[0].dataQuality.warnings.map((warning) => warning.code);
  // All three semantic meal types must be display-complete — no product-missing warnings
  assert.strictEqual(semanticCompleteResponse.items[0].dataQuality.isComplete, true,
    `Expected isComplete=true but got warnings: ${JSON.stringify(semanticCompleteResponse.items[0].dataQuality.warnings)}`);
  assert.deepStrictEqual(
    semanticCompleteResponse.items[0].dataQuality.warnings,
    [],
    `Expected no warnings but got: ${JSON.stringify(semanticCompleteResponse.items[0].dataQuality.warnings)}`
  );
  assert(!semanticWarnings.includes("MISSING_PRODUCT"));
  assert(!semanticWarnings.includes("MISSING_PRODUCT_NAME"));
  assert(!semanticWarnings.includes("FALLBACK_DISPLAY_NAME_USED"));
  // Verify each semantic meal resolves the correct Arabic label
  assert.strictEqual(semanticCompleteResponse.items[0].kitchen.meals[0].product.displayName, "وجبة");
  assert.strictEqual(semanticCompleteResponse.items[0].kitchen.meals[1].product.displayName, "سلطة كبيرة مميزة");
  assert.strictEqual(semanticCompleteResponse.items[0].kitchen.meals[2].product.displayName, "وجبة مميزة");

  // --- dedicated premium_meal semantic test: no catalog data, warns must be empty ---
  const premiumMealOnlyResponse = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "premiumMealOnly",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-14",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan,
      kitchenDetails: {
        // premium_meal with no productId/productKey/productNameI18n — identity is the semantic label
        mealSlots: [{ slotIndex: 1, slotKey: "pm", selectionType: "premium_meal", proteinGrams: 200, quantity: 1 }],
        addons: [],
      },
      paymentValidity: paidValidity,
      pickup: { pickupRequestId: "dummy" },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });
  const pmItem = premiumMealOnlyResponse.items[0];
  assert.strictEqual(pmItem.kitchen.meals[0].mealType, "premium_meal");
  assert.strictEqual(pmItem.kitchen.meals[0].product.displayName, "وجبة مميزة");
  assert.strictEqual(pmItem.kitchen.meals[0].product.name.ar, "وجبة مميزة");
  assert.strictEqual(pmItem.kitchen.meals[0].product.name.en, "Premium meal");
  assert(!pmItem.dataQuality.warnings.some((w) => w.code === "MISSING_PRODUCT"),
    "premium_meal semantic type must not produce MISSING_PRODUCT");
  assert(!pmItem.dataQuality.warnings.some((w) => w.code === "MISSING_PRODUCT_NAME"),
    "premium_meal semantic type must not produce MISSING_PRODUCT_NAME");
  assert(!pmItem.dataQuality.warnings.some((w) => w.code === "FALLBACK_DISPLAY_NAME_USED"),
    "premium_meal semantic type must not produce FALLBACK_DISPLAY_NAME_USED");
  assert.strictEqual(pmItem.dataQuality.isComplete, true,
    `premium_meal dataQuality.isComplete expected true, got warnings: ${JSON.stringify(pmItem.dataQuality.warnings)}`);
  assert.deepStrictEqual(pmItem.dataQuality.warnings, [],
    `premium_meal dataQuality.warnings expected [], got: ${JSON.stringify(pmItem.dataQuality.warnings)}`);


  const catalogAddonKitchenDetails = buildKitchenDetailsPayload({
    mealSlots: [{ slotIndex: 1, slotKey: "standard", selectionType: "standard_meal", productKey: "standard_meal" }],
    addonSelections: [{ addonId: "6a2454894a2465a2f7a0763d", name: "Dark Brownies", qty: 1 }],
  }, subscription, "ar", {
    productById: new Map([
      ["6a2454894a2465a2f7a0763d", { _id: "6a2454894a2465a2f7a0763d", key: "dark_brownies", name: { ar: "براونيز داكن", en: "Dark Brownies" } }],
    ]),
  });
  const catalogAddonResponse = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "addonArabicDay",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-14",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan,
      kitchenDetails: catalogAddonKitchenDetails,
      paymentValidity: paidValidity,
      pickup: { pickupRequestId: "dummy" },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });
  assert.strictEqual(catalogAddonResponse.items[0].kitchen.addons[0].displayName, "براونيز داكن");
  assert(!catalogAddonResponse.items[0].dataQuality.warnings.some((warning) => warning.code === "MISSING_ARABIC_ADDON_NAME"));

  const missingArabicAddonResponse = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "addonMissingArabicDay",
      entityType: "subscription_day",
      subscriptionId: "sub1",
      user: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-14",
      status: "locked",
      fulfillmentType: "branch_pickup",
      plan,
      kitchenDetails: {
        mealSlots: [{ slotIndex: 1, slotKey: "standard", selectionType: "standard_meal", productKey: "standard_meal" }],
        addons: [{ id: "addon_en", key: "english_only", nameI18n: { ar: "", en: "English Only" }, quantity: 1 }],
      },
      paymentValidity: paidValidity,
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });
  assert(missingArabicAddonResponse.items[0].dataQuality.warnings.some((warning) => (
    warning.code === "MISSING_ARABIC_ADDON_NAME"
      && warning.field === "kitchen.addons[0].name.ar"
  )));

  const oneTimeKitchenDetails = buildOrderKitchenDetailsPayload({
    items: [
      {
        itemType: "standard_meal",
        productKey: "standard_meal",
        qty: 1,
        selections: {
          proteinId: "protein1",
          proteinName: { ar: "دجاج", en: "Chicken" },
          carbs: [{ carbId: "carb1", key: "rice", name: { ar: "رز أبيض", en: "White Rice" }, grams: 120 }],
        },
      },
      {
        itemType: "premium_large_salad",
        productKey: "premium_large_salad",
        qty: 1,
        selections: {
          salad: {
            presetKey: "premium_large_salad",
            groups: { leafy_greens: [{ id: "leaf1", name: { ar: "خس", en: "Lettuce" } }] },
          },
        },
      },
      {
        itemType: "addon_item",
        productId: "addon1",
        productKey: "soup",
        name: { ar: "شوربة", en: "Soup" },
        qty: 1,
      },
    ],
  }, "ar");
  const oneTimeResponse = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "order1",
      entityType: "order",
      orderId: "order1",
      customer: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-14",
      status: "confirmed",
      fulfillmentType: "home_delivery",
      kitchenDetails: oneTimeKitchenDetails,
      paymentValidity: { paymentStatus: "paid", paymentApplied: true, canPrepare: true, canFulfill: false },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  });
  assert.strictEqual(oneTimeResponse.items[0].kitchen.meals[0].product.displayName, "وجبة");
  assert.strictEqual(oneTimeResponse.items[0].kitchen.meals[0].protein.displayName, "دجاج");
  assert.strictEqual(oneTimeResponse.items[0].kitchen.meals[0].carbs[0].displayName, "رز أبيض");
  assert.strictEqual(oneTimeResponse.items[0].kitchen.meals[1].product.displayName, "سلطة كبيرة مميزة");
  assert.strictEqual(oneTimeResponse.items[0].kitchen.meals[1].salad.groups.leafy_greens[0].displayName, "خس");
  assert.strictEqual(oneTimeResponse.items[0].kitchen.addons[0].displayName, "شوربة");
  assert(!JSON.stringify(oneTimeResponse).includes('"displayName":"standard_meal"'));
  assert(!JSON.stringify(oneTimeResponse).includes('"displayName":"premium_large_salad"'));

  const emptyPrepareResponse = normalizeKitchenQueueResponse({
    date: "2026-06-14",
    items: [{
      entityId: "emptyDay",
      entityType: "subscription_day",
      customer: { id: "user1", name: "Sara", phone: "+966500000000" },
      date: "2026-06-14",
      status: "locked",
      kitchenDetails: { mealSlots: [], addons: [] },
      paymentValidity: { paymentStatus: "not_required", canPrepare: true, canFulfill: false },
      allowedActions: [{ id: "prepare", label: { ar: "تحضير", en: "Prepare" } }],
    }],
  }, { includeCanceled: true });
  assert.strictEqual(emptyPrepareResponse.items[0].kitchen.meals.length, 0);
  assert.strictEqual(emptyPrepareResponse.items[0].payment.canPrepare, false);
  assert(!emptyPrepareResponse.items[0].actions.allowed.some((action) => action.id === "prepare"));

  const deduction = serializeManualDeductionLog({
    _id: "log1",
    entityId: "sub1",
    byUserId: "admin1",
    byRole: "admin",
    createdAt: "2026-06-12T09:00:00.000Z",
    meta: {
      subscriptionId: "sub1",
      customerId: "user1",
      businessDate: "2026-06-12",
      deductedRegularMeals: 1,
      deductedPremiumMeals: 1,
      deductedTotalMeals: 2,
      before: { remainingRegularMeals: 5, remainingPremiumMeals: 2, remainingMeals: 7 },
      after: { remainingRegularMeals: 4, remainingPremiumMeals: 1, remainingMeals: 5 },
      fulfillmentMethod: "pickup",
      actorId: "admin1",
      actorRole: "admin",
      reason: "branch pickup",
      notes: "manual counter consumption",
    },
  });
  assert.strictEqual(deduction.subscriptionId, "sub1");
  assert.strictEqual(deduction.deducted.total, 2);
  assert.strictEqual(deduction.after.remainingMeals, 5);
  assert.strictEqual(deduction.meta, undefined);

  console.log("✅ ops payload service exposes plan, kitchen details, payment, delivery, and pickup fields");
}

run();
