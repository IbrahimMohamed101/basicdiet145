"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  CUTOFF_ACTIONS,
  assertTomorrowCutoffAllowed,
} = require("../src/services/subscription/subscriptionCutoffPolicyService");

function testRequiredActionsExist() {
  assert(CUTOFF_ACTIONS && typeof CUTOFF_ACTIONS === "object");
  assert.strictEqual(
    typeof CUTOFF_ACTIONS.SKIP_DAY_CHANGE,
    "string",
    "CUTOFF_ACTIONS.SKIP_DAY_CHANGE must exist for stacked skip"
  );
  assert.strictEqual(
    typeof CUTOFF_ACTIONS.UNSKIP_DAY_CHANGE,
    "string",
    "CUTOFF_ACTIONS.UNSKIP_DAY_CHANGE must exist for stacked unskip"
  );
  assert(CUTOFF_ACTIONS.SKIP_DAY_CHANGE.trim());
  assert(CUTOFF_ACTIONS.UNSKIP_DAY_CHANGE.trim());
  assert.notStrictEqual(
    CUTOFF_ACTIONS.SKIP_DAY_CHANGE,
    CUTOFF_ACTIONS.UNSKIP_DAY_CHANGE,
    "skip and unskip cutoff actions must remain distinct"
  );
}

function testCutoffAssertionFunctionExists() {
  assert.strictEqual(typeof assertTomorrowCutoffAllowed, "function");
}

function run() {
  testRequiredActionsExist();
  testCutoffAssertionFunctionExists();
  console.log("subscription stacking cutoff compatibility tests passed");
}

run();
