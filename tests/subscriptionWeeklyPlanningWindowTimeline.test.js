"use strict";

require("./helpers/temporaryEnvironment").setTemporaryEnvironment({
  SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED: "true",
});

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  projectTimelineToWeeklyPlanningWindow,
} = require("../src/services/installSubscriptionWeeklyPlanningWindow");
const {
  INVALID_PLANNING_WINDOW_DATE_CODE,
  PLANNING_WINDOW_REASONS,
} = require("../src/services/subscription/subscriptionPlanningWindowService");

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    throw error;
  }
}

function timelineFixture(overrides = {}) {
  return {
    subscriptionId: "507f191e810c19729de86001",
    validity: {
      startDate: "2026-04-20",
      endDate: "2026-05-31",
      validityEndDate: "2026-05-31",
    },
    mealBalance: {
      totalMeals: 30,
      remainingMeals: 30,
    },
    months: [],
    days: [
      {
        date: "2026-04-29",
        status: "open",
        dayStatus: "open",
        timelineStatus: "empty",
        selectionStatus: "empty",
        canEdit: true,
        locked: false,
        lockedReason: null,
        lockedMessage: null,
      },
      {
        date: "2026-05-01",
        status: "open",
        dayStatus: "open",
        timelineStatus: "empty",
        selectionStatus: "empty",
        canEdit: true,
        locked: false,
        lockedReason: null,
        lockedMessage: null,
      },
      {
        date: "2026-05-02",
        status: "open",
        dayStatus: "open",
        timelineStatus: "empty",
        selectionStatus: "empty",
        canEdit: true,
        locked: false,
        lockedReason: null,
        lockedMessage: null,
      },
      {
        date: "2026-05-06",
        status: "open",
        dayStatus: "open",
        timelineStatus: "empty",
        selectionStatus: "empty",
        canEdit: true,
        locked: false,
        lockedReason: null,
        lockedMessage: null,
      },
    ],
    ...overrides,
  };
}

