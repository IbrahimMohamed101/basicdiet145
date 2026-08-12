"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  assertExtraSelectionCanaryConfiguration,
  isExtraSelectionCanaryEnabledForUser,
} = require(
  "../src/services/subscription/subscriptionStackingRolloutPolicyService"
);
const {
  createStackingSelectionWrappers,
} = require(
  "../src/services/subscription/subscriptionStackingSelectionRouterService"
);
const {
  resolveStackingExtraSelectionAuthority,
} = require(
  "../src/services/subscription/subscriptionStackingExtraSelectionAuthorityService"
);
const {
  serializeSubscriptionDayForClient,
} = require("../src/services/subscription/subscriptionClientSupportService");
const {
  assertSubscriptionStackingProductionSafety,
} = require(
  "../src/services/subscription/subscriptionStackingProductionSafetyService"
);
const {
  applyExtraProjectionToCurrentOverviewResponse,
} = require("../src/services/subscription/subscriptionStackingReadService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function originals() {
  return {
    performDaySelectionUpdate: async () => ({ source: "legacy:update" }),
    performDaySelectionValidation: async () => ({ source: "legacy:validation" }),
    performBulkDaySelectionPlanningBalanceValidation: async () => ({ source: "legacy:bulk" }),
    performDayPlanningConfirmation: async () => ({ source: "legacy:confirmation" }),
  };
}

function testCanaryNeverAcceptsWildcard() {
  const base = {
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    SUBSCRIPTION_STACKING_USER_IDS: "user-a",
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "true",
  };
  assert.throws(
    () => assertExtraSelectionCanaryConfiguration({
      ...base,
      SUBSCRIPTION_STACKING_EXTRA_SELECTION_USER_IDS: "*",
    }),
    (err) => Boolean(err && err.code === "STACKING_EXTRA_SELECTION_WILDCARD_BLOCKED")
  );
  assert.throws(
    () => assertExtraSelectionCanaryConfiguration(base),
    (err) => Boolean(err && err.code === "STACKING_EXTRA_SELECTION_ALLOWLIST_REQUIRED")
  );
  const explicit = {
    ...base,
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_USER_IDS: "user-a",
  };
  assert.strictEqual(isExtraSelectionCanaryEnabledForUser("user-a", explicit), true);
  assert.strictEqual(isExtraSelectionCanaryEnabledForUser("user-b", explicit), false);
  assert.strictEqual(
    isExtraSelectionCanaryEnabledForUser("user-a", {
      ...explicit,
      SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
    }),
    false
  );
  assert.throws(
    () => assertSubscriptionStackingProductionSafety({
      NODE_ENV: "production",
      SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "true",
    }),
    (err) => Boolean(
      err && err.code === "SUBSCRIPTION_STACKING_PRODUCTION_EXTRA_SELECTION_BLOCKED"
    )
  );
}

async function testRouterRequiresCanaryAndPersistedNonLegacyBatch() {
  const calls = [];
  const wrappers = createStackingSelectionWrappers(originals(), {
    writeEnabledForUser: () => true,
    extraCanaryEnabledForUser: (userId) => userId === "canary",
    hasPersistedStackingBatch: async (subscriptionId) => subscriptionId === "stacked",
    stackingUpdate: async (args) => {
      calls.push(args);
      return args;
    },
  });
  let result = await wrappers.performDaySelectionUpdate({
    userId: "canary",
    subscriptionId: "stacked",
  });
  assert.strictEqual(result.extraSelectionEnabled, true);
  result = await wrappers.performDaySelectionUpdate({
    userId: "canary",
    subscriptionId: "legacy-only",
  });
  assert.strictEqual(result.extraSelectionEnabled, false);
  result = await wrappers.performDaySelectionUpdate({
    userId: "not-canary",
    subscriptionId: "stacked",
  });
  assert.strictEqual(result.extraSelectionEnabled, false);
  assert.strictEqual(calls.length, 3);
}

