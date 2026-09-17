"use strict";

const {
  setTemporaryEnvironment,
} = require("./helpers/temporaryEnvironment");

const restoreEnvironment = setTemporaryEnvironment({
  CLIENT_UNCONSUMED_MEAL_BALANCE_ENABLED: "true",
  SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED: "false",
});

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "client-meal-balance-integration-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET
  || "client-meal-balance-integration-dashboard-secret";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const { fulfillSubscriptionDay } = require("../src/services/fulfillmentService");
const {
  releaseReservedPickupMeals,
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceService");
const {
  transitionAllocation,
} = require("../src/services/subscription/subscriptionMealEntitlementService");
const {
  getRestaurantBusinessDate,
} = require("../src/services/restaurantHoursService");
const dateUtils = require("../src/utils/date");

let replSet;

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "client_unconsumed_balance" },
  });
  const uri = replSet.getUri("client_unconsumed_balance");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URI_TEST = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    await mongoose.connection.db.dropDatabase();
  }
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (replSet) await replSet.stop();
  replSet = null;
}

function authHeader(userId) {
  const token = jwt.sign(
    {
      userId: String(userId),
      role: "client",
      tokenType: "app_access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}` };
}

function ksaDate(dateString) {
  return new Date(`${dateString}T00:00:00+03:00`);
}

function assertBalance(balance, expected, label) {
  assert(balance && typeof balance === "object", `${label}: mealBalance exists`);
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(balance[key], value, `${label}: ${key}`);
  }
  assert.strictEqual(
    balance.mealBalancePolicy,
    "UNCONSUMED_INCLUDING_RESERVED_WITH_AVAILABLE_CAPACITY",
    `${label}: policy`
  );
  assert.strictEqual(
    balance.balanceProjection && balance.balanceProjection.applied,
    true,
    `${label}: projection applied`
  );
}

async function getOverview(api, headers, lang = "en") {
  const res = await api
    .get(`/api/subscriptions/current/overview?lang=${lang}`)
    .set(headers);
  assert.strictEqual(
    res.status,
    200,
    `current overview status: ${JSON.stringify(res.body)}`
  );
  assert(res.body && res.body.data, "current overview data exists");
  return res.body.data;
}

async function getTimeline(api, headers, subscriptionId, lang = "en") {
  const res = await api
    .get(`/api/subscriptions/${subscriptionId}/timeline?lang=${lang}`)
    .set(headers);
  assert.strictEqual(
    res.status,
    200,
    `timeline status: ${JSON.stringify(res.body)}`
  );
  assert(res.body && res.body.data, "timeline data exists");
  return res.body.data;
}

async function getDay(api, headers, subscriptionId, date, lang = "en") {
  const res = await api
    .get(`/api/subscriptions/${subscriptionId}/days/${date}?lang=${lang}`)
    .set(headers);
  assert.strictEqual(
    res.status,
    200,
    `day status: ${JSON.stringify(res.body)}`
  );
  assert(res.body && res.body.data, "day data exists");
  return res.body.data;
}

async function assertPersistedCounters(subscriptionId, expected, label) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  assert(subscription, `${label}: subscription exists`);
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(subscription[key], value, `${label}: persisted ${key}`);
  }
  assert.strictEqual(
    subscription.remainingMeals
      + subscription.reservedMeals
      + subscription.consumedMeals
      + subscription.forfeitedMeals,
    subscription.totalMeals,
    `${label}: aggregate entitlement invariant`
  );
  const allocationCounts = (subscription.baseMealAllocations || []).reduce(
    (counts, allocation) => {
      counts[allocation.state] = (counts[allocation.state] || 0) + 1;
      return counts;
    },
    {}
  );
  assert.strictEqual(
    allocationCounts.reserved || 0,
    subscription.reservedMeals,
    `${label}: reserved allocation count`
  );
  assert(
    (allocationCounts.consumed || 0) <= subscription.consumedMeals,
    `${label}: consumed allocations do not exceed aggregate`
  );
  assert(
    (allocationCounts.forfeited || 0) <= subscription.forfeitedMeals,
    `${label}: forfeited allocations do not exceed aggregate`
  );
  return subscription;
}

function plainSnapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readPersistenceFingerprint({
  subscriptionId,
  dayId,
  pickupRequestId,
}) {
  const [subscription, day, pickupRequest, subscriptionAuditCount, activityCount] =
    await Promise.all([
      Subscription.findById(subscriptionId)
        .select(
          "totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals "
            + "entitlementVersion baseMealAllocations __v createdAt updatedAt"
        )
        .lean(),
      SubscriptionDay.findById(dayId).lean(),
      SubscriptionPickupRequest.findById(pickupRequestId).lean(),
      SubscriptionAuditLog.countDocuments({}),
      ActivityLog.countDocuments({}),
    ]);

  return plainSnapshot({
    subscription,
    day,
    pickupRequest,
    subscriptionAuditCount,
    activityCount,
  });
}

function assertNoInternalLedgerFields(payload, label) {
  const forbidden = new Set([
    "baseMealAllocations",
    "baseAllocationKeys",
    "entitlementTransitionState",
  ]);
  const visit = (value, path = label) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      assert(!forbidden.has(key), `${path}: leaked ${key}`);
      visit(nested, `${path}.${key}`);
    }
  };
  visit(payload);
  assert.strictEqual(
    Object.hasOwn(payload, "entitlementVersion"),
    false,
    `${label}: leaked top-level entitlementVersion`
  );
}

async function assertAllClientReadModels({
  api,
  headers,
  subscriptionId,
  businessDate,
  expected,
  label,
  includeOverview = true,
  lang = "en",
}) {
  const reads = [];
  if (includeOverview) {
    reads.push(["overview", await getOverview(api, headers, lang)]);
  }
  reads.push(
    ["timeline", await getTimeline(api, headers, subscriptionId, lang)],
    ["day", await getDay(api, headers, subscriptionId, businessDate, lang)]
  );

  for (const [kind, payload] of reads) {
    assertBalance(payload.mealBalance, expected, `${label} ${kind}`);
    assertNoInternalLedgerFields(payload, `${label} ${kind}`);
  }
  return Object.fromEntries(reads);
}

async function createPickupFixture({
  userId,
  planId,
  date,
  startDate,
  endDate,
  totalMeals = 10,
  label,
}) {
  const subscription = await Subscription.create({
    userId,
    planId,
    contractMode: "canonical",
    status: "active",
    startDate: ksaDate(startDate),
    endDate: ksaDate(endDate),
    validityEndDate: ksaDate(endDate),
    totalMeals,
    remainingMeals: totalMeals,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    entitlementVersion: 2,
    baseMealAllocations: [],
    selectedGrams: 200,
    selectedMealsPerDay: 2,
    deliveryMode: "pickup",
    pickupLocationId: "main",
    premiumBalance: [],
  });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date,
    status: "ready_for_pickup",
    pickupRequested: true,
    lockedSnapshot: {
      mealsPerDay: 2,
      requiredMealCount: 2,
    },
    mealSlots: [
      {
        slotIndex: 1,
        slotKey: "slot_1",
        status: "complete",
        selectionType: "standard_meal",
      },
      {
        slotIndex: 2,
        slotKey: "slot_2",
        status: "complete",
        selectionType: "standard_meal",
      },
    ],
    addonSelections: [],
  });
  const pickupRequest = await SubscriptionPickupRequest.create({
    subscriptionId: subscription._id,
    subscriptionDayId: day._id,
    userId,
    date,
    mealCount: 2,
    selectedMealSlotIds: ["slot_1", "slot_2"],
    selectionMode: "slot_ids",
    status: "ready_for_pickup",
  });
  assert(subscription && day && pickupRequest, `${label}: fixture created`);
  return { subscription, day, pickupRequest };
}

async function createClientUser(label) {
  return User.create({
    phone: `+9665${new mongoose.Types.ObjectId().toString().slice(-8)}`,
    name: `${label} Client Balance Integration`,
    password: "Test12345",
    role: "client",
    isActive: true,
  });
}

