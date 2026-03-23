const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  applyPaymentSideEffects,
  SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES,
} = require("../src/services/paymentApplicationService");

function objectId() {
  return new mongoose.Types.ObjectId();
}

test("shared dispatcher supports only approved Phase 1 payment types", () => {
  assert.equal(SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES.has("subscription_activation"), true);
  assert.equal(SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES.has("premium_topup"), true);
  assert.equal(SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES.has("premium_overage_day"), true);
  assert.equal(SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES.has("one_time_addon_day_planning"), true);
  assert.equal(SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES.has("addon_topup"), true);
  assert.equal(SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES.has("one_time_addon"), true);
  assert.equal(SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES.has("custom_salad_day"), true);
  assert.equal(SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES.has("custom_meal_day"), true);
  assert.equal(SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES.has("one_time_order"), false);
});

test("shared dispatcher routes subscription_activation draft payments through draft finalization", async () => {
  const draftId = objectId();
  let finalizeCalls = 0;

  const result = await applyPaymentSideEffects(
    {
      payment: {
        _id: objectId(),
        type: "subscription_activation",
        userId: objectId(),
        metadata: { draftId: String(draftId) },
      },
      session: { id: "session-1" },
      source: "client_manual_verify",
    },
    {
      async findDraftById(id) {
        assert.equal(String(id), String(draftId));
        return { _id: draftId, userId: objectId(), status: "pending_payment" };
      },
      async finalizeSubscriptionDraftPaymentFlow({ draft }) {
        finalizeCalls += 1;
        assert.equal(String(draft._id), String(draftId));
        return { applied: true, subscriptionId: "sub-1" };
      },
    }
  );

  assert.equal(finalizeCalls, 1);
  assert.deepEqual(result, { applied: true, subscriptionId: "sub-1" });
});

test("shared dispatcher routes legacy subscription_activation subscriptionId payments through pending-subscription activation", async () => {
  const subscriptionId = objectId();
  let activationCalls = 0;

  const result = await applyPaymentSideEffects(
    {
      payment: {
        _id: objectId(),
        type: "subscription_activation",
        metadata: { subscriptionId: String(subscriptionId) },
      },
      session: { id: "session-2" },
      source: "admin_verify",
    },
    {
      async findSubscriptionById(id) {
        assert.equal(String(id), String(subscriptionId));
        return { _id: subscriptionId, status: "pending_payment" };
      },
      async activatePendingLegacySubscription({ subscription }) {
        activationCalls += 1;
        assert.equal(String(subscription._id), String(subscriptionId));
        return { applied: true, subscriptionId: String(subscriptionId) };
      },
    }
  );

  assert.equal(activationCalls, 1);
  assert.equal(result.applied, true);
});

test("shared dispatcher applies premium_topup and writes webhook log only when source is webhook", async () => {
  const subscription = {
    _id: objectId(),
    premiumBalance: [],
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
  };
  const logCalls = [];

  const result = await applyPaymentSideEffects(
    {
      payment: {
        _id: objectId(),
        type: "premium_topup",
        amount: 1000,
        currency: "SAR",
        metadata: {
          subscriptionId: String(subscription._id),
          items: [{ premiumMealId: String(objectId()), qty: 2, unitExtraFeeHalala: 500, currency: "SAR" }],
        },
      },
      session: { id: "session-3" },
      source: "webhook",
    },
    {
      async findSubscriptionById() {
        return subscription;
      },
      async writeLog(payload) {
        logCalls.push(payload);
      },
    }
  );

  assert.equal(result.applied, true);
  assert.equal(subscription.premiumBalance.length, 1);
  assert.equal(subscription.saveCalls, 1);
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].action, "premium_topup_webhook");
});

test("shared dispatcher applies premium_topup to generic premium wallet subscriptions", async () => {
  const subscription = {
    _id: objectId(),
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [],
    premiumRemaining: 0,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
  };

  const result = await applyPaymentSideEffects(
    {
      payment: {
        _id: objectId(),
        type: "premium_topup",
        amount: 1500,
        currency: "SAR",
        metadata: {
          subscriptionId: String(subscription._id),
          premiumWalletMode: "generic_v1",
          premiumCount: 3,
          unitCreditPriceHalala: 500,
        },
      },
      session: { id: "session-3b" },
      source: "client_manual_verify",
    },
    {
      async findSubscriptionById() {
        return subscription;
      },
      async writeLog() {},
    }
  );

  assert.equal(result.applied, true);
  assert.equal(subscription.genericPremiumBalance.length, 1);
  assert.equal(subscription.premiumRemaining, 3);
  assert.equal(subscription.saveCalls, 1);
});

