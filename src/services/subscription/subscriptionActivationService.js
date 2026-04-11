const { addDays } = require("date-fns");

const Plan = require("../../models/Plan");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { toKSADateString } = require("../../utils/date");
const { sumPremiumRemainingFromBalance } = require("../../utils/premiumWallet");
const { createLocalizedError } = require("../../utils/errorLocalization");
const {
  LEGACY_PREMIUM_WALLET_MODE,
  GENERIC_PREMIUM_WALLET_MODE,
  buildGenericPremiumBalanceRows,
  sumGenericPremiumRemaining,
} = require("../genericPremiumWalletService");
const {
  normalizeRecurringAddonEntitlements,
  buildRecurringAddonProjectionFromEntitlements,
} = require("../recurringAddonService");
const { PHASE1_CONTRACT_VERSION } = require("../../constants/phase1Contract");
const { isPhase1CanonicalDraftActivationEnabled } = require("../../utils/featureFlags");

const SYSTEM_CURRENCY = "SAR";

function isCanonicalCheckoutDraft(draft) {
  return Boolean(
    draft
      && draft.contractVersion === PHASE1_CONTRACT_VERSION
      && draft.contractMode === "canonical"
      && draft.contractCompleteness === "authoritative"
      && draft.contractHash
      && draft.contractSnapshot
      && typeof draft.contractSnapshot === "object"
  );
}

function toCanonicalPremiumBalanceRows(draft) {
  return (draft.premiumItems || []).map((item) => ({
    premiumMealId: item.premiumMealId,
    purchasedQty: Number(item.qty || 0),
    remainingQty: Number(item.qty || 0),
    unitExtraFeeHalala: Number(item.unitExtraFeeHalala || 0),
    currency: item.currency || SYSTEM_CURRENCY,
  }));
}

function toCanonicalAddonBalanceRows(draft) {
  return (draft.addonItems || []).map((item) => ({
    addonId: item.addonId,
    purchasedQty: Number(item.qty || 0),
    remainingQty: Number(item.qty || 0),
    unitPriceHalala: Number(item.unitPriceHalala || 0),
    currency: item.currency || SYSTEM_CURRENCY,
  }));
}

function toCanonicalGenericPremiumBalanceRows(draft) {
  return buildGenericPremiumBalanceRows({
    premiumCount: Number(draft && draft.premiumCount ? draft.premiumCount : 0),
    unitCreditPriceHalala: Number(draft && draft.premiumUnitPriceHalala ? draft.premiumUnitPriceHalala : 0),
    currency: SYSTEM_CURRENCY,
    source: "subscription_purchase",
  });
}

