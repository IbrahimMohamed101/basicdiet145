"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const { toKSADateString } = require("../src/utils/date");

// Import the service directly for unit testing the logic
const { buildSubscriptionTimeline } = require("../src/services/subscription/subscriptionService");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createFindQuery(result) {
  const query = {
    select() {
      return query;
    },
    session() {
      return query;
    },
    lean() {
      return Promise.resolve(typeof result === "function" ? result() : result);
    },
    then(resolve, reject) {
      return Promise.resolve(typeof result === "function" ? result() : result).then(resolve, reject);
    },
  };
  return query;
}

test("Canonical Subscription Timeline — Phase 3 Feature 1", async (t) => {
  const originalSubFindById = Subscription.findById;
  const originalDayFind = SubscriptionDay.find;

  t.after(() => {
    Subscription.findById = originalSubFindById;
    SubscriptionDay.find = originalDayFind;
  });

  const subId = objectId();
  const startDate = new Date("2026-03-20T21:00:00.000Z"); // 2026-03-21 KSA
  const endDate = new Date("2026-03-22T21:00:00.000Z");   // 2026-03-23 KSA
  
  const mockSubscription = {
    _id: subId,
    startDate,
    endDate,
    validityEndDate: endDate,
    totalMeals: 3,
    selectedMealsPerDay: 2,
  };

  await t.test("Case 1: Baseline (No freeze, no skip, all days present)", async () => {
    Subscription.findById = () => createFindQuery(mockSubscription);

    SubscriptionDay.find = () => createFindQuery([
        { date: "2026-03-21", status: "open" },
        { date: "2026-03-22", status: "locked", lockedAt: new Date(), lockedSnapshot: {} },
        { date: "2026-03-23", status: "fulfilled" },
      ]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 3);
    assert.equal(timeline.validity.compensationDays, 0);
    assert.equal(timeline.days[0].status, "open");
    assert.equal(timeline.days[1].status, "locked");
    assert.equal(timeline.days[1].locked, true);
    assert.equal(timeline.days[2].status, "delivered");
    assert.deepEqual(timeline.days.map((d) => d.source), ["base", "base", "base"]);
    assert.deepEqual(timeline.days[0].meals, { selected: 0, required: 2, isSatisfied: false });
    assert.equal(timeline.days[0].calendar.dayOfMonth, 21);
    assert.equal(timeline.days[0].calendar.weekday.key, "saturday");
    assert.equal(timeline.days[0].calendar.weekday.labels.ar, "السبت");
    assert.equal(timeline.days[0].calendar.weekday.labels.en, "Saturday");
    assert.equal(timeline.days[0].calendar.month.key, "march");
    assert.equal(timeline.days[0].calendar.month.labels.ar, "مارس");
    assert.equal(timeline.days[0].calendar.month.labels.en, "March");
    assert.equal(timeline.days[0].calendar.month.shortLabels.en, "MAR");
    assert.equal(timeline.days[0].calendar.weekday.shortLabels.en, "Sat");
    assert.equal(timeline.months.length, 1);
    assert.equal(timeline.months[0].month.key, "march");
    assert.equal(timeline.dailyMealsConfig.required, 2);
    assert.equal(timeline.dailyMealsConfig.labels.en, "2 meals/day");
    assert.deepEqual(timeline.days[0].dailyMeals.summaryLabels, {
      ar: "0 من 2 مختارة",
      en: "0 of 2 selected",
    });
  });

  await t.test("Case 2: Single freeze → 1 extension day", async () => {
    const extendedSub = { 
      ...mockSubscription, 
      validityEndDate: new Date("2026-03-23T21:00:00.000Z") // 2026-03-24 KSA
    };
    
    Subscription.findById = () => createFindQuery(extendedSub);

    SubscriptionDay.find = () => createFindQuery([
        { date: "2026-03-21", status: "frozen", canonicalDayActionType: "freeze" },
        { date: "2026-03-22", status: "open" },
        { date: "2026-03-23", status: "open" },
        { date: "2026-03-24", status: "open" }, // Extension day created by sync
      ]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 4);
    assert.equal(timeline.validity.compensationDays, 1);
    assert.equal(timeline.days[0].status, "frozen");
    assert.equal(timeline.days[3].status, "extension");
    assert.equal(timeline.days[3].source, "freeze_compensation");
    assert.equal(timeline.days[3].isExtension, true);
  });

  await t.test("Case 3: Missing days in DB → handle as 'open'", async () => {
    Subscription.findById = () => createFindQuery(mockSubscription);

    SubscriptionDay.find = () => createFindQuery([]); // No days in DB

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 3);
    assert.ok(timeline.days.every(d => d.status === "open"));
    assert.ok(timeline.days.every((d) => d.meals.required === 2));
  });

  await t.test("Case 3b: Open day with selections is exposed as 'planned' for the UI", async () => {
    Subscription.findById = () => createFindQuery(mockSubscription);

    SubscriptionDay.find = () => createFindQuery([
      {
        date: "2026-03-21",
        status: "open",
        selections: [objectId()],
        planningMeta: {
          selectedTotalMealCount: 1,
          requiredMealCount: 2,
          isExactCountSatisfied: false,
        },
      },
      { date: "2026-03-22", status: "open" },
      { date: "2026-03-23", status: "fulfilled" },
    ]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days[0].status, "planned");
    assert.deepEqual(timeline.days[0].meals, { selected: 1, required: 2, isSatisfied: false });
    assert.equal(timeline.days[0].dailyMeals.remaining, 1);
    assert.equal(timeline.days[0].dailyMeals.summaryLabels.en, "1 of 2 selected");
  });

  await t.test("Case 3c: Open day with canonical slot data is exposed as 'planned' for the UI", async () => {
    Subscription.findById = () => createFindQuery(mockSubscription);

    SubscriptionDay.find = () => createFindQuery([
      {
        date: "2026-03-21",
        status: "open",
        baseMealSlots: [
          { slotKey: "base_slot_1", mealId: objectId() },
        ],
        premiumUpgradeSelections: [
          { baseSlotKey: "base_slot_2", premiumMealId: objectId() },
        ],
      },
      { date: "2026-03-22", status: "open" },
      { date: "2026-03-23", status: "fulfilled" },
    ]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days[0].status, "planned");
    assert.deepEqual(timeline.days[0].meals, { selected: 2, required: 2, isSatisfied: true });
    assert.equal(timeline.days[0].dailyMeals.remaining, 0);
  });

  await t.test("Case 4: Mixed freeze + skip", async () => {
    const extendedSub = { 
      ...mockSubscription, 
      validityEndDate: new Date("2026-03-24T21:00:00.000Z") // 2026-03-25 KSA
    };
    
    Subscription.findById = () => createFindQuery(extendedSub);

    SubscriptionDay.find = () => createFindQuery([
        { date: "2026-03-21", status: "frozen", canonicalDayActionType: "freeze" },
        { date: "2026-03-22", status: "skipped", canonicalDayActionType: "skip", skipCompensated: true },
        { date: "2026-03-23", status: "open" },
        { date: "2026-03-24", status: "open" },
        { date: "2026-03-25", status: "open" },
      ]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 5);
    assert.equal(timeline.validity.compensationDays, 2);
    assert.equal(timeline.validity.freezeCompensationDays, 1);
    assert.equal(timeline.validity.skipCompensationDays, 1);
    assert.equal(timeline.days[0].status, "frozen");
    assert.equal(timeline.days[1].status, "skipped");
    assert.equal(timeline.days[1].isExtension, false);
    assert.equal(timeline.days[3].status, "extension");
    assert.equal(timeline.days[3].source, "freeze_compensation");
    assert.equal(timeline.days[4].status, "extension");
    assert.equal(timeline.days[4].source, "skip_compensation");
  });

  await t.test("Case 5: Locked frozen day vs Regular frozen day", async () => {
    Subscription.findById = () => createFindQuery(mockSubscription);

    SubscriptionDay.find = () => createFindQuery([
        { 
          date: "2026-03-21", 
          status: "frozen", 
          canonicalDayActionType: "freeze", 
          lockedSnapshot: { note: "locked even if frozen" },
          planningMeta: { selectedTotalMealCount: 2, requiredMealCount: 3, isExactCountSatisfied: false }
        },
      ]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days[0].status, "frozen");
    assert.equal(timeline.days[0].locked, true);
    assert.deepEqual(timeline.days[0].meals, { selected: 2, required: 3, isSatisfied: false });
  });

  await t.test("Case 5b: Kitchen and delivery pipeline statuses collapse into locked", async () => {
    const processingSub = {
      ...mockSubscription,
      endDate: new Date("2026-03-24T21:00:00.000Z"),
      validityEndDate: new Date("2026-03-24T21:00:00.000Z"),
    };
    Subscription.findById = () => createFindQuery(processingSub);

    SubscriptionDay.find = () => createFindQuery([
      { date: "2026-03-21", status: "locked" },
      { date: "2026-03-22", status: "in_preparation" },
      { date: "2026-03-23", status: "out_for_delivery" },
      { date: "2026-03-24", status: "ready_for_pickup" },
      { date: "2026-03-25", status: "fulfilled" },
    ]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.deepEqual(
      timeline.days.map((day) => day.status),
      ["locked", "locked", "locked", "locked", "delivered"]
    );
    assert.ok(timeline.days.slice(0, 4).every((day) => day.locked === true));
  });

  await t.test("Case 6: Legacy skip only (no extension)", async () => {
    Subscription.findById = () => createFindQuery(mockSubscription);

    SubscriptionDay.find = () => createFindQuery([
        { date: "2026-03-21", status: "skipped", canonicalDayActionType: "skip" },
        { date: "2026-03-22", status: "open" },
        { date: "2026-03-23", status: "fulfilled" },
      ]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 3);
    assert.equal(timeline.validity.compensationDays, 0);
    assert.equal(timeline.days[0].status, "skipped");
    assert.equal(timeline.days[2].status, "delivered");
  });

  await t.test("Case 6b: Compensated skip adds skip extension days only", async () => {
    const extendedSub = {
      ...mockSubscription,
      validityEndDate: new Date("2026-03-23T21:00:00.000Z"), // 2026-03-24 KSA
    };
    Subscription.findById = () => createFindQuery(extendedSub);

    SubscriptionDay.find = () => createFindQuery([
        { date: "2026-03-21", status: "skipped", canonicalDayActionType: "skip", skipCompensated: true },
        { date: "2026-03-22", status: "open" },
        { date: "2026-03-23", status: "fulfilled" },
        { date: "2026-03-24", status: "open" },
      ]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 4);
    assert.equal(timeline.validity.compensationDays, 1);
    assert.equal(timeline.validity.skipCompensationDays, 1);
    assert.equal(timeline.days[3].status, "extension");
    assert.equal(timeline.days[3].source, "skip_compensation");
  });

  await t.test("Case 7: Multiple freezes -> multiple extension days", async () => {
    const extendedSub = { 
      ...mockSubscription, 
      validityEndDate: new Date("2026-03-24T21:00:00.000Z") // 2026-03-25 KSA
    };
    Subscription.findById = () => createFindQuery(extendedSub);

    SubscriptionDay.find = () => createFindQuery([
        { date: "2026-03-21", status: "frozen", canonicalDayActionType: "freeze" },
        { date: "2026-03-22", status: "frozen", canonicalDayActionType: "freeze" },
        { date: "2026-03-23", status: "open" },
      ]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 5);
    assert.equal(timeline.validity.compensationDays, 2);
    // Two extension days should be at the tail.
    assert.equal(timeline.days[3].status, "extension");
    assert.equal(timeline.days[4].status, "extension");
  });

  await t.test("Case 8: Expired subscription (past validityEndDate)", async () => {
    // Current date is 2026-03-18
    // If sub ended in Feb
    const pastDate = new Date("2026-02-01T21:00:00.000Z");
    const expiredSub = {
      _id: subId,
      startDate: pastDate,
      endDate: pastDate,
      validityEndDate: pastDate,
    };

    Subscription.findById = () => createFindQuery(expiredSub);

    SubscriptionDay.find = () => createFindQuery([]);

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 1);
    assert.equal(timeline.days[0].date, "2026-02-02"); // KSA normalization
  });
});