async function createReadProjectionCase({
  planId,
  startDate,
  endDate,
  label,
  status = "active",
  entitlementVersion = 2,
  totalMeals = 10,
  remainingMeals = 10,
  reservedMeals = 0,
  consumedMeals = 0,
  forfeitedMeals = 0,
  baseMealAllocations = [],
}) {
  const user = await createClientUser(label);
  const subscription = await Subscription.create({
    userId: user._id,
    planId,
    contractMode: "canonical",
    status,
    startDate: ksaDate(startDate),
    endDate: ksaDate(endDate),
    validityEndDate: ksaDate(endDate),
    totalMeals,
    remainingMeals,
    reservedMeals,
    consumedMeals,
    forfeitedMeals,
    entitlementVersion,
    baseMealAllocations,
    selectedGrams: 200,
    selectedMealsPerDay: 2,
    deliveryMode: "pickup",
    pickupLocationId: "main",
    premiumBalance: [],
  });
  return { user, subscription };
}

function assertSafeApiError(response, expectedStatus, label) {
  assert.strictEqual(response.status, expectedStatus, `${label}: status`);
  const body = JSON.stringify(response.body);
  for (const forbidden of [
    "\"stack\"",
    "MongoServer",
    "mongodb://",
    "MongooseError",
  ]) {
    assert.strictEqual(body.includes(forbidden), false, `${label}: ${forbidden}`);
  }
}

