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
      err && err.code === "SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMATION_REQUIRED"
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

  // A pre-stacking/legacy subscription must remain on the legacy selector even
  // when the user is included in a global or canary rollout. It has no applied
  // non-legacy purchase batch, so entering the stacking planner would produce
  // STACKING_NO_ENTITLEMENT_FOR_DATE.
  result = await wrappers.performDaySelectionUpdate({
    userId: "canary",
    subscriptionId: "legacy-only",
  });
  assert.strictEqual(result.source, "legacy:update");

  result = await wrappers.performDaySelectionUpdate({
    userId: "not-canary",
    subscriptionId: "stacked",
  });
  assert.strictEqual(result.extraSelectionEnabled, false);
  assert.strictEqual(calls.length, 2);
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
      status: "active",
    },
    {
      _id: addonBucketId,
      kind: "addon",
      addonProductId,
      addonPlanId,
      addonDisplayKey: "dessert",
      remainingQty: 2,
      unitPriceHalala: 300,
      status: "active",
    },
  ];
  const draft = {
    processedSlots: [
      {
        slotKey: "slot_1",
        isPremium: true,
        premiumKey: "shrimp",
      },
    ],
  };
  const runtime = {
    findBuckets: async () => buckets,
    findAddonPlans: async () => [{
      _id: addonPlanId,
      productId: addonProductId,
      displayKey: "dessert",
      isActive: true,
    }],
  };
  const result = await resolveStackingExtraSelectionAuthority({
    userId,
    containerSubscriptionId,
    businessDate: "2026-08-24",
    draft,
    requestedOneTimeAddonIds: [String(addonPlanId)],
    runtime,
  });
  assert.strictEqual(result.premiumSelections.length, 1);
  assert.strictEqual(result.premiumSelections[0].premiumKey, "shrimp");
  assert.strictEqual(String(result.premiumSelections[0].balanceBucketId), String(premiumBucketId));
  assert.strictEqual(result.addonSelections.length, 1);
  assert.strictEqual(String(result.addonSelections[0].addonPlanId), String(addonPlanId));
  assert.strictEqual(String(result.addonSelections[0].productId), String(addonProductId));
  assert.strictEqual(result.desiredSelections.length, 2);
}

function testSerializerKeepsExtraReservationIdentity() {
  const addonPlanId = oid();
  const productId = oid();
  const day = {
    _id: oid(),
    date: "2026-08-24",
    status: "open",
    addonSelections: [
      {
        addonPlanId,
        productId,
        quantity: 1,
        displayKey: "dessert",
      },
    ],
    premiumUpgradeSelections: [
      {
        baseSlotKey: "slot_1",
        premiumKey: "shrimp",
        quantity: 1,
      },
    ],
    stackingExtraSelectionState: {
      lifecycleStatus: "reserved",
      entries: [
        {
          kind: "addon",
          identityKey: `addon:${String(productId)}`,
          quantity: 1,
          reservationKeys: ["res-1"],
        },
      ],
    },
  };
  const shaped = serializeSubscriptionDayForClient(day, { lang: "en" });
  assert.strictEqual(shaped.addonSelections.length, 1);
  assert.strictEqual(String(shaped.addonSelections[0].addonPlanId), String(addonPlanId));
  assert.strictEqual(String(shaped.addonSelections[0].productId), String(productId));
  assert.strictEqual(shaped.premiumUpgradeSelections.length, 1);
  assert.strictEqual(shaped.stackingExtraSelectionState.lifecycleStatus, "reserved");
  assert.strictEqual(shaped.stackingExtraSelectionState.entries[0].reservationKeys[0], "res-1");
}

function testReadProjectionPreservesLegacyPremiumAndAddonShape() {
  const response = {
    ok: true,
    data: {
      subscription: {
        _id: oid(),
        premiumBalance: { shrimp: 1 },
        addonBalances: [{ displayKey: "dessert", remainingQty: 1 }],
      },
    },
  };
  const result = applyExtraProjectionToCurrentOverviewResponse(response, {
    premiumBalance: { shrimp: 2 },
    addonBalances: [{ displayKey: "dessert", remainingQty: 3 }],
  });
  assert.strictEqual(result.data.subscription.premiumBalance.shrimp, 2);
  assert.strictEqual(result.data.subscription.addonBalances[0].remainingQty, 3);
}

async function testAuthorityRejectsUnownedAddon() {
  const userId = oid();
  const containerSubscriptionId = oid();
  const addonPlanId = oid();
  await assert.rejects(
    () => resolveStackingExtraSelectionAuthority({
      userId,
      containerSubscriptionId,
      businessDate: "2026-08-24",
      draft: { processedSlots: [] },
      requestedOneTimeAddonIds: [String(addonPlanId)],
      runtime: {
        findBuckets: async () => [],
        findAddonPlans: async () => [{
          _id: addonPlanId,
          productId: oid(),
          displayKey: "dessert",
          isActive: true,
        }],
      },
    }),
    (err) => Boolean(err && err.code === "STACKING_ADDON_ENTITLEMENT_UNAVAILABLE")
  );
}

async function run() {
  testCanaryNeverAcceptsWildcard();
  await testRouterRequiresCanaryAndPersistedNonLegacyBatch();
  await testPinnedBucketAuthorityAndCanonicalAddonIdentity();
  testSerializerKeepsExtraReservationIdentity();
  testReadProjectionPreservesLegacyPremiumAndAddonShape();
  await testAuthorityRejectsUnownedAddon();
  console.log("subscription stacking extra selection P3 contracts passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
