"use strict";

process.env.NODE_ENV = "test";
process.env.SUBSCRIPTION_STACKING_READ_ENABLED = "true";
process.env.SUBSCRIPTION_STACKING_WRITE_ENABLED = "true";
process.env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS = "false";
process.env.SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED = "true";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

mongoose.set("autoIndex", false);

const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementDayBlueprint = require(
  "../src/models/SubscriptionEntitlementDayBlueprint"
);
const SubscriptionEntitlementAllocation = require(
  "../src/models/SubscriptionEntitlementAllocation"
);
const SubscriptionExtraEntitlementBucket = require(
  "../src/models/SubscriptionExtraEntitlementBucket"
);
const SubscriptionExtraEntitlementAllocation = require(
  "../src/models/SubscriptionExtraEntitlementAllocation"
);
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");
require("../src/models/Plan");

// Match production startup ordering: repair composition first, then stacking
// selection/entitlement, planned Pickup, and read projection installers.
require("../src/services/installSubscriptionBackendRepairComposition");
require("../src/services/installSubscriptionStackingSelectionRouter");
require("../src/services/installSubscriptionStackingEntitlementRouter");
require("../src/services/installSubscriptionStackingPlannedPickupRouter");
require("../src/services/installSubscriptionStackingPickupAvailabilityProjection");

const selectionService = require("../src/services/subscription/subscriptionSelectionService");
const pickupBalanceService = require(
  "../src/services/subscription/subscriptionPickupRequestBalanceService"
);
const {
  fulfillSubscriptionPickupRequest,
} = require("../src/services/fulfillmentService");
const {
  applyPaymentSideEffects,
} = require("../src/services/paymentApplicationService");
const {
  activatePinnedExtrasPaidDraftIntoExistingContainerTransactional,
} = require("../src/services/subscription/subscriptionStackingActivationService");
const {
  applyPinnedExtrasPaidDraftToSubscriptionStackTransactional,
} = require(
  "../src/services/subscription/subscriptionStackingPaidDraftOrchestratorService"
);
const {
  buildPinnedExtraActivationSnapshot,
} = require(
  "../src/services/subscription/subscriptionStackingExtraActivationAuthorityService"
);
const {
  runMongoTransactionWithRetry,
} = require("../src/services/mongoTransactionRetryService");
const {
  executeAction,
} = require("../src/services/dashboard/opsTransitionService");

let replSet;
let sequence = 0;

function oid() {
  return new mongoose.Types.ObjectId();
}

function ksaDate(value) {
  return new Date(`${value}T00:00:00+03:00`);
}

function assertExtraConservation(row) {
  assert.strictEqual(
    row.remainingQty + row.reservedQty + row.consumedQty + row.forfeitedQty,
    row.purchasedQty
  );
}

function assertBatchConservation(row) {
  assert.strictEqual(
    row.remainingMeals + row.reservedMeals + row.consumedMeals + row.forfeitedMeals,
    row.totalMeals
  );
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replSet.getUri(), {
    dbName: "subscription_stacking_final_integration_candidate",
    autoIndex: false,
  });
  for (const model of [
    CheckoutDraft,
    Payment,
    Subscription,
    SubscriptionDay,
    SubscriptionPickupRequest,
    SubscriptionEntitlementBatch,
    SubscriptionEntitlementDayBlueprint,
    SubscriptionEntitlementAllocation,
    SubscriptionExtraEntitlementBucket,
    SubscriptionExtraEntitlementAllocation,
    BuilderCategory,
    BuilderProtein,
    BuilderCarb,
  ]) {
    await model.createCollection().catch((err) => {
      if (err.codeName !== "NamespaceExists") throw err;
    });
    await model.syncIndexes();
  }
}

async function clearDatabase() {
  await Promise.all([
    CheckoutDraft.deleteMany({}),
    Payment.deleteMany({}),
    Subscription.deleteMany({}),
    SubscriptionDay.deleteMany({}),
    SubscriptionPickupRequest.deleteMany({}),
    SubscriptionEntitlementBatch.deleteMany({}),
    SubscriptionEntitlementDayBlueprint.deleteMany({}),
    SubscriptionEntitlementAllocation.deleteMany({}),
    SubscriptionExtraEntitlementBucket.deleteMany({}),
    SubscriptionExtraEntitlementAllocation.deleteMany({}),
    BuilderCategory.deleteMany({}),
    BuilderProtein.deleteMany({}),
    BuilderCarb.deleteMany({}),
    mongoose.connection.collection("plans").deleteMany({}),
  ]);
}

