"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  assertStackingCheckoutSupported,
  buildUnsupportedExtrasDetails,
  createStackingCheckoutPreflightWrapper,
} = require("../src/services/subscription/subscriptionStackingCheckoutPreflightService");

function baseQuote(overrides = {}) {
  return {
    plan: { _id: "plan-1", daysCount: 26 },
    mealsPerDay: 2,
    grams: 150,
    premiumItems: [],
    premiumCount: 0,
    addonSubscriptions: [],
    addonItems: [],
    breakdown: {
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      totalHalala: 52000,
    },
    ...overrides,
  };
}

function activeContainer() {
  return {
    _id: "64f000000000000000000001",
    userId: "user-1",
    status: "active",
  };
}

async function testDisabledPreflightIsExactNoOp() {
  let quoteCalls = 0;
  let draftCalls = 0;
  let containerCalls = 0;
  let receivedRuntime = null;
  const callRuntime = { marker: true };
  const wrapper = createStackingCheckoutPreflightWrapper(
    async (_userId, _key, _body, _lang, runtime) => {
      receivedRuntime = runtime;
      return { ok: true, source: "legacy" };
    },
    {
      globallyEnabled: () => false,
      writeEnabledForUser: () => true,
      resolveQuote: async () => { quoteCalls += 1; return baseQuote(); },
      findExistingDraft: async () => { draftCalls += 1; return null; },
      findActiveContainer: async () => { containerCalls += 1; return activeContainer(); },
    }
  );

  const result = await wrapper("user-1", "key-1", {}, "ar", callRuntime);
  assert.strictEqual(result.source, "legacy");
  assert.strictEqual(receivedRuntime, callRuntime);
  assert.strictEqual(quoteCalls, 0);
  assert.strictEqual(draftCalls, 0);
  assert.strictEqual(containerCalls, 0);
}

async function testNonAllowlistedUserIsExactNoOp() {
  let quoteCalls = 0;
  const wrapper = createStackingCheckoutPreflightWrapper(
    async () => ({ ok: true, source: "legacy" }),
    {
      globallyEnabled: () => true,
      writeEnabledForUser: () => false,
      resolveQuote: async () => { quoteCalls += 1; return baseQuote(); },
    }
  );
  const result = await wrapper("other-user", "key-1", {}, "ar");
  assert.strictEqual(result.source, "legacy");
  assert.strictEqual(quoteCalls, 0);
}

async function testFirstSubscriptionMayUseStandardPremiumFlow() {
  let quoteCalls = 0;
  let originalCalls = 0;
  const premiumQuote = baseQuote({
    premiumItems: [{ premiumKey: "shrimp", qty: 2 }],
    premiumCount: 2,
    breakdown: {
      premiumTotalHalala: 10000,
      addonsTotalHalala: 0,
      totalHalala: 62000,
    },
  });
  const wrapper = createStackingCheckoutPreflightWrapper(
    async (_userId, _key, _body, _lang, runtime) => {
      originalCalls += 1;
      const resolved = await runtime.resolveCheckoutQuoteOrThrow();
      assert.strictEqual(resolved, premiumQuote);
      assert.strictEqual(
        runtime.stackingFinalizationIntent.mode,
        "standard_initial"
      );
      assert.strictEqual(
        runtime.stackingFinalizationIntent.expectedParentSubscriptionId,
        null
      );
      return { ok: true, source: "standard-first-subscription" };
    },
    {
      globallyEnabled: () => true,
      writeEnabledForUser: () => true,
      resolveQuote: async () => { quoteCalls += 1; return premiumQuote; },
      findExistingDraft: async () => null,
      findActiveContainer: async () => null,
    }
  );

  const result = await wrapper("user-1", "key-1", {}, "ar");
  assert.strictEqual(result.source, "standard-first-subscription");
  assert.strictEqual(quoteCalls, 1);
  assert.strictEqual(originalCalls, 1);
}

async function testBaseOnlyAdditiveCheckoutUsesSameResolvedQuote() {
  const quote = baseQuote();
  let resolverCalls = 0;
  let originalCalls = 0;
  const callerRuntime = {
    customField: "preserved",
    resolveCheckoutQuoteOrThrow: async () => {
      resolverCalls += 1;
      return quote;
    },
  };
  const wrapper = createStackingCheckoutPreflightWrapper(
    async (_userId, _key, _body, _lang, runtime) => {
      originalCalls += 1;
      assert.strictEqual(runtime.customField, "preserved");
      const first = await runtime.resolveCheckoutQuoteOrThrow();
      const second = await runtime.resolveCheckoutQuoteOrThrow();
      assert.strictEqual(first, quote);
      assert.strictEqual(second, quote);
      assert.strictEqual(
        runtime.stackingFinalizationIntent.mode,
        "additive_existing_parent"
      );
      assert.strictEqual(
        String(runtime.stackingFinalizationIntent.expectedParentSubscriptionId),
        "64f000000000000000000001"
      );
      return { ok: true, source: "stacking-base-only" };
    },
    {
      globallyEnabled: () => true,
      writeEnabledForUser: () => true,
      findExistingDraft: async () => null,
      findActiveContainer: async () => activeContainer(),
    }
  );

  const result = await wrapper("user-1", "key-1", {}, "ar", callerRuntime);
  assert.strictEqual(result.source, "stacking-base-only");
  assert.strictEqual(resolverCalls, 1);
  assert.strictEqual(originalCalls, 1);
}