async function testPinnedBucketAuthorityAndCanonicalAddonIdentity() {
  const userId = oid();
  const containerSubscriptionId = oid();
  const premiumBucketId = oid();
  const addonBucketId = oid();
  const addonProductId = oid();
  const addonPlanId = oid();
  const buckets = [
    {
      _id: premiumBucketId,
      kind: "premium",
      premiumKey: "shrimp",
      configId: oid(),
      revision: 7,
      remainingQty: 2,
      unitPriceHalala: 250,
      currency: "SAR",
    },
    {
      _id: addonBucketId,
      kind: "addon",
      addonId: addonProductId,
      addonPlanId,
      balanceBucketId: oid(),
      entitlementKey: `salad:${addonPlanId}`,
      category: "salad",
      allowanceCategory: "salad",
      purchasedQty: 3,
      remainingQty: 3,
      purchasedDailyQty: 1,
      metadata: { menuProductIds: [addonProductId], name: "Pinned Salad" },
      currency: "SAR",
    },
  ];
  const authority = await resolveStackingExtraSelectionAuthority({
    userId,
    containerSubscriptionId,
    businessDate: "2026-08-12",
    draft: {
      processedSlots: [{
        slotIndex: 1,
        slotKey: "slot_1",
        selectionType: "premium_meal",
        isPremium: true,
        premiumKey: "shrimp",
      }],
      premiumUpgradeSelections: [{ baseSlotKey: "slot_1", premiumKey: "shrimp" }],
    },
    requestedOneTimeAddonIds: [{
      productId: addonProductId,
      addonPlanId,
      entitlementKey: `salad:${addonPlanId}`,
      category: "salad",
    }],
    buckets,
  });
  assert.strictEqual(authority.premiumSelections.length, 1);
  assert.strictEqual(authority.premiumSelections[0].premiumSource, "balance");
  assert.strictEqual(String(authority.premiumSelections[0].balanceBucketId), String(premiumBucketId));
  assert.strictEqual(authority.addonSelections.length, 1);
  assert.strictEqual(String(authority.addonSelections[0].addonPlanId), String(addonPlanId));
  assert.strictEqual(authority.addonSelections[0].entitlementKey, `salad:${addonPlanId}`);
  assert.strictEqual(authority.desiredSelections.length, 2);

  await assert.rejects(
    () => resolveStackingExtraSelectionAuthority({
      userId,
      containerSubscriptionId,
      businessDate: "2026-08-12",
      draft: { processedSlots: [], premiumUpgradeSelections: [] },
      requestedOneTimeAddonIds: [oid()],
      buckets,
    }),
    (err) => Boolean(err && err.code === "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT")
  );
}

function testFlutterContractHidesInternalLedgerState() {
  const subscriptionId = oid();
  const shaped = serializeSubscriptionDayForClient(
    { _id: subscriptionId, addonSubscriptions: [] },
    {
      _id: oid(),
      subscriptionId,
      date: "2026-08-12",
      status: "open",
      mealSlots: [],
      addonSelections: [],
      stackingExtraSelectionState: {
        version: "subscription_stacking.extra_selection.v1",
        entries: [{ reservationKeys: ["secret-internal-key"] }],
      },
    }
  );
  assert.strictEqual(String(shaped.subscriptionId), String(subscriptionId));
  assert.strictEqual(shaped.stackingExtraSelectionState, undefined);
  assert.strictEqual(JSON.stringify(shaped).includes("secret-internal-key"), false);
}

function testStackingReadProjectsExactExtraBalances() {
  const addonId = oid();
  const addonPlanId = oid();
  const response = applyExtraProjectionToCurrentOverviewResponse(
    { status: true, data: { subscriptionId: String(oid()), requiredMeals: 5 } },
    [{
      _id: oid(),
      kind: "premium",
      walletKey: "premium:shrimp",
      premiumKey: "shrimp",
      purchasedQty: 4,
      remainingQty: 2,
      reservedQty: 1,
      consumedQty: 1,
      forfeitedQty: 0,
      effectiveStartDate: new Date("2026-08-01T00:00:00Z"),
      validityEndDate: new Date("2026-08-31T23:59:59Z"),
      applicationState: "applied",
      currency: "SAR",
    }, {
      _id: oid(),
      kind: "addon",
      walletKey: `addon:${addonPlanId}`,
      addonId,
      addonPlanId,
      entitlementKey: `salad:${addonPlanId}`,
      category: "salad",
      purchasedQty: 3,
      remainingQty: 1,
      reservedQty: 1,
      consumedQty: 1,
      forfeitedQty: 0,
      effectiveStartDate: new Date("2026-08-01T00:00:00Z"),
      validityEndDate: new Date("2026-08-31T23:59:59Z"),
      applicationState: "applied",
      currency: "SAR",
    }],
    "2026-08-12"
  );
  assert.strictEqual(response.data.requiredMeals, 5);
  assert.strictEqual(response.data.premiumSummary[0].remainingQtyTotal, 2);
  assert.strictEqual(response.data.premiumSummary[0].reservedQtyTotal, 1);
  assert.strictEqual(response.data.addonBalanceSummary.salad.remainingUnits, 1);
  assert.strictEqual(response.data.addonBalanceSummary.salad.reservedUnits, 1);
  assert.strictEqual(
    String(response.data.addonSubscriptionAllowances[0].addonPlanId),
    String(addonPlanId)
  );
}

async function run() {
  testCanaryNeverAcceptsWildcard();
  await testRouterRequiresCanaryAndPersistedNonLegacyBatch();
  await testPinnedBucketAuthorityAndCanonicalAddonIdentity();
  testFlutterContractHidesInternalLedgerState();
  testStackingReadProjectsExactExtraBalances();
  console.log("subscription stacking extra selection P3 contract tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