async function createPurchaseFixture() {
  sequence += 1;
  const userId = oid();
  const oldPlanId = oid();
  const newPlanId = oid();
  const addonId = oid();
  await mongoose.connection.collection("plans").insertMany([
    { _id: oldPlanId, name: `old-${sequence}` },
    { _id: newPlanId, name: `new-${sequence}` },
  ]);

  const container = await Subscription.create({
    userId,
    planId: oldPlanId,
    status: "active",
    startDate: ksaDate("2026-08-01"),
    endDate: ksaDate("2026-08-26"),
    validityEndDate: ksaDate("2026-08-26"),
    totalMeals: 78,
    remainingMeals: 20,
    selectedMealsPerDay: 3,
    selectedGrams: 200,
    deliveryMode: "delivery",
    deliveryWindow: "13:00-15:00",
    deliverySlot: {
      type: "delivery",
      window: "13:00-15:00",
      slotId: "candidate-slot",
      label: "13:00-15:00",
    },
    deliveryAddress: { city: "Riyadh", district: "Test", street: "Candidate" },
  });

  const premiumItems = [{
    premiumKey: "shrimp",
    qty: 4,
    unitExtraFeeHalala: 250,
    totalHalala: 1000,
    currency: "SAR",
  }];
  const addons = [{
    addonId,
    addonPlanId: addonId,
    name: "Pinned Salad",
    addonPlanName: "Pinned Salad",
    category: "salad",
    allowanceCategory: "salad",
    displayKey: "salad",
    displayCategory: "salad",
    entitlementKey: `salad:${addonId}`,
    quantityPerDay: 1,
    purchasedDailyQty: 1,
    includedTotalQty: 10,
    unitPlanPriceHalala: 125,
    unitPriceHalala: 125,
    totalHalala: 1250,
    currency: "SAR",
    menuProductIds: [addonId],
  }];
  const extraEntitlements = buildPinnedExtraActivationSnapshot({
    premiumItems,
    addonSubscriptions: addons,
    daysCount: 26,
  });
  const startDate = ksaDate("2026-08-06");
  const endDate = ksaDate("2026-08-31");
  const draft = await CheckoutDraft.create({
    userId,
    planId: newPlanId,
    idempotencyKey: `candidate-${sequence}`,
    requestHash: `candidate-hash-${sequence}`,
    status: "pending_payment",
    daysCount: 26,
    grams: 150,
    mealsPerDay: 2,
    startDate,
    delivery: {
      type: "delivery",
      address: container.deliveryAddress,
      slot: { type: "delivery", window: "13:00-15:00", slotId: "candidate-slot" },
    },
    premiumItems,
    addonSubscriptions: addons,
    breakdown: {
      basePlanPriceHalala: 10000,
      premiumTotalHalala: 1000,
      addonsTotalHalala: 1250,
      deliveryFeeHalala: 0,
      vatHalala: 0,
      totalHalala: 12250,
      currency: "SAR",
    },
    contractHash: `candidate-contract-${sequence}`,
    contractSnapshot: {
      plan: { planId: newPlanId, daysCount: 26, mealsPerDay: 2, selectedGrams: 150 },
      start: { resolvedStartDate: startDate },
      pricing: { premiumTotalHalala: 1000, currency: "SAR" },
    },
    stackingFinalization: {
      version: "subscription_stacking.finalization.v1",
      mode: "additive_existing_parent",
      expectedParentSubscriptionId: container._id,
      decidedAt: new Date(),
      extraEntitlements,
    },
  });
  const payment = await Payment.create({
    provider: "moyasar",
    type: "subscription_activation",
    status: "paid",
    applied: false,
    amount: 12250,
    currency: "SAR",
    userId,
    providerInvoiceId: `inv_candidate_${sequence}`,
    metadata: { draftId: String(draft._id), userId: String(userId) },
  });
  const subscriptionPayload = {
    userId,
    planId: newPlanId,
    startDate,
    endDate,
    validityEndDate: endDate,
    totalMeals: 52,
    remainingMeals: 52,
    selectedMealsPerDay: 2,
    selectedGrams: 150,
    deliveryMode: "delivery",
    deliveryAddress: container.deliveryAddress,
    deliveryWindow: "13:00-15:00",
    deliverySlot: { type: "delivery", window: "13:00-15:00", slotId: "candidate-slot" },
    premiumBalance: premiumItems.map((row) => ({
      ...row,
      purchasedQty: row.qty,
      remainingQty: row.qty,
    })),
    addonSubscriptions: addons,
    addonBalance: extraEntitlements.addons.balances,
    checkoutCurrency: "SAR",
  };

  process.env.SUBSCRIPTION_STACKING_USER_IDS = String(userId);
  process.env.SUBSCRIPTION_STACKING_EXTRA_SELECTION_USER_IDS = String(userId);
  return {
    userId,
    addonId,
    container,
    draft,
    payment,
    subscriptionPayload,
  };
}