test("shared dispatcher applies one_time_addon to an open day", async () => {
  const dayId = objectId();

  const result = await applyPaymentSideEffects(
    {
      payment: {
        _id: objectId(),
        type: "one_time_addon",
        metadata: {
          subscriptionId: String(objectId()),
          addonId: String(objectId()),
          date: "2026-03-20",
        },
      },
      session: { id: "session-4" },
      source: "webhook",
    },
    {
      async findOpenDayAndAddAddon() {
        return { _id: dayId };
      },
      async writeLog() {},
    }
  );

  assert.equal(result.applied, true);
  assert.equal(result.dayId, String(dayId));
});

test("shared dispatcher applies premium_overage_day by marking the matching day paid without mutating wallet balances", async () => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalGenericFlag = process.env.PHASE2_GENERIC_PREMIUM_WALLET;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  process.env.PHASE2_GENERIC_PREMIUM_WALLET = "true";
  try {
  const subscriptionId = objectId();
  const dayId = objectId();
  const subscription = {
    _id: subscriptionId,
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [{ _id: objectId(), purchasedQty: 2, remainingQty: 0 }],
    premiumBalance: [{ premiumMealId: objectId(), purchasedQty: 1, remainingQty: 1 }],
    premiumRemaining: 0,
  };
  const day = {
    _id: dayId,
    subscriptionId,
    date: "2026-03-20",
    status: "open",
    premiumOverageCount: 2,
    premiumOverageStatus: "pending",
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
  };

  const beforeGenericWallet = JSON.stringify(subscription.genericPremiumBalance);
  const beforeLegacyWallet = JSON.stringify(subscription.premiumBalance);
  const beforePremiumRemaining = subscription.premiumRemaining;

  const result = await applyPaymentSideEffects(
    {
      payment: {
        _id: objectId(),
        type: "premium_overage_day",
        amount: 1000,
        currency: "SAR",
        metadata: {
          subscriptionId: String(subscriptionId),
          dayId: String(dayId),
          date: "2026-03-20",
          premiumOverageCount: 2,
          unitOveragePriceHalala: 500,
        },
      },
      session: { id: "session-overage-1" },
      source: "client_manual_verify",
    },
    {
      async findSubscriptionById() {
        return subscription;
      },
      async findDayById(id) {
        assert.equal(String(id), String(dayId));
        return day;
      },
      async writeLog() {},
    }
  );

  assert.deepEqual(result, { applied: true, dayId: String(dayId) });
  assert.equal(day.premiumOverageStatus, "paid");
  assert.equal(day.premiumOverageCount, 2);
  assert.equal(day.saveCalls, 1);
  assert.equal(JSON.stringify(subscription.genericPremiumBalance), beforeGenericWallet);
  assert.equal(JSON.stringify(subscription.premiumBalance), beforeLegacyWallet);
  assert.equal(subscription.premiumRemaining, beforePremiumRemaining);
  } finally {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    process.env.PHASE2_GENERIC_PREMIUM_WALLET = originalGenericFlag;
  }
});

test("shared dispatcher rejects premium_overage_day when the current day overage no longer matches the payment snapshot", async () => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalGenericFlag = process.env.PHASE2_GENERIC_PREMIUM_WALLET;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  process.env.PHASE2_GENERIC_PREMIUM_WALLET = "true";
  try {
  const subscriptionId = objectId();
  const dayId = objectId();
  const subscription = {
    _id: subscriptionId,
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    premiumWalletMode: "generic_v1",
  };
  const day = {
    _id: dayId,
    subscriptionId,
    date: "2026-03-20",
    status: "open",
    premiumOverageCount: 1,
    premiumOverageStatus: "pending",
    async save() {
      throw new Error("save should not be called on mismatch");
    },
  };

  const result = await applyPaymentSideEffects(
    {
      payment: {
        _id: objectId(),
        type: "premium_overage_day",
        amount: 1000,
        currency: "SAR",
        metadata: {
          subscriptionId: String(subscriptionId),
          dayId: String(dayId),
          date: "2026-03-20",
          premiumOverageCount: 2,
          unitOveragePriceHalala: 500,
        },
      },
      session: { id: "session-overage-2" },
      source: "webhook",
    },
    {
      async findSubscriptionById() {
        return subscription;
      },
      async findDayById() {
        return day;
      },
      async writeLog() {
        throw new Error("writeLog should not be called on mismatch");
      },
    }
  );

  assert.deepEqual(result, { applied: false, reason: "overage_mismatch" });
  assert.equal(day.premiumOverageStatus, "pending");
  assert.equal(day.premiumOverageCount, 1);
  } finally {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    process.env.PHASE2_GENERIC_PREMIUM_WALLET = originalGenericFlag;
  }
});