async function testPremiumIsAllowedForFullExtraCanary() {
  let originalCalls = 0;
  const quote = baseQuote({
    premiumItems: [{ premiumKey: "salmon", qty: 1 }],
  });
  const wrapper = createStackingCheckoutPreflightWrapper(
    async (_userId, _key, _body, _lang, runtime) => {
      originalCalls += 1;
      assert.strictEqual(runtime.stackingFinalizationIntent.mode, "additive_existing_parent");
      return { ok: true };
    },
    {
      globallyEnabled: () => true,
      writeEnabledForUser: () => true,
      resolveQuote: async () => quote,
      findExistingDraft: async () => null,
      findActiveContainer: async () => activeContainer(),
      extraActivationEnabledForUser: () => true,
      extraSelectionEnabledForUser: () => true,
    }
  );

  const result = await wrapper("user-1", "premium-key", {}, "ar");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(originalCalls, 1);
}

async function testAddonIsAllowedForFullExtraCanary() {
  let originalCalls = 0;
  const quote = baseQuote({
    addonSubscriptions: [{ addonPlanId: "addon-1", quantityPerDay: 1 }],
  });
  const wrapper = createStackingCheckoutPreflightWrapper(
    async (_userId, _key, _body, _lang, runtime) => {
      originalCalls += 1;
      assert.strictEqual(runtime.stackingFinalizationIntent.mode, "additive_existing_parent");
      return { ok: true };
    },
    {
      globallyEnabled: () => true,
      writeEnabledForUser: () => true,
      resolveQuote: async () => quote,
      findExistingDraft: async () => null,
      findActiveContainer: async () => activeContainer(),
      extraActivationEnabledForUser: () => true,
      extraSelectionEnabledForUser: () => true,
    }
  );

  const result = await wrapper("user-1", "addon-key", {}, "ar");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(originalCalls, 1);
}

async function testExtrasRemainBlockedUnlessBothCanariesAreEligible() {
  let originalCalls = 0;
  const quote = baseQuote({
    premiumItems: [{ premiumKey: "salmon", qty: 1 }],
    addonSubscriptions: [{ addonPlanId: "addon-1", quantityPerDay: 1 }],
  });
  const wrapper = createStackingCheckoutPreflightWrapper(
    async () => { originalCalls += 1; return { ok: true }; },
    {
      globallyEnabled: () => true,
      writeEnabledForUser: () => true,
      resolveQuote: async () => quote,
      findExistingDraft: async () => null,
      findActiveContainer: async () => activeContainer(),
      extraActivationEnabledForUser: () => true,
      extraSelectionEnabledForUser: () => false,
    }
  );

  await assert.rejects(
    () => wrapper("user-1", "blocked-extra-key", {}, "ar"),
    (err) => Boolean(
      err
      && err.code === "STACKING_PURCHASE_EXTRAS_NOT_READY"
      && err.details.premiumNotSupported === true
      && err.details.addonsNotSupported === true
      && err.details.activationEligible === true
      && err.details.selectionEligible === false
      && err.details.blockedBeforeInvoice === true
    )
  );
  assert.strictEqual(originalCalls, 0);
}

async function testCompletedIdempotentDraftStillReadsNormally() {
  const quote = baseQuote({
    premiumItems: [{ premiumKey: "shrimp", qty: 1 }],
  });
  const result = await assertStackingCheckoutSupported({
    userId: "user-1",
    idempotencyKey: "completed-key",
    quote,
    runtime: {
      findExistingDraft: async () => ({
        _id: "draft-1",
        status: "completed",
        subscriptionId: "sub-1",
      }),
      findActiveContainer: async () => {
        throw new Error("active container lookup must not run for completed checkout");
      },
    },
  });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "completed_idempotent_checkout");
  assert.strictEqual(result.finalizationIntent, null);
}

function testUnsupportedExtraDetectionUsesCanonicalTotalsToo() {
  assert.deepStrictEqual(
    buildUnsupportedExtrasDetails(baseQuote()),
    { premium: false, addons: false }
  );
  assert.deepStrictEqual(
    buildUnsupportedExtrasDetails(baseQuote({
      breakdown: {
        premiumTotalHalala: 1,
        addonsTotalHalala: 2,
      },
    })),
    { premium: true, addons: true }
  );
}

async function run() {
  await testDisabledPreflightIsExactNoOp();
  await testNonAllowlistedUserIsExactNoOp();
  await testFirstSubscriptionMayUseStandardPremiumFlow();
  await testBaseOnlyAdditiveCheckoutUsesSameResolvedQuote();
  await testPremiumIsAllowedForFullExtraCanary();
  await testAddonIsAllowedForFullExtraCanary();
  await testExtrasRemainBlockedUnlessBothCanariesAreEligible();
  await testCompletedIdempotentDraftStillReadsNormally();
  testUnsupportedExtraDetectionUsesCanonicalTotalsToo();
  console.log("subscription stacking checkout preflight tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
