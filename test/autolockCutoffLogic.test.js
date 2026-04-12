/**
 * autolockCutoffLogic.test.js
 *
 * Tests for processDailyCutoff — the auto-lock cutoff business logic.
 *
 * Credit deduction rule: always charge mealsPerDay (full quota),
 * regardless of how many meals were actually selected.
 *
 * Covered scenarios:
 *  1. Courier / delivery complete     → locked + full deduction (mealsPerDay)
 *  2. Courier / delivery incomplete   → locked + full deduction (mealsPerDay, not actual)
 *  3. Courier / delivery empty        → locked + full deduction (mealsPerDay)
 *  4. Pickup complete                 → locked + autoLocked=true + pickupRequested=false + full deduction
 *  5. Pickup incomplete               → locked + autoLocked=true + full deduction (mealsPerDay)
 *  6. Pickup empty                    → locked + autoLocked=true + full deduction (mealsPerDay)
 *  7. Subscription inactive           → skip (no lock)
 *  8. remainingMeals < mealsPerDay    → deduct all remaining, log credit_deficit
 *  9. Already locked day              → skip (status='open' filter means it's never returned)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Feature flags needed for canonical path
process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
process.env.PHASE2_GENERIC_PREMIUM_WALLET = "true";

const { processDailyCutoff } = require("../src/services/automationService");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Subscription = require("../src/models/Subscription");
const ActivityLog = require("../src/models/ActivityLog");
const NotificationLog = require("../src/models/NotificationLog");
const User = require("../src/models/User");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function objectId() {
    return new mongoose.Types.ObjectId();
}

function createQueryStub(result) {
    return {
        populate() { return this; },
        select() { return this; },
        sort() { return this; },
        limit() { return this; },
        session() { return this; },
        lean() { return Promise.resolve(result); },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
}

/**
 * Return a minimal subscription fixture.
 * deliveryMode: "delivery" (courier) or "pickup"
 */
function makeSub(overrides = {}) {
    return {
        _id: objectId(),
        userId: objectId(),
        status: "active",
        deliveryMode: "delivery",
        selectedMealsPerDay: 3,
        remainingMeals: 30,
        addonSubscriptions: [],
        premiumSelections: [],
        addonSelections: [],
        ...overrides,
    };
}

/**
 * Return a minimal SubscriptionDay fixture with a save() stub.
 */
function makeDay(sub, selectionIds = [], overrides = {}) {
    return {
        _id: objectId(),
        date: "2026-04-13",
        status: "open",
        selections: selectionIds,
        premiumSelections: [],
        subscriptionId: sub,
        async save() { return this; },
        ...overrides,
    };
}

/** Stub SubscriptionDay.find to return the given days. */
function stubDayFind(days) {
    SubscriptionDay.find = () => ({
        populate() { return Promise.resolve(days); },
    });
}

/** Capture all ActivityLog.create calls during the test. */
function captureActivityLogs() {
    const logs = [];
    ActivityLog.create = async (doc) => { logs.push(doc); return doc; };
    return logs;
}

/** Standard no-op stubs for notification and user lookups. */
function stubNotifications() {
    NotificationLog.create = async () => ({});
    User.findById = () => createQueryStub({ _id: objectId(), fcmTokens: [] });
}