test("shared dispatcher applies one_time_addon_day_planning by marking the matching day paid without mutating wallets or recurring add-ons", async () => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  try {
    const subscriptionId = objectId();
    const dayId = objectId();
    const subscription = {
      _id: subscriptionId,
      contractVersion: "subscription_contract.v1",
      contractMode: "canonical",
      contractSnapshot: { meta: { version: "subscription_contract.v1" } },
      addonBalance: [{ addonId: objectId(), purchasedQty: 1, remainingQty: 1 }],
      addonSubscriptions: [{ addonId: objectId(), category: "drink", entitlementMode: "daily_recurring", maxPerDay: 1 }],
      recurringAddons: [{ addonId: objectId(), category: "drink" }],
      premiumWalletMode: "generic_v1",
      genericPremiumBalance: [{ _id: objectId(), purchasedQty: 2, remainingQty: 2 }],
      premiumRemaining: 2,
    };
    const day = {
      _id: dayId,
      subscriptionId,
      date: "2026-03-20",
      status: "open",
      oneTimeAddonSelections: [
        { addonId: String(objectId()), name: "Soup", category: "starter" },
        { addonId: String(objectId()), name: "Dessert", category: "dessert" },
      ],
      oneTimeAddonPendingCount: 2,
      oneTimeAddonPaymentStatus: "pending",
      addonsOneTime: [objectId()],
      saveCalls: 0,
      async save() {
        this.saveCalls += 1;
        return this;
      },
    };

    const beforeAddonBalance = JSON.stringify(subscription.addonBalance);
    const beforeRecurring = JSON.stringify(subscription.addonSubscriptions);
    const beforePremiumWallet = JSON.stringify(subscription.genericPremiumBalance);
    const beforePremiumRemaining = subscription.premiumRemaining;
    const beforeLegacyOneTime = JSON.stringify(day.addonsOneTime);

    const result = await applyPaymentSideEffects(
      {
        payment: {
          _id: objectId(),
          type: "one_time_addon_day_planning",
          amount: 600,
          currency: "SAR",
          metadata: {
            subscriptionId: String(subscriptionId),
            dayId: String(dayId),
            date: "2026-03-20",
            oneTimeAddonSelections: day.oneTimeAddonSelections,
            oneTimeAddonCount: 2,
            pricedItems: [
              { addonId: day.oneTimeAddonSelections[0].addonId, unitPriceHalala: 250, currency: "SAR" },
              { addonId: day.oneTimeAddonSelections[1].addonId, unitPriceHalala: 350, currency: "SAR" },
            ],
          },
        },
        session: { id: "session-addon-day-1" },
        source: "client_manual_verify",
      },
      {
        async findSubscriptionById() {
          return subscription;
        },
        async findDayById() {
          return day;
        },
      }
    );

    assert.equal(result.applied, true);
    assert.equal(result.dayId, String(dayId));
    assert.equal(day.oneTimeAddonPaymentStatus, "paid");
    assert.equal(day.oneTimeAddonPendingCount, 2);
    assert.deepEqual(day.oneTimeAddonSelections, [
      { addonId: day.oneTimeAddonSelections[0].addonId, name: "Soup", category: "starter" },
      { addonId: day.oneTimeAddonSelections[1].addonId, name: "Dessert", category: "dessert" },
    ]);
    assert.equal(day.saveCalls, 1);
    assert.equal(JSON.stringify(subscription.addonBalance), beforeAddonBalance);
    assert.equal(JSON.stringify(subscription.addonSubscriptions), beforeRecurring);
    assert.equal(JSON.stringify(subscription.genericPremiumBalance), beforePremiumWallet);
    assert.equal(subscription.premiumRemaining, beforePremiumRemaining);
    assert.equal(JSON.stringify(day.addonsOneTime), beforeLegacyOneTime);
  } finally {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
  }
});

test("shared dispatcher keeps one_time_order unsupported in Slice C", async () => {
  const result = await applyPaymentSideEffects({
    payment: {
      _id: objectId(),
      type: "one_time_order",
      metadata: { orderId: String(objectId()) },
    },
    session: { id: "session-5" },
    source: "webhook",
  });

  assert.deepEqual(result, { applied: false, reason: "unsupported_payment_type" });
});