function buildCanonicalActivationPayload({
  userId,
  planId,
  contractVersion,
  contractMode,
  contractCompleteness,
  contractSource,
  contractHash,
  contractSnapshot,
  renewedFromSubscriptionId = null,
  legacyRuntimeData = {},
}) {
  if (
    contractVersion !== PHASE1_CONTRACT_VERSION
    || contractMode !== "canonical"
    || contractCompleteness !== "authoritative"
    || !contractHash
    || !contractSnapshot
    || typeof contractSnapshot !== "object"
  ) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.invalidContract",
      fallbackMessage: "Canonical contract is invalid for activation",
    });
  }

  const snapshot = contractSnapshot || {};
  const plan = snapshot.plan || {};
  const pricing = snapshot.pricing || {};
  const delivery = snapshot.delivery || {};
  const slot = delivery.slot || {};
  const start = snapshot.start && snapshot.start.resolvedStartDate
    ? new Date(snapshot.start.resolvedStartDate)
    : null;

  const daysCount = Number(plan.daysCount || 0);
  const mealsPerDay = Number(plan.mealsPerDay || 0);
  const totalMeals = Number(plan.totalMeals || (daysCount * mealsPerDay));

  if (
    !start
    || Number.isNaN(start.getTime())
    || !Number.isInteger(daysCount)
    || daysCount < 1
    || !Number.isInteger(mealsPerDay)
    || mealsPerDay < 1
    || !Number.isInteger(totalMeals)
    || totalMeals < 1
  ) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.invalidContractPayload",
      fallbackMessage: "Canonical contract payload is invalid for activation",
    });
  }

  const premiumWalletMode = legacyRuntimeData.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
    ? GENERIC_PREMIUM_WALLET_MODE
    : LEGACY_PREMIUM_WALLET_MODE;
  const premiumBalanceRows = premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
    ? []
    : (Array.isArray(legacyRuntimeData.premiumBalance) ? legacyRuntimeData.premiumBalance : []);
  const genericPremiumBalanceRows = premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
    ? (Array.isArray(legacyRuntimeData.genericPremiumBalance) ? legacyRuntimeData.genericPremiumBalance : [])
    : [];
  const addonBalanceRows = Array.isArray(legacyRuntimeData.addonBalance) ? legacyRuntimeData.addonBalance : [];
  const addonSubscriptions = normalizeRecurringAddonEntitlements(legacyRuntimeData.addonSubscriptions || []);
  const recurringAddons = buildRecurringAddonProjectionFromEntitlements(addonSubscriptions);
  const premiumRemaining = premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
    ? sumGenericPremiumRemaining(genericPremiumBalanceRows)
    : sumPremiumRemainingFromBalance(premiumBalanceRows);
  const end = addDays(start, daysCount - 1);

  const subscriptionPayload = {
    userId,
    planId: planId || plan.planId,
    status: "active",
    startDate: start,
    endDate: end,
    validityEndDate: end,
    totalMeals,
    remainingMeals: totalMeals,
    premiumRemaining,
    premiumPrice:
      premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
        ? Number(legacyRuntimeData.premiumPrice || 0)
        : 0,
    selectedGrams: Number(plan.selectedGrams || 0),
    selectedMealsPerDay: mealsPerDay,
    basePlanPriceHalala: Number(pricing.basePlanPriceHalala || 0),
    checkoutCurrency: pricing.currency ? String(pricing.currency) : SYSTEM_CURRENCY,
    premiumBalance: premiumBalanceRows,
    premiumWalletMode,
    genericPremiumBalance: genericPremiumBalanceRows,
    addonBalance: addonBalanceRows,
    addonSubscriptions,
    deliveryMode: delivery.mode === "pickup" ? "pickup" : "delivery",
    deliveryAddress:
      Object.prototype.hasOwnProperty.call(delivery, "address")
        ? delivery.address || undefined
        : undefined,
    deliveryWindow: slot.window ? String(slot.window) : undefined,
    deliverySlot: {
      type: slot.type === "pickup" ? "pickup" : (delivery.mode === "pickup" ? "pickup" : "delivery"),
      window: String(slot.window || ""),
      slotId: String(slot.slotId || ""),
    },
    deliveryZoneId: delivery.zoneId || null,
    deliveryZoneName: delivery.zoneName || "",
    pickupLocationId: delivery.pickupLocationId ? String(delivery.pickupLocationId) : "",
    deliveryFeeHalala: Number(pricing.deliveryFeeHalala || 0),
    contractVersion,
    contractMode,
    contractCompleteness,
    contractSource,
    contractHash,
    contractSnapshot,
    renewedFromSubscriptionId: renewedFromSubscriptionId || null,
  };

  const dayEntries = Array.from({ length: daysCount }, (_, index) => ({
    date: toKSADateString(addDays(start, index)),
    status: "open",
    recurringAddons,
  }));

  return {
    subscriptionPayload,
    dayEntries,
  };
}