async function finalizePayment(source, channel = "webhook") {
  return runMongoTransactionWithRetry(async (session) => {
    const [draft, payment] = await Promise.all([
      CheckoutDraft.findById(source.draft._id).session(session),
      Payment.findById(source.payment._id).session(session),
    ]);
    const serviceArgs = {
      draft,
      payment,
      businessDate: "2026-08-12",
      expectedParentSubscriptionId: source.container._id,
      session,
      runtime: {
        buildActivationPayload: async () => ({
          subscriptionPayload: source.subscriptionPayload,
        }),
        activateIntoContainer: (args) => (
          activatePinnedExtrasPaidDraftIntoExistingContainerTransactional(args)
        ),
      },
    };
    return applyPaymentSideEffects(
      { payment, session, source: channel },
      {
        findDraftById: async () => draft,
        finalizeSubscriptionDraftPaymentFlow: () => (
          applyPinnedExtrasPaidDraftToSubscriptionStackTransactional(serviceArgs)
        ),
      }
    );
  }, { label: `candidate_payment_${channel}`, maxRetries: 30, baseDelayMs: 1 });
}

async function createCatalog() {
  const proteinCategory = await BuilderCategory.create({
    key: `candidate-protein-${sequence}`,
    dimension: "protein",
    isActive: true,
  });
  const carbCategory = await BuilderCategory.create({
    key: `candidate-carb-${sequence}`,
    dimension: "carb",
    isActive: true,
  });
  const premiumProtein = await BuilderProtein.create({
    key: `candidate-shrimp-${sequence}`,
    name: { en: "Shrimp" },
    displayCategoryId: proteinCategory._id,
    displayCategoryKey: "premium",
    proteinFamilyKey: "seafood",
    selectionType: "premium_meal",
    isPremium: true,
    premiumKey: "shrimp",
    premiumCreditCost: 1,
    extraFeeHalala: 250,
    availableForSubscription: true,
    isActive: true,
  });
  const standardProtein = await BuilderProtein.create({
    key: `candidate-chicken-${sequence}`,
    name: { en: "Chicken" },
    displayCategoryId: proteinCategory._id,
    displayCategoryKey: "standard",
    proteinFamilyKey: "chicken",
    selectionType: "standard_meal",
    isPremium: false,
    availableForSubscription: true,
    isActive: true,
  });
  const carb = await BuilderCarb.create({
    key: `candidate-rice-${sequence}`,
    name: { en: "Rice" },
    displayCategoryId: carbCategory._id,
    displayCategoryKey: "standard_carbs",
    availableForSubscription: true,
    isActive: true,
  });
  return { premiumProtein, standardProtein, carb };
}

function mealSlots(catalog) {
  return Array.from({ length: 5 }, (_, offset) => {
    const slotIndex = offset + 1;
    const premium = slotIndex === 1;
    return {
      slotIndex,
      slotKey: `slot_${slotIndex}`,
      selectionType: premium ? "premium_meal" : "standard_meal",
      proteinId: premium ? catalog.premiumProtein._id : catalog.standardProtein._id,
      carbs: [{ carbId: catalog.carb._id, grams: 150 }],
    };
  });
}

async function saveDay(source, catalog) {
  return selectionService.performDaySelectionUpdate({
    userId: source.userId,
    subscriptionId: source.container._id,
    date: "2026-08-12",
    mealSlots: mealSlots(catalog),
    requestedOneTimeAddonIds: [source.addonId],
    getBusinessDate: async () => "2026-08-12",
  });
}

async function confirmDay(source) {
  return selectionService.performDayPlanningConfirmation({
    userId: source.userId,
    subscriptionId: source.container._id,
    date: "2026-08-12",
    getBusinessDate: async () => "2026-08-12",
  });
}

