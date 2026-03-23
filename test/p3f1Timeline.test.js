"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const { toKSADateString } = require("../src/utils/date");

// Import the service directly for unit testing the logic
const { buildSubscriptionTimeline } = require("../src/services/subscriptionService");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");

function objectId() {
  return new mongoose.Types.ObjectId();
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
  };

  await t.test("Case 1: Baseline (No freeze, no skip, all days present)", async () => {
    Subscription.findById = () => ({
      lean: () => Promise.resolve(mockSubscription)
    });
    
    SubscriptionDay.find = () => ({
      lean: () => Promise.resolve([
        { date: "2026-03-21", status: "open" },
        { date: "2026-03-22", status: "locked", lockedAt: new Date(), lockedSnapshot: {} },
        { date: "2026-03-23", status: "fulfilled" },
      ])
    });

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 3);
    assert.equal(timeline.validity.compensationDays, 0);
    assert.equal(timeline.days[0].status, "planned");
    assert.equal(timeline.days[1].status, "locked");
    assert.equal(timeline.days[1].locked, true);
    assert.equal(timeline.days[2].status, "delivered");
    assert.deepEqual(timeline.days.map((d) => d.source), ["base", "base", "base"]);
  });

  await t.test("Case 2: Single freeze → 1 extension day", async () => {
    const extendedSub = { 
      ...mockSubscription, 
      validityEndDate: new Date("2026-03-23T21:00:00.000Z") // 2026-03-24 KSA
    };
    
    Subscription.findById = () => ({
      lean: () => Promise.resolve(extendedSub)
    });
    
    SubscriptionDay.find = () => ({
      lean: () => Promise.resolve([
        { date: "2026-03-21", status: "frozen", canonicalDayActionType: "freeze" },
        { date: "2026-03-22", status: "open" },
        { date: "2026-03-23", status: "open" },
        { date: "2026-03-24", status: "open" }, // Extension day created by sync
      ])
    });

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 4);
    assert.equal(timeline.validity.compensationDays, 1);
    assert.equal(timeline.days[0].status, "frozen");
    assert.equal(timeline.days[3].status, "extension");
    assert.equal(timeline.days[3].source, "freeze_compensation");
    assert.equal(timeline.days[3].isExtension, true);
  });

  await t.test("Case 3: Missing days in DB → handle as 'planned'", async () => {
    Subscription.findById = () => ({
      lean: () => Promise.resolve(mockSubscription)
    });
    
    SubscriptionDay.find = () => ({
      lean: () => Promise.resolve([]) // No days in DB
    });

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 3);
    assert.ok(timeline.days.every(d => d.status === "planned"));
  });

  await t.test("Case 4: Mixed freeze + skip", async () => {
    const extendedSub = { 
      ...mockSubscription, 
      validityEndDate: new Date("2026-03-23T21:00:00.000Z") // 2026-03-24 KSA
    };
    
    Subscription.findById = () => ({
      lean: () => Promise.resolve(extendedSub)
    });
    
    SubscriptionDay.find = () => ({
      lean: () => Promise.resolve([
        { date: "2026-03-21", status: "frozen", canonicalDayActionType: "freeze" },
        { date: "2026-03-22", status: "skipped", canonicalDayActionType: "skip" },
        { date: "2026-03-23", status: "open" },
      ])
    });

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 4);
    assert.equal(timeline.validity.compensationDays, 1);
    assert.equal(timeline.days[0].status, "frozen");
    assert.equal(timeline.days[1].status, "skipped");
    assert.equal(timeline.days[1].isExtension, false);
    assert.equal(timeline.days[3].status, "extension"); // Derived extension
  });

  await t.test("Case 5: Locked frozen day vs Regular frozen day", async () => {
    Subscription.findById = () => ({
      lean: () => Promise.resolve(mockSubscription)
    });
    
    SubscriptionDay.find = () => ({
      lean: () => Promise.resolve([
        { 
          date: "2026-03-21", 
          status: "frozen", 
          canonicalDayActionType: "freeze", 
          lockedSnapshot: { note: "locked even if frozen" } 
        },
      ])
    });

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days[0].status, "frozen");
    assert.equal(timeline.days[0].locked, true);
  });

  await t.test("Case 6: Skip only (no extension)", async () => {
    Subscription.findById = () => ({
      lean: () => Promise.resolve(mockSubscription)
    });

    SubscriptionDay.find = () => ({
      lean: () => Promise.resolve([
        { date: "2026-03-21", status: "skipped", canonicalDayActionType: "skip" },
        { date: "2026-03-22", status: "open" },
        { date: "2026-03-23", status: "fulfilled" },
      ])
    });

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 3);
    assert.equal(timeline.validity.compensationDays, 0);
    assert.equal(timeline.days[0].status, "skipped");
    assert.equal(timeline.days[2].status, "delivered");
  });

  await t.test("Case 7: Multiple freezes -> multiple extension days", async () => {
    const extendedSub = { 
      ...mockSubscription, 
      validityEndDate: new Date("2026-03-24T21:00:00.000Z") // 2026-03-25 KSA
    };
    Subscription.findById = () => ({
      lean: () => Promise.resolve(extendedSub)
    });

    SubscriptionDay.find = () => ({
      lean: () => Promise.resolve([
        { date: "2026-03-21", status: "frozen", canonicalDayActionType: "freeze" },
        { date: "2026-03-22", status: "frozen", canonicalDayActionType: "freeze" },
        { date: "2026-03-23", status: "open" },
      ])
    });

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

    Subscription.findById = () => ({
      lean: () => Promise.resolve(expiredSub)
    });
    
    SubscriptionDay.find = () => ({
      lean: () => Promise.resolve([])
    });

    const timeline = await buildSubscriptionTimeline(subId);

    assert.equal(timeline.days.length, 1);
    assert.equal(timeline.days[0].date, "2026-02-02"); // KSA normalization
  });
});