function buildCanonicalSubscriptionActivationPayload({ draft }) {
  if (!isCanonicalCheckoutDraft(draft)) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.draftMissingCanonicalContract",
      fallbackMessage: "Draft does not contain an authoritative canonical contract",
    });
  }

  return buildCanonicalActivationPayload({
    userId: draft.userId,
    planId: draft.planId,
    contractVersion: draft.contractVersion,
    contractMode: draft.contractMode,
    contractCompleteness: draft.contractCompleteness,
    contractSource: draft.contractSource,
    contractHash: draft.contractHash,
    contractSnapshot: draft.contractSnapshot,
    renewedFromSubscriptionId: draft.renewedFromSubscriptionId || null,
    legacyRuntimeData: {
      premiumWalletMode:
        draft.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
          ? GENERIC_PREMIUM_WALLET_MODE
          : LEGACY_PREMIUM_WALLET_MODE,
      premiumBalance:
        draft.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
          ? []
          : toCanonicalPremiumBalanceRows(draft),
      genericPremiumBalance:
        draft.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
          ? toCanonicalGenericPremiumBalanceRows(draft)
          : [],
      premiumPrice:
        draft.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
          ? Number(draft.premiumUnitPriceHalala || 0) / 100
          : 0,
      addonBalance: toCanonicalAddonBalanceRows(draft),
      addonSubscriptions: Array.isArray(draft.addonSubscriptions) ? draft.addonSubscriptions : [],
    },
  });
}