function pickupItems(slotKeys) {
  return slotKeys.map((slotKey, offset) => ({
    itemId: slotKey,
    itemType: "meal",
    source: "mealSlot",
    sourceId: slotKey,
    slotId: slotKey,
    slotKey,
    slotIndex: offset + 1,
    selectionType: offset === 0 ? "premium_meal" : "standard_meal",
    quantity: 1,
  }));
}

async function createPickup(source, day, suffix, status = "ready_for_pickup") {
  const slotKeys = day.mealSlots.map((row) => row.slotKey);
  return SubscriptionPickupRequest.create({
    subscriptionId: source.container._id,
    subscriptionDayId: day._id,
    userId: source.userId,
    date: day.date,
    mealCount: slotKeys.length,
    selectionMode: "pickup_item_ids",
    selectedMealSlotIds: slotKeys,
    selectedPickupItemIds: slotKeys,
    selectedPickupItems: pickupItems(slotKeys),
    status,
    creditsReserved: false,
    snapshot: { mealSlots: pickupItems(slotKeys) },
    payloadHash: `candidate-pickup-${sequence}-${suffix}`,
  });
}

function reservePickup(source, pickup) {
  return runMongoTransactionWithRetry((session) => (
    pickupBalanceService.reserveSubscriptionMealsForPickupRequest({
      subscriptionId: source.container._id,
      pickupRequestId: pickup._id,
      mealCount: pickup.mealCount,
      session,
    })
  ), { label: "candidate_pickup_reserve", maxRetries: 30, baseDelayMs: 1 });
}

function releasePickup(source, pickup) {
  return runMongoTransactionWithRetry((session) => (
    pickupBalanceService.releaseReservedPickupMeals({
      subscriptionId: source.container._id,
      pickupRequestId: pickup._id,
      session,
    })
  ), { label: "candidate_pickup_release", maxRetries: 30, baseDelayMs: 1 });
}

async function snapshot(source) {
  const [batches, buckets, baseAllocations, extraAllocations, day, payment, draft] = await Promise.all([
    SubscriptionEntitlementBatch.find({
      containerSubscriptionId: source.container._id,
    }).sort({ sourceType: 1, _id: 1 }).lean(),
    SubscriptionExtraEntitlementBucket.find({
      containerSubscriptionId: source.container._id,
    }).sort({ kind: 1, walletKey: 1 }).lean(),
    SubscriptionEntitlementAllocation.find({
      containerSubscriptionId: source.container._id,
    }).sort({ slotKey: 1 }).lean(),
    SubscriptionExtraEntitlementAllocation.find({
      containerSubscriptionId: source.container._id,
    }).sort({ reservationKey: 1 }).lean(),
    SubscriptionDay.findOne({ subscriptionId: source.container._id, date: "2026-08-12" }).lean(),
    Payment.findById(source.payment._id).lean(),
    CheckoutDraft.findById(source.draft._id).lean(),
  ]);
  return { batches, buckets, baseAllocations, extraAllocations, day, payment, draft };
}