// ─── 1. Courier complete → locked + full deduction ───────────────────────────
test("1 — delivery/courier complete: locked, full credit deduction (mealsPerDay=3)", async (t) => {
    const sub = makeSub({ deliveryMode: "delivery", selectedMealsPerDay: 3, remainingMeals: 10 });
    const day = makeDay(sub, [objectId(), objectId(), objectId()]); // 3 of 3

    stubDayFind([day]);
    stubNotifications();
    const logs = captureActivityLogs();

    const subscriptionUpdates = [];
    const origUpdate = Subscription.findByIdAndUpdate;
    Subscription.findByIdAndUpdate = async (id, update) => { subscriptionUpdates.push({ id, update }); return null; };
    t.after(() => { Subscription.findByIdAndUpdate = origUpdate; });

    await processDailyCutoff();

    assert.equal(day.status, "locked");
    assert.equal(day.autoLocked, true);
    assert.equal(day.creditsDeducted, true);
    assert.equal(day.pickupRequested, undefined, "pickupRequested not set for delivery");

    // Full 3-meal deduction
    assert.equal(subscriptionUpdates.length, 1);
    assert.deepEqual(subscriptionUpdates[0].update, { $inc: { remainingMeals: -3 } });

    const lockLog = logs.find((l) => l.action === "auto_lock");
    assert.ok(lockLog, "auto_lock log expected");
    assert.equal(lockLog.meta.reason, "auto_locked_complete");
    assert.equal(lockLog.meta.mealsSelected, 3);  // actual selections
    assert.equal(lockLog.meta.mealsDeducted, 3);  // charged
    assert.equal(lockLog.meta.deliveryMode, "delivery");
    assert.equal(lockLog.meta.credit_deficit, undefined);
});

// ─── 2. Courier incomplete → locked + full deduction (mealsPerDay, not actual) ─
test("2 — delivery/courier incomplete (2 of 3): locked, deducts mealsPerDay=3", async (t) => {
    const sub = makeSub({ deliveryMode: "delivery", selectedMealsPerDay: 3, remainingMeals: 10 });
    const day = makeDay(sub, [objectId(), objectId()]); // only 2 of 3

    stubDayFind([day]);
    stubNotifications();
    const logs = captureActivityLogs();

    const subscriptionUpdates = [];
    const origUpdate = Subscription.findByIdAndUpdate;
    Subscription.findByIdAndUpdate = async (id, update) => { subscriptionUpdates.push({ id, update }); return null; };
    t.after(() => { Subscription.findByIdAndUpdate = origUpdate; });

    await processDailyCutoff();

    assert.equal(day.status, "locked");
    assert.equal(day.autoLocked, true);
    assert.equal(day.creditsDeducted, true);

    // Deducts full mealsPerDay=3, NOT the 2 actually selected
    assert.equal(subscriptionUpdates.length, 1);
    assert.deepEqual(subscriptionUpdates[0].update, { $inc: { remainingMeals: -3 } });

    const lockLog = logs.find((l) => l.action === "auto_lock");
    assert.equal(lockLog.meta.reason, "locked_with_incomplete_plan");
    assert.equal(lockLog.meta.mealsSelected, 2);  // actual selections logged truthfully
    assert.equal(lockLog.meta.mealsRequired, 3);
    assert.equal(lockLog.meta.mealsDeducted, 3);  // charged full quota
});

// ─── 3. Courier empty → locked + full deduction (mealsPerDay) ────────────────
test("3 — delivery/courier empty (0 selected): locked, deducts full mealsPerDay=3", async (t) => {
    const sub = makeSub({ deliveryMode: "delivery", selectedMealsPerDay: 3, remainingMeals: 10 });
    const day = makeDay(sub, []); // 0 meals

    stubDayFind([day]);
    stubNotifications();
    const logs = captureActivityLogs();

    const subscriptionUpdates = [];
    const origUpdate = Subscription.findByIdAndUpdate;
    Subscription.findByIdAndUpdate = async (id, update) => { subscriptionUpdates.push({ id, update }); return null; };
    t.after(() => { Subscription.findByIdAndUpdate = origUpdate; });

    await processDailyCutoff();

    assert.equal(day.status, "locked");
    assert.equal(day.autoLocked, true);
    assert.equal(day.creditsDeducted, true, "creditsDeducted=true always for open days");

    // Deducts full mealsPerDay=3 even with 0 selected
    assert.equal(subscriptionUpdates.length, 1);
    assert.deepEqual(subscriptionUpdates[0].update, { $inc: { remainingMeals: -3 } });

    const lockLog = logs.find((l) => l.action === "auto_lock");
    assert.equal(lockLog.meta.reason, "locked_empty_day");
    assert.equal(lockLog.meta.mealsSelected, 0);  // actual
    assert.equal(lockLog.meta.mealsDeducted, 3);  // full quota charged
});

