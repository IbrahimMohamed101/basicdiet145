"use strict";

const assert = require("node:assert");
const {
  deriveTimelinePlanningContract,
  resolveTimelineLegacyStatus,
} = require("../src/services/subscription/subscriptionTimelineService");
const {
  localizeTimelineReadPayload,
} = require("../src/utils/subscription/subscriptionReadLocalization");

const DATE = "2026-06-10";
const BUSINESS_DATE = "2026-06-01";

function buildDay(overrides = {}) {
  return {
    date: DATE,
    status: "open",
    plannerState: "draft",
    mealSlots: [{ slotIndex: 1, slotKey: "slot_1", status: "complete" }],
    addonSelections: [],
    ...overrides,
  };
}

function buildCommercialState(overrides = {}) {
  return {
    commercialState: "ready_to_confirm",
    paymentRequirement: {
      requiresPayment: false,
      blockingReason: "PLANNER_UNCONFIRMED",
    },
    premiumExtraPayment: { status: "none" },
    plannerRevisionHash: "revision-current",
    ...overrides,
  };
}

function derive({
  subscriptionStatus = "active",
  day = buildDay(),
  meals = { selected: 1, required: 1, isSatisfied: true },
  commercialState = buildCommercialState(),
  latestPayment = null,
} = {}) {
  return deriveTimelinePlanningContract({
    subscription: {
      status: subscriptionStatus,
      deliveryMode: "pickup",
    },
    day,
    meals,
    commercialState,
    latestPayment,
    businessDate: BUSINESS_DATE,
    now: new Date("2026-06-01T08:00:00Z"),
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (err) {
    console.error(`❌ ${name}`);
    throw err;
  }
}

test("validate-only or absent persisted selection stays empty", () => {
  const result = derive({
    day: { date: DATE, status: "open" },
    meals: { selected: 0, required: 1, isSatisfied: false },
    commercialState: buildCommercialState({
      commercialState: "draft",
      paymentRequirement: { requiresPayment: false, blockingReason: "PLANNING_INCOMPLETE" },
    }),
  });
  assert.strictEqual(result.timelineStatus, "empty");
  assert.strictEqual(result.hasSelection, false);
  assert.strictEqual(result.isPlanned, false);
  assert.strictEqual(result.canEdit, true);
});

test("saved standard draft is not planned", () => {
  const result = derive();
  assert.strictEqual(result.timelineStatus, "draft");
  assert.strictEqual(result.selectionStatus, "draft");
  assert.strictEqual(result.isPlanned, false);
  assert.strictEqual(result.canShowAsPlanned, false);
  assert.strictEqual(resolveTimelineLegacyStatus({
    day: buildDay(),
    isExtension: false,
    isPlanned: result.isPlanned,
  }), "open");
});

test("selection requiring payment is pending_payment", () => {
  const result = derive({
    commercialState: buildCommercialState({
      commercialState: "payment_required",
      paymentRequirement: { requiresPayment: true, blockingReason: "PREMIUM_PAYMENT_REQUIRED" },
      premiumExtraPayment: { status: "pending" },
    }),
  });
  assert.strictEqual(result.timelineStatus, "pending_payment");
  assert.strictEqual(result.paymentStatus, "pending");
  assert.strictEqual(result.isPlanned, false);
});

for (const status of ["failed", "canceled", "expired", "refunded"]) {
  test(`${status} payment is failed timeline state`, () => {
    const result = derive({
      latestPayment: { status },
      commercialState: buildCommercialState({
        commercialState: "payment_required",
        paymentRequirement: { requiresPayment: true, blockingReason: "PREMIUM_PAYMENT_REQUIRED" },
      }),
    });
    assert.strictEqual(result.timelineStatus, "failed");
    assert.strictEqual(result.paymentStatus, status);
    assert.strictEqual(result.isPlanned, false);
  });
}

test("initiated payment is pending_payment", () => {
  const result = derive({ latestPayment: { status: "initiated" } });
  assert.strictEqual(result.timelineStatus, "pending_payment");
  assert.strictEqual(result.paymentStatus, "pending");
  assert.strictEqual(result.isPlanned, false);
});

test("paid but unconfirmed selection stays draft", () => {
  const result = derive({ latestPayment: { status: "paid" } });
  assert.strictEqual(result.timelineStatus, "draft");
  assert.strictEqual(result.paymentStatus, "paid");
  assert.strictEqual(result.isPlanned, false);
});

test("confirmed commercially satisfied active day is planned", () => {
  const result = derive({
    day: buildDay({ plannerState: "confirmed" }),
    commercialState: buildCommercialState({
      commercialState: "confirmed",
      paymentRequirement: { requiresPayment: false, blockingReason: null },
    }),
  });
  assert.strictEqual(result.timelineStatus, "planned");
  assert.strictEqual(result.selectionStatus, "confirmed");
  assert.strictEqual(result.isPlanned, true);
  assert.strictEqual(result.canShowAsPlanned, true);
  assert.strictEqual(resolveTimelineLegacyStatus({
    day: buildDay({ plannerState: "confirmed" }),
    isExtension: false,
    isPlanned: result.isPlanned,
  }), "planned");
});

for (const rawStatus of ["locked", "in_preparation", "out_for_delivery", "ready_for_pickup", "ready_for_delivery", "preparing", "on_the_way"]) {
  test(`${rawStatus} day renders as locked on timeline`, () => {
    assert.strictEqual(resolveTimelineLegacyStatus({
      day: buildDay({ status: rawStatus }),
      isExtension: false,
      isPlanned: false,
    }), "locked");
  });
}

test("inactive subscription never shows planned", () => {
  const result = derive({
    subscriptionStatus: "canceled",
    day: buildDay({ plannerState: "confirmed" }),
    commercialState: buildCommercialState({
      commercialState: "confirmed",
      paymentRequirement: { requiresPayment: false, blockingReason: null },
    }),
  });
  assert.strictEqual(result.timelineStatus, "draft");
  assert.strictEqual(result.isPlanned, false);
  assert.strictEqual(result.canShowAsPlanned, false);
  assert.strictEqual(result.canEdit, false);
});

test("localized timeline payload exposes additive planning fields", () => {
  const contract = derive({
    commercialState: buildCommercialState({
      commercialState: "payment_required",
      paymentRequirement: { requiresPayment: true, blockingReason: "PREMIUM_PAYMENT_REQUIRED" },
    }),
    latestPayment: { status: "initiated" },
  });
  const payload = localizeTimelineReadPayload({
    subscriptionId: "subscription-id",
    dailyMealsConfig: { required: 1 },
    days: [{
      date: DATE,
      status: "open",
      dayStatus: "locked",
      calendar: {
        dayOfMonth: 10,
        weekday: { shortLabels: { en: "Wed" } },
        month: { shortLabels: { en: "JUN" } },
      },
      meals: { selected: 1, required: 1 },
      ...contract,
    }],
  }, "en");
  const day = payload.days[0];
  assert.strictEqual(day.timelineStatus, "pending_payment");
  assert.strictEqual(day.dayStatus, "locked");
  assert.strictEqual(day.canShowAsPlanned, false);
  assert.strictEqual(day.paymentStatus, "pending");
  assert.strictEqual(day.orderStatus, "none");
  assert.strictEqual(day.subscriptionStatus, "active");
  assert.strictEqual(day.paymentStateReason, "PREMIUM_PAYMENT_REQUIRED");
});

test("localized timeline payload preserves an applied client meal balance projection", () => {
  const mealBalance = {
    totalMeals: 10,
    remainingMeals: 10,
    availableMeals: 8,
    reservedMeals: 2,
    consumedMeals: 0,
    forfeitedMeals: 0,
    maxConsumableMealsNow: 8,
    canConsumeNow: true,
    balanceProjection: {
      applied: true,
      source: "available_plus_reserved",
    },
  };

  const payload = localizeTimelineReadPayload({
    subscriptionId: "subscription-id",
    mealBalance,
    days: [],
  }, "en");

  assert.strictEqual(payload.mealBalance, mealBalance);
});

test("localized timeline payload leaves the legacy contract unchanged without an applied projection", () => {
  const payload = localizeTimelineReadPayload({
    subscriptionId: "subscription-id",
    mealBalance: {
      totalMeals: 10,
      remainingMeals: 8,
      balanceProjection: {
        applied: false,
      },
    },
    days: [],
  }, "en");

  assert.strictEqual(Object.hasOwn(payload, "mealBalance"), false);
});

console.log("subscriptionTimelinePlanningContract tests passed");
