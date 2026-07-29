"use strict";

require("./helpers/temporaryEnvironment").setTemporaryEnvironment({
  SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED: "true",
});

const assert = require("assert");
const {
  INVALID_PLANNING_WINDOW_DATE_CODE,
  PLANNING_WINDOW_REASONS,
  SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_FLAG,
  evaluatePlanningDate,
  evaluateSubscriptionPlanningDate,
  isWeeklyPlanningWindowEnabled,
  resolveCurrentMenuWeek,
  resolveSubscriptionPlanningWindow,
} = require("../src/services/subscription/subscriptionPlanningWindowService");

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    console.error(`❌ ${name}`);
    throw err;
  }
}

function assertWindow(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(actual[key], value, `${key} mismatch`);
  }
}

function run() {
  test("weekly planning feature flag is disabled by default", () => {
    assert.strictEqual(isWeeklyPlanningWindowEnabled({}), false);
    for (const enabledValue of ["1", "true", "yes", "on", "TRUE"]) {
      assert.strictEqual(
        isWeeklyPlanningWindowEnabled({
          [SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_FLAG]: enabledValue,
        }),
        true,
        enabledValue
      );
    }
    for (const disabledValue of ["", "0", "false", "off", "no"] ) {
      assert.strictEqual(
        isWeeklyPlanningWindowEnabled({
          [SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_FLAG]: disabledValue,
        }),
        false,
        disabledValue
      );
    }
  });

  test("Saturday opens the full Saturday-to-Friday menu week", () => {
    const result = resolveCurrentMenuWeek({ businessDate: "2026-08-01" });
    assertWindow(result, {
      businessDate: "2026-08-01",
      menuWeekStart: "2026-08-01",
      menuWeekEnd: "2026-08-07",
    });
  });

  test("A midweek business date only exposes today through Friday", () => {
    const result = resolveSubscriptionPlanningWindow({
      businessDate: "2026-07-28",
    });
    assertWindow(result, {
      menuWeekStart: "2026-07-25",
      menuWeekEnd: "2026-07-31",
      planningWindowStart: "2026-07-28",
      planningWindowEnd: "2026-07-31",
      hasSelectableDates: true,
    });
  });

  test("Friday exposes Friday only", () => {
    const result = resolveSubscriptionPlanningWindow({
      businessDate: "2026-07-31",
    });
    assertWindow(result, {
      menuWeekStart: "2026-07-25",
      menuWeekEnd: "2026-07-31",
      planningWindowStart: "2026-07-31",
      planningWindowEnd: "2026-07-31",
      hasSelectableDates: true,
    });
  });

  test("Menu weeks cross month boundaries without changing Saturday-Friday semantics", () => {
    const result = resolveCurrentMenuWeek({ businessDate: "2026-09-01" });
    assertWindow(result, {
      menuWeekStart: "2026-08-29",
      menuWeekEnd: "2026-09-04",
    });
  });

  test("Menu weeks cross year boundaries safely", () => {
    const result = resolveCurrentMenuWeek({ businessDate: "2026-12-31" });
    assertWindow(result, {
      menuWeekStart: "2026-12-26",
      menuWeekEnd: "2027-01-01",
    });
  });

  test("Subscription start date narrows the beginning of the planning window", () => {
    const result = resolveSubscriptionPlanningWindow({
      businessDate: "2026-07-25",
      subscriptionStartDate: "2026-07-28",
      subscriptionValidityEndDate: "2026-08-30",
    });
    assertWindow(result, {
      planningWindowStart: "2026-07-28",
      planningWindowEnd: "2026-07-31",
      hasSelectableDates: true,
    });
  });

  test("Subscription validity narrows the end of the planning window", () => {
    const result = resolveSubscriptionPlanningWindow({
      businessDate: "2026-07-25",
      subscriptionStartDate: "2026-07-20",
      subscriptionValidityEndDate: "2026-07-29",
    });
    assertWindow(result, {
      planningWindowStart: "2026-07-25",
      planningWindowEnd: "2026-07-29",
      hasSelectableDates: true,
    });
  });

  test("A subscription starting after Friday has no selectable date in the current menu week", () => {
    const result = resolveSubscriptionPlanningWindow({
      businessDate: "2026-07-28",
      subscriptionStartDate: "2026-08-01",
      subscriptionValidityEndDate: "2026-08-30",
    });
    assert.strictEqual(result.hasSelectableDates, false);
    assert.strictEqual(result.planningWindowStart, "2026-08-01");
    assert.strictEqual(result.planningWindowEnd, "2026-07-31");
  });

  test("A date inside the current menu week and subscription validity is allowed", () => {
    const result = evaluatePlanningDate({
      requestedDate: "2026-07-30",
      businessDate: "2026-07-28",
      subscriptionStartDate: "2026-07-20",
      subscriptionValidityEndDate: "2026-08-30",
    });
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, null);
  });

  test("Subscription documents use startDate and validityEndDate as planning bounds", () => {
    const result = evaluateSubscriptionPlanningDate({
      subscription: {
        startDate: new Date("2026-07-27T21:00:00.000Z"),
        endDate: new Date("2026-08-20T20:59:59.999Z"),
        validityEndDate: new Date("2026-08-30T20:59:59.999Z"),
      },
      requestedDate: "2026-07-30",
      businessDate: "2026-07-28",
    });
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.subscriptionStartDate, "2026-07-28");
    assert.strictEqual(result.subscriptionValidityEndDate, "2026-08-30");
  });

  test("The next Saturday is rejected until the new menu week begins", () => {
    const result = evaluatePlanningDate({
      requestedDate: "2026-08-01",
      businessDate: "2026-07-28",
      subscriptionStartDate: "2026-07-20",
      subscriptionValidityEndDate: "2026-08-30",
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(
      result.reason,
      PLANNING_WINDOW_REASONS.OUTSIDE_CURRENT_MENU_WEEK
    );
  });

  test("Past dates are rejected independently from the weekly window", () => {
    const result = evaluatePlanningDate({
      requestedDate: "2026-07-27",
      businessDate: "2026-07-28",
      subscriptionStartDate: "2026-07-20",
      subscriptionValidityEndDate: "2026-08-30",
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, PLANNING_WINDOW_REASONS.DATE_IN_PAST);
  });

  test("Dates before subscription start are rejected explicitly", () => {
    const result = evaluatePlanningDate({
      requestedDate: "2026-07-26",
      businessDate: "2026-07-25",
      subscriptionStartDate: "2026-07-28",
      subscriptionValidityEndDate: "2026-08-30",
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(
      result.reason,
      PLANNING_WINDOW_REASONS.BEFORE_SUBSCRIPTION_START
    );
  });

  test("Dates after subscription validity are rejected explicitly", () => {
    const result = evaluatePlanningDate({
      requestedDate: "2026-07-30",
      businessDate: "2026-07-25",
      subscriptionStartDate: "2026-07-20",
      subscriptionValidityEndDate: "2026-07-29",
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(
      result.reason,
      PLANNING_WINDOW_REASONS.AFTER_SUBSCRIPTION_VALIDITY
    );
  });

  test("Date objects are normalized in the configured KSA timezone", () => {
    const result = resolveSubscriptionPlanningWindow({
      businessDate: new Date("2026-07-28T00:30:00+03:00"),
      subscriptionStartDate: new Date("2026-07-25T00:00:00+03:00"),
      subscriptionValidityEndDate: new Date("2026-08-30T23:59:59+03:00"),
    });
    assert.strictEqual(result.businessDate, "2026-07-28");
    assert.strictEqual(result.planningWindowEnd, "2026-07-31");
  });

  test("Impossible calendar dates fail closed", () => {
    assert.throws(
      () => resolveCurrentMenuWeek({ businessDate: "2026-02-31" }),
      (err) => err && err.code === INVALID_PLANNING_WINDOW_DATE_CODE
    );
  });

  test("Invalid Date objects fail with the same safe validation code", () => {
    assert.throws(
      () => resolveCurrentMenuWeek({ businessDate: new Date("invalid") }),
      (err) => (
        err
        && err.code === INVALID_PLANNING_WINDOW_DATE_CODE
        && err.details
        && err.details.value === "Invalid Date"
      )
    );
  });

  console.log(`subscriptionPlanningWindowService.test.js: ${passed}/${passed} checks passed`);
}

run();