// ─── 4. Pickup complete → locked + autoLocked=true + pickupRequested=false ───
test("4 — pickup complete: locked + autoLocked=true + pickupRequested=false + full deduction", async (t) => {
    const sub = makeSub({ deliveryMode: "pickup", selectedMealsPerDay: 3, remainingMeals: 10 });
    const day = makeDay(sub, [objectId(), objectId(), objectId()], { pickupRequested: true });

    stubDayFind([day]);
    stubNotifications();
    const logs = captureActivityLogs();

    const subscriptionUpdates = [];
    const origUpdate = Subscription.findByIdAndUpdate;
    Subscription.findByIdAndUpdate = async (id, update) => { subscriptionUpdates.push({ id, update }); return null; };
    t.after(() => { Subscription.findByIdAndUpdate = origUpdate; });

    await processDailyCutoff();

    assert.equal(day.status, "locked");
    assert.equal(day.autoLocked, true);
    assert.equal(day.pickupRequested, false, "autoLock must set pickupRequested=false");
    assert.equal(day.creditsDeducted, true);

    assert.equal(subscriptionUpdates.length, 1);
    assert.deepEqual(subscriptionUpdates[0].update, { $inc: { remainingMeals: -3 } });

    const lockLog = logs.find((l) => l.action === "auto_lock");
    assert.equal(lockLog.meta.reason, "auto_locked_complete");
    assert.equal(lockLog.meta.deliveryMode, "pickup");
    assert.equal(lockLog.meta.mealsDeducted, 3);
});

// ─── 5. Pickup incomplete → locked + full deduction ──────────────────────────
test("5 — pickup incomplete (2 of 3): locked + autoLocked=true + deducts mealsPerDay=3", async (t) => {
    const sub = makeSub({ deliveryMode: "pickup", selectedMealsPerDay: 3, remainingMeals: 10 });
    const day = makeDay(sub, [objectId(), objectId()]); // 2 of 3

    stubDayFind([day]);
    stubNotifications();
    const logs = captureActivityLogs();

    const subscriptionUpdates = [];
    const origUpdate = Subscription.findByIdAndUpdate;
    Subscription.findByIdAndUpdate = async (id, update) => { subscriptionUpdates.push({ id, update }); return null; };
    t.after(() => { Subscription.findByIdAndUpdate = origUpdate; });

    await processDailyCutoff();

    assert.equal(day.status, "locked");
    assert.equal(day.autoLocked, true);
    assert.equal(day.pickupRequested, false);
    assert.equal(day.creditsDeducted, true);

    // Full mealsPerDay=3 deducted
    assert.equal(subscriptionUpdates.length, 1);
    assert.deepEqual(subscriptionUpdates[0].update, { $inc: { remainingMeals: -3 } });

    const lockLog = logs.find((l) => l.action === "auto_lock");
    assert.equal(lockLog.meta.reason, "pickup_auto_locked_incomplete");
    assert.equal(lockLog.meta.mealsSelected, 2);  // actual
    assert.equal(lockLog.meta.mealsDeducted, 3);  // full quota
});

// ─── 6. Pickup empty → locked + full deduction ───────────────────────────────
test("6 — pickup empty (0 selected): locked + autoLocked=true + deducts mealsPerDay=3", async (t) => {
    const sub = makeSub({ deliveryMode: "pickup", selectedMealsPerDay: 3, remainingMeals: 10 });
    const day = makeDay(sub, []);

    stubDayFind([day]);
    stubNotifications();
    const logs = captureActivityLogs();

    const subscriptionUpdates = [];
    const origUpdate = Subscription.findByIdAndUpdate;
    Subscription.findByIdAndUpdate = async (id, update) => { subscriptionUpdates.push({ id, update }); return null; };
    t.after(() => { Subscription.findByIdAndUpdate = origUpdate; });

    await processDailyCutoff();

    assert.equal(day.status, "locked");
    assert.equal(day.autoLocked, true);
    assert.equal(day.pickupRequested, false);
    assert.equal(day.creditsDeducted, true);

    // Full mealsPerDay=3 deducted even with 0 selected
    assert.equal(subscriptionUpdates.length, 1);
    assert.deepEqual(subscriptionUpdates[0].update, { $inc: { remainingMeals: -3 } });

    const lockLog = logs.find((l) => l.action === "auto_lock");
    assert.equal(lockLog.meta.reason, "pickup_auto_locked_empty");
    assert.equal(lockLog.meta.mealsSelected, 0);
    assert.equal(lockLog.meta.mealsDeducted, 3);
});