function run() {
  test("disabled timeline projection preserves exact object identity", () => {
    const source = timelineFixture();
    assert.strictEqual(
      projectTimelineToWeeklyPlanningWindow(source, {
        businessDate: "2026-04-29",
        enabled: false,
      }),
      source
    );
  });

  test("enabled projection exposes rolling seven-day metadata", () => {
    const source = timelineFixture();
    const projected = projectTimelineToWeeklyPlanningWindow(source, {
      businessDate: "2026-04-29",
      enabled: true,
      lang: "en",
    });

    assert.notStrictEqual(projected, source);
    assert.deepStrictEqual(projected.planningWindow, {
      version: "subscription_weekly_planning_window.v2",
      enabled: true,
      available: true,
      mode: "rolling_7_days",
      horizonDays: 7,
      businessDate: "2026-04-29",
      menuWeekStart: "2026-04-25",
      menuWeekEnd: "2026-05-01",
      planningWindowStart: "2026-04-29",
      planningWindowEnd: "2026-05-05",
      rollingWindowEnd: "2026-05-05",
      subscriptionStartDate: "2026-04-20",
      subscriptionValidityEndDate: "2026-05-31",
    });

    for (const date of ["2026-04-29", "2026-05-01", "2026-05-02"]) {
      const day = projected.days.find((row) => row.date === date);
      assert.strictEqual(day.canEdit, true, date);
      assert.strictEqual(day.status, "open", date);
      assert.strictEqual(day.withinPlanningWindow, true, date);
      assert.strictEqual(day.withinCurrentMenuWeek, true, date);
      assert.strictEqual(day.planningWindowReason, null, date);
    }
  });

  test("the next Saturday remains editable before the calendar week flips", () => {
    const source = timelineFixture();
    const sourceSnapshot = JSON.stringify(source);
    const projected = projectTimelineToWeeklyPlanningWindow(source, {
      businessDate: "2026-04-29",
      enabled: true,
      lang: "en",
    });
    const day = projected.days.find((row) => row.date === "2026-05-02");

    assert.strictEqual(day.canEdit, true);
    assert.strictEqual(day.status, "open");
    assert.strictEqual(day.dayStatus, "open");
    assert.strictEqual(day.locked, false);
    assert.strictEqual(day.planningWindowReason, null);
    assert.strictEqual(day.withinPlanningWindow, true);
    assert.strictEqual(JSON.stringify(source), sourceSnapshot, "source timeline is not mutated");
  });

  test("a date beyond the rolling horizon becomes read-only and locked", () => {
    const projected = projectTimelineToWeeklyPlanningWindow(timelineFixture(), {
      businessDate: "2026-04-29",
      enabled: true,
      lang: "en",
    });
    const day = projected.days.find((row) => row.date === "2026-05-06");

    assert.strictEqual(day.canEdit, false);
    assert.strictEqual(day.status, "locked");
    assert.strictEqual(day.dayStatus, "locked");
    assert.strictEqual(day.locked, true);
    assert.strictEqual(
      day.lockedReason,
      PLANNING_WINDOW_REASONS.OUTSIDE_CURRENT_MENU_WEEK
    );
    assert.strictEqual(day.withinPlanningWindow, false);
    assert(day.lockedMessage.includes("planning window"));
  });

  test("a confirmed next-week selection remains planned and visible", () => {
    const source = timelineFixture({
      days: [{
        date: "2026-05-02",
        status: "planned",
        dayStatus: "open",
        timelineStatus: "planned",
        selectionStatus: "confirmed",
        isPlanned: true,
        canShowAsPlanned: true,
        canEdit: false,
        locked: false,
        lockedReason: null,
        lockedMessage: null,
      }],
    });
    const projected = projectTimelineToWeeklyPlanningWindow(source, {
      businessDate: "2026-04-29",
      enabled: true,
      lang: "ar",
    });
    const [day] = projected.days;

    assert.strictEqual(day.status, "planned");
    assert.strictEqual(day.timelineStatus, "planned");
    assert.strictEqual(day.selectionStatus, "confirmed");
    assert.strictEqual(day.isPlanned, true);
    assert.strictEqual(day.canShowAsPlanned, true);
    assert.strictEqual(day.canEdit, false);
    assert.strictEqual(day.withinPlanningWindow, true);
    assert.strictEqual(day.planningWindowReason, null);
    assert.strictEqual(day.lockedReason, null, "operational/planned status is not overwritten");
  });

  test("invalid subscription validity fails closed only when enabled", () => {
    const source = timelineFixture({
      validity: {
        startDate: "invalid",
        endDate: "2026-05-31",
        validityEndDate: "2026-05-31",
      },
      days: [{
        date: "2026-04-29",
        status: "open",
        dayStatus: "open",
        canEdit: true,
        locked: false,
      }],
    });
    const projected = projectTimelineToWeeklyPlanningWindow(source, {
      businessDate: "2026-04-29",
      enabled: true,
      lang: "en",
    });

    assert.strictEqual(projected.planningWindow.available, false);
    assert.strictEqual(
      projected.planningWindow.errorCode,
      INVALID_PLANNING_WINDOW_DATE_CODE
    );
    assert.strictEqual(projected.days[0].canEdit, false);
    assert.strictEqual(projected.days[0].status, "locked");
    assert.strictEqual(
      projected.days[0].lockedReason,
      INVALID_PLANNING_WINDOW_DATE_CODE
    );
  });

  test("route composition installs timeline decorator before subscription routes", () => {
    const routesSource = fs.readFileSync(
      path.join(__dirname, "../src/routes/index.js"),
      "utf8"
    );
    const installerIndex = routesSource.indexOf(
      'require("../services/installSubscriptionWeeklyPlanningWindow")'
    );
    const subscriptionRouteIndex = routesSource.indexOf(
      'const subscriptionRoutes = require("./subscriptions")'
    );

    assert(installerIndex >= 0, "weekly planning timeline installer must be mounted");
    assert(subscriptionRouteIndex >= 0, "subscription routes must exist");
    assert(
      installerIndex < subscriptionRouteIndex,
      "timeline decorator must install before subscription routes capture the service"
    );
  });

  console.log(
    `subscriptionWeeklyPlanningWindowTimeline.test.js: ${passed}/${passed} checks passed`
  );
}

run();
