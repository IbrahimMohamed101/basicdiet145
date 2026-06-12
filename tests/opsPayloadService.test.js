const assert = require("assert");

const {
  buildDeliveryPayload,
  buildKitchenDetailsPayload,
  buildOrderKitchenDetailsPayload,
  buildPaymentValidityPayload,
  buildPickupPayload,
  buildPlanPayload,
} = require("../src/services/dashboard/opsPayloadService");

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

  console.log("✅ ops payload service exposes plan, kitchen details, payment, delivery, and pickup fields");
}

run();