// ─── 7. Subscription inactive → skip ─────────────────────────────────────────
test("7 — inactive subscription: day is skipped, not locked", async (t) => {
    const sub = makeSub({ status: "expired" });
    const day = makeDay(sub, [objectId(), objectId(), objectId()]);

    stubDayFind([day]);
    stubNotifications();
    const logs = captureActivityLogs();

    const subscriptionUpdates = [];
    const origUpdate = Subscription.findByIdAndUpdate;
    Subscription.findByIdAndUpdate = async (id, update) => { subscriptionUpdates.push({ id, update }); return null; };
    t.after(() => { Subscription.findByIdAndUpdate = origUpdate; });

    await processDailyCutoff();

    assert.equal(day.status, "open", "Status must remain open — inactive sub skipped");
    assert.equal(subscriptionUpdates.length, 0, "No credit deduction for inactive subscription");
    const autoLockLogs = logs.filter((l) => l.action === "auto_lock");
    assert.equal(autoLockLogs.length, 0, "No auto_lock log for inactive subscription");
});

// ─── 8. remainingMeals < mealsPerDay → deduct all remaining, log deficit ─────
test("8 — insufficient remaining meals (1 of 3): deduct remaining=1 + log credit_deficit=2", async (t) => {
    // mealsPerDay=3 but only 1 credit remaining
    const sub = makeSub({ deliveryMode: "delivery", selectedMealsPerDay: 3, remainingMeals: 1 });
    const day = makeDay(sub, [objectId(), objectId(), objectId()]); // complete plan

    stubDayFind([day]);
    stubNotifications();
    const logs = captureActivityLogs();

    const subscriptionUpdates = [];
    const origUpdate = Subscription.findByIdAndUpdate;
    Subscription.findByIdAndUpdate = async (id, update) => { subscriptionUpdates.push({ id, update }); return null; };
    t.after(() => { Subscription.findByIdAndUpdate = origUpdate; });

    await processDailyCutoff();

    assert.equal(day.status, "locked", "Day must still be locked despite deficit");
    assert.equal(day.creditsDeducted, true);

    // Only 1 (remaining) deducted, not 3
    assert.equal(subscriptionUpdates.length, 1);
    assert.deepEqual(subscriptionUpdates[0].update, { $inc: { remainingMeals: -1 } });

    const lockLog = logs.find((l) => l.action === "auto_lock");
    assert.equal(lockLog.meta.mealsDeducted, 1, "Only remaining meals deducted");
    assert.equal(lockLog.meta.credit_deficit, 2, "Deficit of 2 logged");
    assert.equal(lockLog.meta.reason, "auto_locked_complete");
});

// ─── 9. Already locked day → skipped (not returned by find) ──────────────────
test("9 — already locked day: find query filters it out, no double-lock", async (t) => {
    // The query uses status: 'open' — a locked day would never be returned.
    SubscriptionDay.find = () => ({
        populate() { return Promise.resolve([]); },
    });

    stubNotifications();
    const logs = captureActivityLogs();

    const subscriptionUpdates = [];
    const origUpdate = Subscription.findByIdAndUpdate;
    Subscription.findByIdAndUpdate = async (id, update) => { subscriptionUpdates.push({ id, update }); return null; };
    t.after(() => { Subscription.findByIdAndUpdate = origUpdate; });

    await processDailyCutoff();

    assert.equal(subscriptionUpdates.length, 0, "No updates when no open days exist");
    const autoLockLogs = logs.filter((l) => l.action === "auto_lock");
    assert.equal(autoLockLogs.length, 0, "No auto_lock logs when no open days");
});
