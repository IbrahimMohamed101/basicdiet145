"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  buildReadOnlyAvailabilityWrapper,
} = require("../src/services/installReadOnlySubscriptionQueries");

async function testDiagnosticFailureDoesNotBreakFlutterAvailability() {
  const authoritativeResponse = {
    subscriptionId: "6a5d621944ff133ba2ee203d",
    subscriptionDayId: "6a5d621944ff133ba2ee2999",
    date: "2026-07-22",
    remainingMeals: 4,
    wallet: {
      totalEntitlement: 52,
      availableMeals: 2,
      reservedMeals: 0,
      consumedMeals: 0,
    },
    summary: {
      availableCount: 2,
      availableSelectableCount: 2,
      canCreatePickupRequest: true,
    },
    slots: [{
      slotId: "slot_1",
      slotKey: "slot_1",
      slotIndex: 1,
      available: true,
      canSelect: true,
    }],
    pickupItems: [{
      itemId: "slot_1",
      itemType: "meal",
      selectionMode: "independent",
      availability: {
        state: "available",
        available: true,
        canSelect: true,
      },
    }],
    sections: [],
    availableSlotIds: ["slot_1"],
    unavailableSlotIds: [],
  };

  let diagnosticCalls = 0;
  const wrapped = buildReadOnlyAvailabilityWrapper(
    async () => authoritativeResponse,
    {
      diagnoseDayDailyAddonState: async () => {
        diagnosticCalls += 1;
        const error = new Error("legacy add-on diagnostic could not inspect malformed snapshot");
        error.code = "LEGACY_ADDON_DIAGNOSTIC_FAILED";
        throw error;
      },
    }
  );

  const result = await wrapped({
    subscriptionId: authoritativeResponse.subscriptionId,
    date: authoritativeResponse.date,
  });

  assert.strictEqual(diagnosticCalls, 1);
  assert.strictEqual(result.subscriptionId, authoritativeResponse.subscriptionId);
  assert.strictEqual(result.subscriptionDayId, authoritativeResponse.subscriptionDayId);
  assert.deepStrictEqual(result.slots, authoritativeResponse.slots);
  assert.deepStrictEqual(result.pickupItems, authoritativeResponse.pickupItems);
  assert.deepStrictEqual(result.availableSlotIds, ["slot_1"]);
  assert.strictEqual(result.summary.canCreatePickupRequest, true);
  assert.strictEqual(result.readConsistency.readOnly, true);
  assert.strictEqual(result.dailyAddonReconciliation.state, "diagnostic_unavailable");
  assert.strictEqual(result.dailyAddonReconciliation.diagnosticAvailable, false);
  assert.strictEqual(
    result.dailyAddonReconciliation.diagnosticErrorCode,
    "LEGACY_ADDON_DIAGNOSTIC_FAILED"
  );
}

async function testCoreAvailabilityFailureStillPropagates() {
  const coreError = new Error("authoritative pickup availability failed");
  coreError.code = "CORE_AVAILABILITY_FAILED";
  let diagnosticCalls = 0;
  const wrapped = buildReadOnlyAvailabilityWrapper(
    async () => {
      throw coreError;
    },
    {
      diagnoseDayDailyAddonState: async () => {
        diagnosticCalls += 1;
        return {};
      },
    }
  );

  await assert.rejects(
    () => wrapped({ subscriptionId: "sub", date: "2026-07-22" }),
    (error) => error === coreError
  );
  assert.strictEqual(diagnosticCalls, 0, "diagnostics must run only after the core response succeeds");
}

async function testMissingDaySkipsDiagnostic() {
  let diagnosticCalls = 0;
  const wrapped = buildReadOnlyAvailabilityWrapper(
    async () => ({
      subscriptionId: "sub",
      subscriptionDayId: null,
      slots: [],
      pickupItems: [],
      availableSlotIds: [],
      unavailableSlotIds: [],
    }),
    {
      diagnoseDayDailyAddonState: async () => {
        diagnosticCalls += 1;
        return {};
      },
    }
  );

  const result = await wrapped({ subscriptionId: "sub", date: "2026-07-22" });
  assert.strictEqual(diagnosticCalls, 0);
  assert.strictEqual(result.dailyAddonReconciliation, null);
  assert.strictEqual(result.readConsistency.readOnly, true);
}

async function run() {
  await testDiagnosticFailureDoesNotBreakFlutterAvailability();
  await testCoreAvailabilityFailureStillPropagates();
  await testMissingDaySkipsDiagnostic();
  console.log("pickup availability diagnostic fail-open checks passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