async function run() {
  await connect();
  try {
    const businessDate = await getRestaurantBusinessDate();
    const startDate = dateUtils.addDaysToKSADateString(businessDate, -2);
    const endDate = dateUtils.addDaysToKSADateString(businessDate, 20);

    await Setting.create({
      key: "pickup_locations",
      value: [{
        id: "main",
        locationId: "main",
        name: { ar: "الفرع الرئيسي", en: "Main Branch" },
        label: { ar: "الفرع الرئيسي", en: "Main Branch" },
        address: {
          line1: { ar: "الفرع الرئيسي", en: "Main Branch" },
          city: { ar: "الرياض", en: "Riyadh" },
        },
      }],
    });

    const user = await User.create({
      phone: `+9665${String(Date.now()).slice(-8)}`,
      name: "Client Balance Integration",
      password: "Test12345",
      role: "client",
      isActive: true,
    });
    const plan = await Plan.create({
      name: { ar: "خطة اختبار الرصيد", en: "Balance Integration Plan" },
      daysCount: 10,
      durationDays: 10,
      currency: "SAR",
      isActive: true,
      gramsOptions: [{
        grams: 200,
        isActive: true,
        mealsOptions: [{
          mealsPerDay: 2,
          priceHalala: 50000,
          compareAtHalala: 50000,
          isActive: true,
        }],
      }],
    });
    const subscription = await Subscription.create({
      userId: user._id,
      planId: plan._id,
      contractMode: "canonical",
      status: "active",
      startDate: ksaDate(startDate),
      endDate: ksaDate(endDate),
      validityEndDate: ksaDate(endDate),
      totalMeals: 10,
      remainingMeals: 10,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      entitlementVersion: 2,
      baseMealAllocations: [],
      selectedGrams: 200,
      selectedMealsPerDay: 2,
      deliveryMode: "pickup",
      pickupLocationId: "main",
      premiumBalance: [],
    });
    const day = await SubscriptionDay.create({
      subscriptionId: subscription._id,
      date: businessDate,
      status: "ready_for_pickup",
      pickupRequested: true,
      lockedSnapshot: {
        mealsPerDay: 2,
        requiredMealCount: 2,
      },
      mealSlots: [
        {
          slotIndex: 1,
          slotKey: "slot_1",
          status: "complete",
          selectionType: "standard_meal",
        },
        {
          slotIndex: 2,
          slotKey: "slot_2",
          status: "complete",
          selectionType: "standard_meal",
        },
      ],
      addonSelections: [],
    });
    const pickupRequest = await SubscriptionPickupRequest.create({
      subscriptionId: subscription._id,
      subscriptionDayId: day._id,
      userId: user._id,
      date: businessDate,
      mealCount: 2,
      selectedMealSlotIds: ["slot_1", "slot_2"],
      selectionMode: "slot_ids",
      status: "ready_for_pickup",
    });

    const api = request(createApp());
    const headers = authHeader(user._id);

    const initialOverview = await getOverview(api, headers);
    assert.strictEqual(initialOverview.remainingMeals, 10, "initial top-level stored balance");
    assertBalance(initialOverview.mealBalance, {
      totalMeals: 10,
      remainingMeals: 10,
      displayRemainingMeals: 10,
      availableMeals: 10,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      canConsumeNow: true,
      maxConsumableMealsNow: 10,
    }, "initial overview");
    assertNoInternalLedgerFields(initialOverview, "initial overview");

    const reservation = await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: 2,
    });
    assert.strictEqual(reservation.reserved, true, "pickup meals reserved once");
    const reservedSubscription = await assertPersistedCounters(subscription._id, {
      remainingMeals: 8,
      reservedMeals: 2,
      consumedMeals: 0,
      forfeitedMeals: 0,
    }, "after reservation");
    assert.strictEqual(
      reservedSubscription.baseMealAllocations.length,
      2,
      "reservation creates exactly two allocations"
    );

    const reservedReads = await assertAllClientReadModels({
      api,
      headers,
      subscriptionId: subscription._id,
      businessDate,
      expected: {
        totalMeals: 10,
        remainingMeals: 10,
        displayRemainingMeals: 10,
        availableMeals: 8,
        reservedMeals: 2,
        consumedMeals: 0,
        forfeitedMeals: 0,
        canConsumeNow: true,
        maxConsumableMealsNow: 8,
      },
      label: "reserved",
    });
    assert.strictEqual(
      reservedReads.overview.remainingMeals,
      8,
      "top-level compatibility field remains the persisted available balance"
    );

    await assertAllClientReadModels({
      api,
      headers,
      subscriptionId: subscription._id,
      businessDate,
      expected: {
        totalMeals: 10,
        remainingMeals: 10,
        displayRemainingMeals: 10,
        availableMeals: 8,
        reservedMeals: 2,
        consumedMeals: 0,
        forfeitedMeals: 0,
        canConsumeNow: true,
        maxConsumableMealsNow: 8,
      },
      label: "reserved Arabic",
      lang: "ar",
    });

    process.env.CLIENT_UNCONSUMED_MEAL_BALANCE_ENABLED = "false";
    try {
      const legacyOverview = await getOverview(api, headers);
      assert.strictEqual(legacyOverview.remainingMeals, 8);
      assert.strictEqual(legacyOverview.mealBalance.remainingMeals, 8);
      assert.strictEqual(
        Object.hasOwn(legacyOverview.mealBalance, "balanceProjection"),
        false,
        "flag-off overview has no projection metadata"
      );
      assert.strictEqual(
        Object.hasOwn(legacyOverview.mealBalance, "displayRemainingMeals"),
        false,
        "flag-off overview has no display-only field"
      );

      const legacyTimeline = await getTimeline(api, headers, subscription._id);
      assert.strictEqual(
        Object.hasOwn(legacyTimeline, "mealBalance"),
        false,
        "flag-off timeline preserves the legacy response shape"
      );

      const legacyDay = await getDay(
        api,
        headers,
        subscription._id,
        businessDate
      );
      assert.strictEqual(legacyDay.mealBalance.remainingMeals, 8);
      assert.strictEqual(
        Object.hasOwn(legacyDay.mealBalance, "balanceProjection"),
        false,
        "flag-off day has no projection metadata"
      );
    } finally {
      process.env.CLIENT_UNCONSUMED_MEAL_BALANCE_ENABLED = "true";
    }

    const beforeRepeatedReads = await readPersistenceFingerprint({
      subscriptionId: subscription._id,
      dayId: day._id,
      pickupRequestId: pickupRequest._id,
    });
    const repeatedReadBatches = await Promise.all(
      Array.from({ length: 20 }, (_, index) => Promise.all([
        getOverview(api, headers, index % 2 === 0 ? "en" : "ar"),
        getTimeline(
          api,
          headers,
          subscription._id,
          index % 2 === 0 ? "ar" : "en"
        ),
        getDay(
          api,
          headers,
          subscription._id,
          businessDate,
          index % 2 === 0 ? "en" : "ar"
        ),
      ]))
    );
    for (const [overviewRead, timelineRead, dayRead] of repeatedReadBatches) {
      for (const [kind, payload] of [
        ["overview", overviewRead],
        ["timeline", timelineRead],
        ["day", dayRead],
      ]) {
        assertBalance(payload.mealBalance, {
          remainingMeals: 10,
          availableMeals: 8,
          reservedMeals: 2,
          consumedMeals: 0,
          forfeitedMeals: 0,
          maxConsumableMealsNow: 8,
        }, `repeated ${kind}`);
      }
    }
    const afterRepeatedReads = await readPersistenceFingerprint({
      subscriptionId: subscription._id,
      dayId: day._id,
      pickupRequestId: pickupRequest._id,
    });
    assert.deepStrictEqual(
      afterRepeatedReads,
      beforeRepeatedReads,
      "20 reads of each endpoint are pure, including counters, allocations, __v, timestamps, request/day state, and audit counts"
    );

    const firstAllocationKey =
      reservedSubscription.baseMealAllocations[0].allocationKey;
    const partialFulfillment = await transitionAllocation({
      subscriptionId: subscription._id,
      allocationKey: firstAllocationKey,
      toState: "consumed",
    });
    assert.strictEqual(partialFulfillment.changed, true);
    await assertPersistedCounters(subscription._id, {
      remainingMeals: 8,
      reservedMeals: 1,
      consumedMeals: 1,
      forfeitedMeals: 0,
    }, "after one fulfillment");
    await assertAllClientReadModels({
      api,
      headers,
      subscriptionId: subscription._id,
      businessDate,
      expected: {
        totalMeals: 10,
        remainingMeals: 9,
        displayRemainingMeals: 9,
        availableMeals: 8,
        reservedMeals: 1,
        consumedMeals: 1,
        forfeitedMeals: 0,
        canConsumeNow: true,
        maxConsumableMealsNow: 8,
      },
      label: "after one fulfillment",
    });

    const fulfillment = await fulfillSubscriptionDay({ dayId: day._id });
    assert.strictEqual(fulfillment.ok, true, "pickup fulfillment succeeds");
    await assertPersistedCounters(subscription._id, {
      remainingMeals: 8,
      reservedMeals: 0,
      consumedMeals: 2,
      forfeitedMeals: 0,
    }, "after fulfillment");

    const fulfilledReads = await assertAllClientReadModels({
      api,
      headers,
      subscriptionId: subscription._id,
      businessDate,
      expected: {
        totalMeals: 10,
        remainingMeals: 8,
        displayRemainingMeals: 8,
        availableMeals: 8,
        reservedMeals: 0,
        consumedMeals: 2,
        forfeitedMeals: 0,
        canConsumeNow: true,
        maxConsumableMealsNow: 8,
      },
      label: "fulfilled",
    });
    assert.strictEqual(fulfilledReads.overview.remainingMeals, 8);

    const beforeRepeatedFulfillment = await readPersistenceFingerprint({
      subscriptionId: subscription._id,
      dayId: day._id,
      pickupRequestId: pickupRequest._id,
    });
    const repeatedFulfillment = await fulfillSubscriptionDay({ dayId: day._id });
    assert.strictEqual(repeatedFulfillment.ok, true, "repeated fulfillment is idempotent");
    assert.strictEqual(repeatedFulfillment.alreadyFulfilled, true);
    await assertPersistedCounters(subscription._id, {
      remainingMeals: 8,
      reservedMeals: 0,
      consumedMeals: 2,
      forfeitedMeals: 0,
    }, "after repeated fulfillment");
    const afterRepeatedFulfillment = await readPersistenceFingerprint({
      subscriptionId: subscription._id,
      dayId: day._id,
      pickupRequestId: pickupRequest._id,
    });
    assert.deepStrictEqual(
      afterRepeatedFulfillment,
      beforeRepeatedFulfillment,
      "repeated fulfillment changes no counters, allocations, transitions, audit logs, or document versions"
    );

    const releaseDate = dateUtils.addDaysToKSADateString(businessDate, 1);
    const releaseUser = await createClientUser("Release");
    const releaseFixture = await createPickupFixture({
      userId: releaseUser._id,
      planId: plan._id,
      date: releaseDate,
      startDate,
      endDate,
      label: "release",
    });
    await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: releaseFixture.subscription._id,
      pickupRequestId: releaseFixture.pickupRequest._id,
      mealCount: 2,
    });
    const releaseReservedState = await assertPersistedCounters(
      releaseFixture.subscription._id,
      {
        remainingMeals: 8,
        reservedMeals: 2,
        consumedMeals: 0,
        forfeitedMeals: 0,
      },
      "release before"
    );
    await transitionAllocation({
      subscriptionId: releaseFixture.subscription._id,
      allocationKey:
        releaseReservedState.baseMealAllocations[0].allocationKey,
      toState: "released",
    });
    await assertPersistedCounters(releaseFixture.subscription._id, {
      remainingMeals: 9,
      reservedMeals: 1,
      consumedMeals: 0,
      forfeitedMeals: 0,
    }, "after one release");
    await assertAllClientReadModels({
      api,
      headers: authHeader(releaseUser._id),
      subscriptionId: releaseFixture.subscription._id,
      businessDate: releaseDate,
      includeOverview: false,
      expected: {
        totalMeals: 10,
        remainingMeals: 10,
        displayRemainingMeals: 10,
        availableMeals: 9,
        reservedMeals: 1,
        consumedMeals: 0,
        forfeitedMeals: 0,
        canConsumeNow: true,
        maxConsumableMealsNow: 9,
      },
      label: "after one release",
    });
    const releaseResult = await releaseReservedPickupMeals({
      subscriptionId: releaseFixture.subscription._id,
      pickupRequestId: releaseFixture.pickupRequest._id,
    });
    assert.strictEqual(releaseResult.released, true);
    await assertPersistedCounters(releaseFixture.subscription._id, {
      remainingMeals: 10,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
    }, "after all releases");
    await assertAllClientReadModels({
      api,
      headers: authHeader(releaseUser._id),
      subscriptionId: releaseFixture.subscription._id,
      businessDate: releaseDate,
      includeOverview: false,
      expected: {
        totalMeals: 10,
        remainingMeals: 10,
        displayRemainingMeals: 10,
        availableMeals: 10,
        reservedMeals: 0,
        consumedMeals: 0,
        forfeitedMeals: 0,
        canConsumeNow: true,
        maxConsumableMealsNow: 10,
      },
      label: "after all releases",
    });
    const repeatedRelease = await releaseReservedPickupMeals({
      subscriptionId: releaseFixture.subscription._id,
      pickupRequestId: releaseFixture.pickupRequest._id,
    });
    assert.strictEqual(repeatedRelease.alreadyReleased, true);

    const forfeitureDate = dateUtils.addDaysToKSADateString(businessDate, 2);
    const forfeitureUser = await createClientUser("Forfeiture");
    const forfeitureFixture = await createPickupFixture({
      userId: forfeitureUser._id,
      planId: plan._id,
      date: forfeitureDate,
      startDate,
      endDate,
      label: "forfeiture",
    });
    await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: forfeitureFixture.subscription._id,
      pickupRequestId: forfeitureFixture.pickupRequest._id,
      mealCount: 2,
    });
    const forfeitureReservedState = await Subscription.findById(
      forfeitureFixture.subscription._id
    ).lean();
    await transitionAllocation({
      subscriptionId: forfeitureFixture.subscription._id,
      allocationKey:
        forfeitureReservedState.baseMealAllocations[0].allocationKey,
      toState: "forfeited",
    });
    await assertPersistedCounters(forfeitureFixture.subscription._id, {
      remainingMeals: 8,
      reservedMeals: 1,
      consumedMeals: 0,
      forfeitedMeals: 1,
    }, "after forfeiture");
    await assertAllClientReadModels({
      api,
      headers: authHeader(forfeitureUser._id),
      subscriptionId: forfeitureFixture.subscription._id,
      businessDate: forfeitureDate,
      includeOverview: false,
      expected: {
        totalMeals: 10,
        remainingMeals: 9,
        displayRemainingMeals: 9,
        availableMeals: 8,
        reservedMeals: 1,
        consumedMeals: 0,
        forfeitedMeals: 1,
        canConsumeNow: true,
        maxConsumableMealsNow: 8,
      },
      label: "after forfeiture",
    });

    const unauthenticated = await api.get(
      `/api/subscriptions/${subscription._id}/timeline?lang=en`
    );
    assertSafeApiError(unauthenticated, 401, "missing token");

    const invalidToken = await api
      .get(`/api/subscriptions/${subscription._id}/timeline?lang=en`)
      .set({ Authorization: "Bearer definitely-not-a-jwt" });
    assertSafeApiError(invalidToken, 401, "invalid token");

    const unrelatedUser = await createClientUser("Unrelated");
    const forbiddenTimeline = await api
      .get(`/api/subscriptions/${subscription._id}/timeline?lang=en`)
      .set(authHeader(unrelatedUser._id));
    assertSafeApiError(forbiddenTimeline, 403, "cross-user timeline");
    const forbiddenDay = await api
      .get(
        `/api/subscriptions/${subscription._id}/days/${businessDate}?lang=ar`
      )
      .set(authHeader(unrelatedUser._id));
    assertSafeApiError(forbiddenDay, 403, "cross-user day");

    const invalidSubscriptionId = await api
      .get("/api/subscriptions/not-an-object-id/timeline?lang=en")
      .set(headers);
    assertSafeApiError(
      invalidSubscriptionId,
      400,
      "invalid subscription id"
    );
    const missingSubscription = await api
      .get(
        `/api/subscriptions/${new mongoose.Types.ObjectId()}/timeline?lang=en`
      )
      .set(headers);
    assertSafeApiError(missingSubscription, 404, "missing subscription");

    const inactiveCases = [];
    for (const status of ["canceled", "completed", "expired"]) {
      inactiveCases.push(await createReadProjectionCase({
        planId: plan._id,
        startDate,
        endDate,
        label: status,
        status,
      }));
    }
    inactiveCases.push(
      await createReadProjectionCase({
        planId: plan._id,
        startDate: dateUtils.addDaysToKSADateString(businessDate, -20),
        endDate: dateUtils.addDaysToKSADateString(businessDate, -1),
        label: "Outside Validity",
      }),
      await createReadProjectionCase({
        planId: plan._id,
        startDate,
        endDate,
        label: "Legacy",
        entitlementVersion: 1,
        totalMeals: 10,
        remainingMeals: 8,
      }),
      await createReadProjectionCase({
        planId: plan._id,
        startDate,
        endDate,
        label: "Mismatched Ledger",
        totalMeals: 10,
        remainingMeals: 8,
        reservedMeals: 2,
        baseMealAllocations: [{
          allocationKey: "only-one-reserved-allocation",
          date: businessDate,
          slotKey: "slot_1",
          quantity: 1,
          state: "reserved",
        }],
      })
    );

    for (const ineligible of inactiveCases) {
      const timeline = await getTimeline(
        api,
        authHeader(ineligible.user._id),
        ineligible.subscription._id
      );
      assert.strictEqual(
        Object.hasOwn(timeline, "mealBalance"),
        false,
        `${ineligible.subscription.status}: fail-closed timeline`
      );
      assertNoInternalLedgerFields(
        timeline,
        `${ineligible.subscription.status}: timeline`
      );
    }

    console.log("subscriptionClientMealBalance.integration.test.js passed");
  } finally {
    await disconnect();
    restoreEnvironment();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