async function testPaymentSelectionPickupLifecycle() {
  await clearDatabase();
  const source = await createPurchaseFixture();
  await finalizePayment(source, "webhook");
  const catalog = await createCatalog();

  await Promise.all(Array.from({ length: 20 }, () => saveDay(source, catalog)));
  let current = await snapshot(source);
  assert.strictEqual(await Subscription.countDocuments({ userId: source.userId, status: "active" }), 1);
  assert.strictEqual(current.batches.length, 2);
  assert.strictEqual(current.buckets.length, 2);
  assert.strictEqual(current.extraAllocations.length, 2);
  assert.strictEqual(current.extraAllocations.filter((row) => row.state === "reserved").length, 2);
  assert.strictEqual(current.day.subscriptionId.toString(), source.container._id.toString());
  assert.strictEqual(current.day.premiumUpgradeSelections.length, 1);
  assert.strictEqual(current.day.addonSelections.length, 1);

  await confirmDay(source);
  current = await snapshot(source);
  assert.strictEqual(current.baseAllocations.length, 5);
  assert.strictEqual(current.baseAllocations.filter((row) => row.state === "reserved").length, 5);
  const countersBeforePickup = current.buckets.map((row) => [
    row.walletKey, row.remainingQty, row.reservedQty, row.consumedQty,
  ]);

  const canceledPickup = await createPickup(source, current.day, "cancel", "in_preparation");
  const firstReservation = await reservePickup(source, canceledPickup);
  assert.strictEqual(firstReservation.reserved, true);
  assert.strictEqual(firstReservation.allocationMode, "linked_day");
  assert.deepStrictEqual(
    [...firstReservation.pickupRequest.selectedPickupItemIds].sort(),
    current.day.mealSlots.map((row) => row.slotKey).sort()
  );
  current = await snapshot(source);
  assert.deepStrictEqual(
    current.buckets.map((row) => [
      row.walletKey, row.remainingQty, row.reservedQty, row.consumedQty,
    ]),
    countersBeforePickup
  );
  assert.strictEqual(current.extraAllocations.length, 2);
  assert.ok(current.baseAllocations.every((row) => (
    String(row.pickupRequestId) === String(canceledPickup._id)
  )));

  const [confirmationReplay, cancellation] = await Promise.all([
    confirmDay(source),
    executeAction("cancel", {
      entityId: canceledPickup._id,
      entityType: "subscription_pickup_request",
      userId: source.userId,
      role: "admin",
      payload: { reason: "candidate_pre_fulfillment_cancel" },
    }),
  ]);
  assert(confirmationReplay);
  assert.strictEqual(cancellation.status, "canceled");
  current = await snapshot(source);
  assert.ok(current.baseAllocations.every((row) => row.state === "reserved"));
  assert.ok(current.baseAllocations.every((row) => !row.pickupRequestId));
  assert.strictEqual(current.extraAllocations.filter((row) => row.state === "reserved").length, 2);
  assert.deepStrictEqual(
    current.buckets.map((row) => [
      row.walletKey, row.remainingQty, row.reservedQty, row.consumedQty,
    ]),
    countersBeforePickup
  );

  const contenders = await Promise.all(Array.from({ length: 20 }, (_, index) => (
    createPickup(source, current.day, `race-${index}`)
  )));
  const outcomes = await Promise.allSettled(contenders.map((row) => reservePickup(source, row)));
  assert.strictEqual(outcomes.filter((row) => row.status === "fulfilled").length, 1);
  const activePickup = await SubscriptionPickupRequest.findOne({
    _id: { $in: contenders.map((row) => row._id) },
    creditsReserved: true,
    creditsReleasedAt: null,
  });
  assert(activePickup);
  current = await snapshot(source);
  assert.strictEqual(current.baseAllocations.length, 5);
  assert.ok(current.baseAllocations.every((row) => (
    row.state === "reserved"
    && String(row.pickupRequestId) === String(activePickup._id)
  )));
  assert.strictEqual(current.extraAllocations.length, 2);
  assert.strictEqual(current.extraAllocations.filter((row) => row.state === "reserved").length, 2);

  const fulfilledPickup = await executeAction("fulfill", {
    entityId: activePickup._id,
    entityType: "subscription_pickup_request",
    userId: source.userId,
    role: "admin",
    payload: {},
  });
  assert.strictEqual(fulfilledPickup.status, "fulfilled");
  const fulfillmentActionReplay = await executeAction("fulfill", {
    entityId: activePickup._id,
    entityType: "subscription_pickup_request",
    userId: source.userId,
    role: "admin",
    payload: {},
  });
  assert.strictEqual(fulfillmentActionReplay.status, "fulfilled");
  const replayFulfillment = await fulfillSubscriptionPickupRequest({ requestId: activePickup._id });
  assert.strictEqual(replayFulfillment.ok, true);
  assert.strictEqual(replayFulfillment.alreadyFulfilled, true);

  current = await snapshot(source);
  assert.strictEqual(current.baseAllocations.filter((row) => row.state === "consumed").length, 5);
  assert.strictEqual(current.extraAllocations.filter((row) => row.state === "consumed").length, 2);
  assert.ok(current.batches.every((row) => {
    assertBatchConservation(row);
    return true;
  }));
  assert.ok(current.buckets.every((row) => {
    assertExtraConservation(row);
    return true;
  }));
  const mutableBeforePaymentReplay = {
    batches: current.batches.map((row) => [
      String(row._id), row.remainingMeals, row.reservedMeals, row.consumedMeals, row.forfeitedMeals,
    ]),
    buckets: current.buckets.map((row) => [
      String(row._id), row.remainingQty, row.reservedQty, row.consumedQty, row.forfeitedQty,
    ]),
    base: current.baseAllocations.map((row) => [row.allocationKey, row.state]),
    extras: current.extraAllocations.map((row) => [row.reservationKey, row.state]),
  };

  for (let index = 0; index < 10; index += 1) {
    await finalizePayment(source, index % 2 === 0 ? "api_verify" : "webhook");
  }
  current = await snapshot(source);
  assert.deepStrictEqual(current.batches.map((row) => [
    String(row._id), row.remainingMeals, row.reservedMeals, row.consumedMeals, row.forfeitedMeals,
  ]), mutableBeforePaymentReplay.batches);
  assert.deepStrictEqual(current.buckets.map((row) => [
    String(row._id), row.remainingQty, row.reservedQty, row.consumedQty, row.forfeitedQty,
  ]), mutableBeforePaymentReplay.buckets);
  assert.deepStrictEqual(
    current.baseAllocations.map((row) => [row.allocationKey, row.state]),
    mutableBeforePaymentReplay.base
  );
  assert.deepStrictEqual(
    current.extraAllocations.map((row) => [row.reservationKey, row.state]),
    mutableBeforePaymentReplay.extras
  );
  assert.strictEqual(current.payment.applied, true);
  assert.strictEqual(current.draft.status, "completed");
}

