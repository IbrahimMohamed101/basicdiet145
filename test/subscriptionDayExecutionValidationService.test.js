"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateDayBeforeLockOrPrepare } = require("../src/services/subscription/subscriptionDayExecutionValidationService");

test("validateDayBeforeLockOrPrepare accepts exact-count legacy day plans", () => {
  const subscription = { selectedMealsPerDay: 2 };
  const day = {
    status: "open",
    selections: ["meal-1"],
    premiumSelections: ["meal-2"],
  };

  assert.doesNotThrow(() => validateDayBeforeLockOrPrepare({ subscription, day }));
});

test("validateDayBeforeLockOrPrepare blocks incomplete day plans before execution", () => {
  const subscription = { selectedMealsPerDay: 2 };
  const day = {
    status: "open",
    selections: ["meal-1"],
    premiumSelections: [],
  };

  assert.throws(
    () => validateDayBeforeLockOrPrepare({ subscription, day }),
    (err) => err && err.code === "PLANNING_INCOMPLETE" && err.status === 422
  );
});

test("validateDayBeforeLockOrPrepare blocks unpaid one-time add-ons before execution", () => {
  const subscription = { selectedMealsPerDay: 1 };
  const day = {
    status: "open",
    selections: ["meal-1"],
    premiumSelections: [],
    oneTimeAddonSelections: [{ addonId: "addon-1", name: "Protein", category: "protein" }],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "pending",
  };

  assert.throws(
    () => validateDayBeforeLockOrPrepare({ subscription, day }),
    (err) => err && err.code === "ONE_TIME_ADDON_PAYMENT_REQUIRED"
  );
});