function buildCanonicalContractActivationPayload({ userId, planId, contract, legacyRuntimeData = {} }) {
  if (!contract || typeof contract !== "object") {
    const err = new Error("contract is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const renewedFromSubscriptionId = contract.contractSnapshot
    && contract.contractSnapshot.origin
    && contract.contractSnapshot.origin.renewedFromSubscriptionId
    ? contract.contractSnapshot.origin.renewedFromSubscriptionId
    : null;

  return buildCanonicalActivationPayload({
    userId,
    planId,
    contractVersion: contract.contractVersion,
    contractMode: contract.contractMode,
    contractCompleteness: contract.contractCompleteness,
    contractSource: contract.contractSource,
    contractHash: contract.contractHash,
    contractSnapshot: contract.contractSnapshot,
    renewedFromSubscriptionId,
    legacyRuntimeData,
  });
}

function buildLegacyDraftActivationPayload({ draft }) {
  const daysCount = Number(draft.daysCount);
  const mealsPerDay = Number(draft.mealsPerDay);
  if (!Number.isInteger(daysCount) || daysCount < 1 || !Number.isInteger(mealsPerDay) || mealsPerDay < 1) {
    const err = new Error("Legacy draft dimensions are invalid");
    err.code = "INVALID_DRAFT_DIMENSIONS";
    throw err;
  }

  const start = draft.startDate ? new Date(draft.startDate) : new Date();
  if (Number.isNaN(start.getTime())) {
    const err = new Error("Legacy draft startDate is invalid");
    err.code = "INVALID_DRAFT_START_DATE";
    throw err;
  }
  const end = addDays(start, daysCount - 1);
  const totalMeals = daysCount * mealsPerDay;

  const premiumBalanceRows = toCanonicalPremiumBalanceRows(draft);
  const addonBalanceRows = toCanonicalAddonBalanceRows(draft);
  const premiumRemaining = sumPremiumRemainingFromBalance(premiumBalanceRows);

  const subscriptionPayload = {
    userId: draft.userId,
    planId: draft.planId,
    status: "active",
    startDate: start,
    endDate: end,
    validityEndDate: end,
    totalMeals,
    remainingMeals: totalMeals,
    premiumRemaining,
    selectedGrams: draft.grams,
    selectedMealsPerDay: mealsPerDay,
    basePlanPriceHalala:
      draft.breakdown && Number.isFinite(Number(draft.breakdown.basePlanPriceHalala))
        ? Number(draft.breakdown.basePlanPriceHalala)
        : 0,
    checkoutCurrency:
      draft.breakdown && draft.breakdown.currency
        ? String(draft.breakdown.currency)
        : SYSTEM_CURRENCY,
    premiumBalance: premiumBalanceRows,
    addonBalance: addonBalanceRows,
    addonSubscriptions: Array.isArray(draft.addonSubscriptions) ? draft.addonSubscriptions : [],
    deliveryMode: draft.delivery && draft.delivery.type ? draft.delivery.type : "delivery",
    deliveryAddress:
      draft.delivery && Object.prototype.hasOwnProperty.call(draft.delivery, "address")
        ? draft.delivery.address || undefined
        : undefined,
    deliveryWindow:
      draft.delivery && draft.delivery.slot && draft.delivery.slot.window
        ? draft.delivery.slot.window
        : undefined,
    deliverySlot:
      draft.delivery && draft.delivery.slot
        ? draft.delivery.slot
        : {
          type: draft.delivery && draft.delivery.type ? draft.delivery.type : "delivery",
          window: "",
          slotId: "",
        },
  };

  const dayEntries = Array.from({ length: daysCount }, (_, index) => ({
    date: toKSADateString(addDays(start, index)),
    status: "open",
  }));

  return {
    subscriptionPayload,
    dayEntries,
  };
}

function defaultPersistence() {
  return {
    async createSubscription(payload, { session } = {}) {
      const created = await Subscription.create([payload], { session });
      return created[0];
    },
    async countSubscriptionDays(subscriptionId, { session } = {}) {
      return SubscriptionDay.countDocuments({ subscriptionId }).session(session);
    },
    async insertSubscriptionDays(entries, { session } = {}) {
      return SubscriptionDay.insertMany(entries, { session });
    },
    async getPlan(planId, { session } = {}) {
      return Plan.findById(planId).session(session).lean();
    },
  };
}

async function persistActivatedSubscription({ subscriptionPayload, dayEntries, session, persistence = defaultPersistence() }) {
  const subscription = await persistence.createSubscription(subscriptionPayload, { session });
  const existingDays = await persistence.countSubscriptionDays(subscription._id, { session });
  if (!existingDays) {
    await persistence.insertSubscriptionDays(
      dayEntries.map((entry) => ({
        ...entry,
        subscriptionId: subscription._id,
      })),
      { session }
    );
  }
  return subscription;
}

async function activateSubscriptionFromCanonicalDraft({ draft, payment, session, persistence = defaultPersistence() }) {
  const { subscriptionPayload, dayEntries } = buildCanonicalSubscriptionActivationPayload({ draft });
  const subscription = await persistActivatedSubscription({ subscriptionPayload, dayEntries, session, persistence });

  draft.status = "completed";
  draft.completedAt = new Date();
  draft.paymentId = payment._id;
  draft.providerInvoiceId = payment.providerInvoiceId || draft.providerInvoiceId;
  draft.subscriptionId = subscription._id;
  draft.failureReason = "";
  draft.failedAt = undefined;
  await draft.save({ session });

  payment.subscriptionId = subscription._id;
  await payment.save({ session });

  return { applied: true, subscriptionId: String(subscription._id) };
}

async function activateSubscriptionFromCanonicalContract({
  userId,
  planId,
  contract,
  legacyRuntimeData = {},
  session,
  persistence = defaultPersistence(),
}) {
  const { subscriptionPayload, dayEntries } = buildCanonicalContractActivationPayload({
    userId,
    planId,
    contract,
    legacyRuntimeData,
  });
  return persistActivatedSubscription({ subscriptionPayload, dayEntries, session, persistence });
}

async function activateSubscriptionFromLegacyDraft({ draft, payment, session, persistence = defaultPersistence() }) {
  const { subscriptionPayload, dayEntries } = buildLegacyDraftActivationPayload({ draft });
  const subscription = await persistActivatedSubscription({ subscriptionPayload, dayEntries, session, persistence });

  draft.status = "completed";
  draft.completedAt = new Date();
  draft.paymentId = payment._id;
  draft.providerInvoiceId = payment.providerInvoiceId || draft.providerInvoiceId;
  draft.subscriptionId = subscription._id;
  draft.failureReason = "";
  draft.failedAt = undefined;
  await draft.save({ session });

  payment.subscriptionId = subscription._id;
  await payment.save({ session });

  return { applied: true, subscriptionId: String(subscription._id) };
}

async function activatePendingLegacySubscription({
  subscription,
  session,
  persistence = defaultPersistence(),
  planDoc = null,
}) {
  if (!subscription) {
    return { applied: false, reason: "subscription_not_found" };
  }
  if (subscription.status !== "pending_payment") {
    return { applied: false, reason: `subscription_not_pending:${subscription.status}` };
  }

  const plan = planDoc || await persistence.getPlan(subscription.planId, { session });
  const start = subscription.startDate ? new Date(subscription.startDate) : new Date();
  const end = plan ? addDays(start, plan.daysCount - 1) : subscription.endDate || start;
  subscription.status = "active";
  subscription.endDate = end;
  subscription.validityEndDate = end;
  await subscription.save({ session });

  const existingDays = await persistence.countSubscriptionDays(subscription._id, { session });
  if (!existingDays && plan) {
    const dayEntries = Array.from({ length: plan.daysCount }, (_, index) => ({
      subscriptionId: subscription._id,
      date: toKSADateString(addDays(start, index)),
      status: "open",
    }));
    if (dayEntries.length) {
      await persistence.insertSubscriptionDays(dayEntries, { session });
    }
  }

  return { applied: true, subscriptionId: String(subscription._id) };
}

const finalizeRuntime = {
  isCanonicalCheckoutDraft: (...args) => isCanonicalCheckoutDraft(...args),
  activateSubscriptionFromCanonicalDraft: (...args) => activateSubscriptionFromCanonicalDraft(...args),
  activateSubscriptionFromLegacyDraft: (...args) => activateSubscriptionFromLegacyDraft(...args),
};

async function finalizeSubscriptionDraftPaymentFlow({ draft, payment, session }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || finalizeRuntime;

  if (!draft) {
    return { applied: false, reason: "draft_not_found" };
  }
  if (String(draft.userId) !== String(payment.userId)) {
    return { applied: false, reason: "draft_user_mismatch" };
  }

  if (draft.subscriptionId) {
    const existingSub = await Subscription.findById(draft.subscriptionId).session(session);
    if (!existingSub) {
      return { applied: false, reason: "draft_subscription_missing" };
    }
    if (draft.status !== "completed") {
      draft.status = "completed";
      draft.completedAt = draft.completedAt || new Date();
      draft.paymentId = payment._id;
      draft.providerInvoiceId = payment.providerInvoiceId || draft.providerInvoiceId;
      draft.failureReason = "";
      draft.failedAt = undefined;
      await draft.save({ session });
    }
    if (!payment.subscriptionId) {
      payment.subscriptionId = existingSub._id;
      await payment.save({ session });
    }
    return { applied: true, subscriptionId: String(existingSub._id) };
  }

  if (!["pending_payment", "failed", "canceled", "expired"].includes(draft.status)) {
    return { applied: false, reason: `draft_not_recoverable:${draft.status}` };
  }

  if (isPhase1CanonicalDraftActivationEnabled() && runtime.isCanonicalCheckoutDraft(draft)) {
    return runtime.activateSubscriptionFromCanonicalDraft({ draft, payment, session });
  }

  return runtime.activateSubscriptionFromLegacyDraft({ draft, payment, session });
}

module.exports = {
  isCanonicalCheckoutDraft,
  buildCanonicalSubscriptionActivationPayload,
  buildCanonicalContractActivationPayload,
  activateSubscriptionFromCanonicalDraft,
  activateSubscriptionFromCanonicalContract,
  activateSubscriptionFromLegacyDraft,
  activatePendingLegacySubscription,
  finalizeSubscriptionDraftPaymentFlow,
};