async function testPickupFulfillmentReleaseRaceIsAtomic() {
  await clearDatabase();
  const source = await createPurchaseFixture();
  await finalizePayment(source, "api_verify");
  const catalog = await createCatalog();
  await saveDay(source, catalog);
  await confirmDay(source);
  let current = await snapshot(source);
  const pickup = await createPickup(source, current.day, "fulfill-release-race");
  await reservePickup(source, pickup);

  const race = await Promise.allSettled([
    fulfillSubscriptionPickupRequest({ requestId: pickup._id }),
    releasePickup(source, pickup),
  ]);
  const semanticSuccesses = race.filter((row, index) => (
    row.status === "fulfilled"
    && (index === 0 ? row.value && row.value.ok === true : row.value && row.value.released === true)
  ));
  assert.strictEqual(semanticSuccesses.length, 1);
  current = await snapshot(source);
  const baseStates = new Set(current.baseAllocations.map((row) => row.state));
  const extraStates = new Set(current.extraAllocations.map((row) => row.state));
  if (baseStates.has("consumed")) {
    assert.deepStrictEqual([...baseStates], ["consumed"]);
    assert.deepStrictEqual([...extraStates], ["consumed"]);
  } else {
    assert.deepStrictEqual([...baseStates], ["reserved"]);
    assert.deepStrictEqual([...extraStates], ["reserved"]);
    assert.ok(current.baseAllocations.every((row) => !row.pickupRequestId));
  }
  current.batches.forEach(assertBatchConservation);
  current.buckets.forEach(assertExtraConservation);
}

async function testPickupReserveFulfillmentRaceIsAtomic() {
  await clearDatabase();
  const source = await createPurchaseFixture();
  await finalizePayment(source, "webhook");
  const catalog = await createCatalog();
  await saveDay(source, catalog);
  await confirmDay(source);
  let current = await snapshot(source);
  const pickup = await createPickup(source, current.day, "reserve-fulfill-race");

  await Promise.allSettled([
    reservePickup(source, pickup),
    executeAction("fulfill", {
      entityId: pickup._id,
      entityType: "subscription_pickup_request",
      userId: source.userId,
      role: "admin",
      payload: {},
    }),
  ]);

  current = await snapshot(source);
  const latestPickup = await SubscriptionPickupRequest.findById(pickup._id).lean();
  const baseStates = new Set(current.baseAllocations.map((row) => row.state));
  const extraStates = new Set(current.extraAllocations.map((row) => row.state));
  if (latestPickup.status === "fulfilled") {
    assert.deepStrictEqual([...baseStates], ["consumed"]);
    assert.deepStrictEqual([...extraStates], ["consumed"]);
    assert(latestPickup.creditsConsumedAt);
  } else {
    assert.strictEqual(latestPickup.creditsReserved, true);
    assert.deepStrictEqual([...baseStates], ["reserved"]);
    assert.deepStrictEqual([...extraStates], ["reserved"]);
    assert.ok(current.baseAllocations.every((row) => (
      String(row.pickupRequestId) === String(pickup._id)
    )));
  }
  current.batches.forEach(assertBatchConservation);
  current.buckets.forEach(assertExtraConservation);
}

async function run() {
  await connect();
  try {
    await testPaymentSelectionPickupLifecycle();
    await testPickupFulfillmentReleaseRaceIsAtomic();
    await testPickupReserveFulfillmentRaceIsAtomic();
    console.log("subscription stacking final integration candidate tests passed");
  } finally {
    await mongoose.disconnect().catch(() => {});
    if (replSet) await replSet.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
