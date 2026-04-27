const { addDays } = require("date-fns");
const mongoose = require("mongoose");

const Plan = require("../../models/Plan");
const BuilderProtein = require("../../models/BuilderProtein");
const CheckoutDraft = require("../../models/CheckoutDraft");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { toKSADateString } = require("../../utils/date");
const { createLocalizedError } = require("../../utils/errorLocalization");
const {
  PHASE1_CONTRACT_VERSION,
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
} = require("../../constants/phase1Contract");
const { consumePromoCodeUsageReservation } = require("../promoCodeService");
const { logger } = require("../../utils/logger");
const { resolveCanonicalPremiumIdentity } = require("../../utils/subscription/premiumIdentity");

const SYSTEM_CURRENCY = "SAR";

// Removed isCanonicalCheckoutDraft as the system now assumes a single unified contract model.



async function toCanonicalPremiumBalanceRows(draft) {
  const rows = [];
  for (const item of (draft.premiumItems || [])) {
    let resolved;
    try {
      resolved = await resolveCanonicalPremiumIdentity({
        proteinId: item.proteinId,
        name: item.name,
        premiumKey: item.premiumKey,
      });
    } catch (err) {
      if (item.premiumKey && item.proteinId) {
        resolved = {
          premiumKey: item.premiumKey,
          canonicalProteinId: item.proteinId,
          name: item.name,
          unitExtraFeeHalala: item.unitExtraFeeHalala || 0,
        };
      } else {
        throw err;
      }
    }

    rows.push({
      proteinId: resolved.canonicalProteinId,
      premiumKey: resolved.premiumKey,
      name: resolved.name,
      purchasedQty: Number(item.qty || 0),
      remainingQty: Number(item.qty || 0),
      unitExtraFeeHalala: resolved.unitExtraFeeHalala,
      currency: item.currency || SYSTEM_CURRENCY,
      purchasedAt: new Date(),
    });
  }
  return rows;
}

function normalizeProteinIdForPremiumBalance(proteinId) {
  const s = String(proteinId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(s)) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.invalidPremiumEntitlement",
      fallbackMessage: "Invalid premium protein id in checkout contract",
    });
  }
  return new mongoose.Types.ObjectId(s);
}

function premiumBalanceRowSignature(row) {
  const pid = String(row && row.proteinId != null ? row.proteinId : "");
  const pq = Number(row && row.purchasedQty != null ? row.purchasedQty : 0);
  const rq = Number(row && row.remainingQty != null ? row.remainingQty : 0);
  const unit = Number(row && row.unitExtraFeeHalala != null ? row.unitExtraFeeHalala : 0);
  const cur = String(row && row.currency != null ? row.currency : SYSTEM_CURRENCY);
  return `${pid}|${pq}|${rq}|${unit}|${cur}`;
}

function premiumBalanceRowsAreEquivalent(a, b) {
  const aa = (a || []).map(premiumBalanceRowSignature).sort();
  const bb = (b || []).map(premiumBalanceRowSignature).sort();
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

async function toPremiumBalanceRowsFromContractEntitlements(contractSnapshot, lang = "en") {
  const snapshot = contractSnapshot && typeof contractSnapshot === "object" ? contractSnapshot : {};
  const ec = snapshot.entitlementContract && typeof snapshot.entitlementContract === "object"
    ? snapshot.entitlementContract
    : null;
  const items = ec && Array.isArray(ec.premiumItems) ? ec.premiumItems : [];

  const rows = [];
  for (const item of items) {
    const qty = Number(item && item.qty != null ? item.qty : 0);
    if (!Number.isInteger(qty) || qty < 1) {
      throw createLocalizedError({
        code: "INVALID_DRAFT_CONTRACT",
        key: "errors.activation.invalidPremiumEntitlement",
        fallbackMessage: "Invalid premium entitlement quantity in contract",
      });
    }

    let resolved;
    try {
      resolved = await resolveCanonicalPremiumIdentity({
        proteinId: item.proteinId,
        name: item.name,
        premiumKey: item.premiumKey,
      });
    } catch (err) {
      if (item.premiumKey && item.proteinId) {
        resolved = {
          premiumKey: item.premiumKey,
          canonicalProteinId: item.proteinId,
          name: item.name,
          unitExtraFeeHalala: item.unitExtraFeeHalala || 0,
        };
      } else {
        throw err;
      }
    }

    rows.push({
      proteinId: resolved.canonicalProteinId,
      premiumKey: resolved.premiumKey,
      name: resolved.name,
      purchasedQty: qty,
      remainingQty: qty,
      unitExtraFeeHalala: resolved.unitExtraFeeHalala,
      currency: String(item.currency || SYSTEM_CURRENCY),
      purchasedAt: new Date(),
    });
  }
  return rows;
}

function assertPremiumBalanceMatchesContractPricing(contractSnapshot, rows) {
  const snapshot = contractSnapshot && typeof contractSnapshot === "object" ? contractSnapshot : {};
  const snapshotPricing = snapshot.pricing && typeof snapshot.pricing === "object" ? snapshot.pricing : {};
  const contractedPremiumTotal = Number(snapshotPricing.premiumTotalHalala || 0);
  const impliedPremiumTotal = (rows || []).reduce(
    (sum, row) => sum + Number(row.purchasedQty || 0) * Number(row.unitExtraFeeHalala || 0),
    0
  );

  if ((rows || []).length > 0 && contractedPremiumTotal !== impliedPremiumTotal) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.invalidPremiumEntitlement",
      fallbackMessage: "Premium entitlement rows do not match contract premium total",
    });
  }

  if ((rows || []).length === 0 && contractedPremiumTotal > 0) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.invalidPremiumEntitlement",
      fallbackMessage: "Contract charges premium fees but premium entitlements are missing",
    });
  }

  if ((rows || []).length > 0 && contractedPremiumTotal === 0 && impliedPremiumTotal > 0) {
    throw createLocalizedError({
      code: "INVALID_DRAFT_CONTRACT",
      key: "errors.activation.invalidPremiumEntitlement",
      fallbackMessage: "Contract premium total is missing while premium entitlements exist",
    });
  }
}

async function resolveActivationPremiumBalanceRows(draft, contractSnapshot) {
  const fromDraft = await toCanonicalPremiumBalanceRows(draft);
  const fromContract = await toPremiumBalanceRowsFromContractEntitlements(contractSnapshot);

  const draftId = draft && draft._id ? String(draft._id) : "unknown";

  if (fromContract.length > 0) {
    logger.info("Activation: using premium balance from contract snapshot", {
      draftId,
      rowCount: fromContract.length,
    });
    if (fromDraft.length > 0 && !premiumBalanceRowsAreEquivalent(fromContract, fromDraft)) {
      logger.warn("Activation: draft premiumItems mismatch with contract entitlements; prioritizing contract", {
        draftId,
        fromContract: JSON.stringify(fromContract),
        fromDraft: JSON.stringify(fromDraft),
      });
    }
    if (contractSnapshot) {
      assertPremiumBalanceMatchesContractPricing(contractSnapshot, fromContract);
    }
    return fromContract;
  }

  if (fromDraft.length > 0) {
    logger.info("Activation: using premium balance from draft.premiumItems (contract empty/missing)", {
      draftId,
      rowCount: fromDraft.length,
    });
    if (contractSnapshot) {
      assertPremiumBalanceMatchesContractPricing(contractSnapshot, fromDraft);
    }
    return fromDraft;
  }

  logger.info("Activation: no premium balance rows found in contract or draft", { draftId });
  return [];
}

function buildCanonicalActivationPayload({ userId, planId, contractVersion, contractMode, contractCompleteness, contractSource, contractHash, contractSnapshot, renewedFromSubscriptionId = null, legacyRuntimeData = {} }) {
  // Validate that we have a contractHash; contractSnapshot may be missing for non-canonical drafts
  if (!contractHash) {
    throw createLocalizedError({ code: "INVALID_DRAFT_CONTRACT", key: "errors.activation.invalidContract", fallbackMessage: "Contract hash is required for activation" });
  }

  // Extract snapshot fields; use empty objects as fallback if contractSnapshot is missing
  const snapshot = (contractSnapshot && typeof contractSnapshot === "object") ? contractSnapshot : {};
  const plan = snapshot.plan || {};
  const pricing = snapshot.pricing || {};
  const delivery = snapshot.delivery || {};
  const slot = delivery.slot || {};
  
  // Robust start date selection.
  let start = snapshot.start && snapshot.start.resolvedStartDate ? new Date(snapshot.start.resolvedStartDate) : null;
  if (!start && legacyRuntimeData.startDate) {
    start = new Date(legacyRuntimeData.startDate);
  }

  // Robust field selection for non-canonical drafts.
  const daysCount = Number(plan.daysCount || legacyRuntimeData.daysCount || 0);
  const mealsPerDay = Number(plan.mealsPerDay || legacyRuntimeData.mealsPerDay || 0);
  const totalMeals = daysCount * mealsPerDay;

  if (!start || Number.isNaN(start.getTime()) || !Number.isInteger(daysCount) || daysCount < 1 || !Number.isInteger(mealsPerDay) || mealsPerDay < 1 || !Number.isInteger(totalMeals) || totalMeals < 1) {
    throw createLocalizedError({ code: "INVALID_DRAFT_CONTRACT", key: "errors.activation.invalidContractPayload", fallbackMessage: "Cannot activate subscription because of missing or invalid schedule/meal data" });
  }

  const premiumBalanceRows = Array.isArray(legacyRuntimeData.premiumBalance) ? legacyRuntimeData.premiumBalance : [];
  const addonSubscriptions = legacyRuntimeData.addonSubscriptions || [];
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
    selectedGrams: Number(plan.selectedGrams || 0),
    selectedMealsPerDay: mealsPerDay,
    basePlanPriceHalala: Number(pricing.basePlanPriceHalala || 0),
    discountHalala: Number(pricing.discountHalala || 0),
    subtotalHalala: Number(pricing.subtotalHalala || 0),
    vatPercentage: Number(pricing.vatPercentage || 0),
    vatHalala: Number(pricing.vatHalala || 0),
    totalPriceHalala: Number(pricing.totalHalala || 0),
    checkoutCurrency: pricing.currency ? String(pricing.currency) : SYSTEM_CURRENCY,
    appliedPromo:
      snapshot.promo && typeof snapshot.promo === "object"
        ? {
          promoCodeId: snapshot.promo.promoCodeId || null,
          usageId: null,
          code: String(snapshot.promo.code || ""),
          title: String(snapshot.promo.title || ""),
          description: String(snapshot.promo.description || ""),
          discountType: String(snapshot.promo.discountType || ""),
          discountValue: Number(snapshot.promo.discountValue || 0),
          discountAmountHalala: Number(snapshot.promo.discountAmountHalala || 0),
          message: String(snapshot.promo.message || ""),
        }
        : null,
    premiumBalance: premiumBalanceRows,
    addonSubscriptions,
    deliveryMode: delivery.mode === "pickup" ? "pickup" : "delivery",
    deliveryAddress: Object.prototype.hasOwnProperty.call(delivery, "address") ? delivery.address || undefined : undefined,
    deliveryWindow: slot.window ? String(slot.window) : undefined,
    deliverySlot: { type: slot.type === "pickup" ? "pickup" : (delivery.mode === "pickup" ? "pickup" : "delivery"), window: String(slot.window || ""), slotId: String(slot.slotId || "") },
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

  logger.info("Activation: built canonical subscription payload", {
    userId: String(userId),
    planId: String(subscriptionPayload.planId),
    premiumBalanceCount: Array.isArray(subscriptionPayload.premiumBalance) ? subscriptionPayload.premiumBalance.length : 0,
    premiumBalancePreview: JSON.stringify(subscriptionPayload.premiumBalance),
  });

  const dayEntries = Array.from({ length: daysCount }, (_, index) => ({
    date: toKSADateString(addDays(start, index)),
    status: "open",
  }));
  return { subscriptionPayload, dayEntries };
}

async function buildCanonicalSubscriptionActivationPayload({ draft }) {
  const snapshot = (draft.contractSnapshot && typeof draft.contractSnapshot === "object") ? draft.contractSnapshot : {};
  const snapshotContract = snapshot.contract && typeof snapshot.contract === "object" ? snapshot.contract : {};

  const premiumBalanceRows = await resolveActivationPremiumBalanceRows(draft, draft.contractSnapshot);

  return buildCanonicalActivationPayload({
    userId: draft.userId,
    planId: draft.planId,
    contractVersion: draft.contractVersion || snapshotContract.contractVersion || PHASE1_CONTRACT_VERSION,
    contractMode: draft.contractMode || snapshotContract.contractMode || CONTRACT_MODES[0],
    contractCompleteness: draft.contractCompleteness || snapshotContract.contractCompleteness || CONTRACT_COMPLETENESS_VALUES[0],
    contractSource: draft.contractSource || snapshotContract.contractSource || CONTRACT_SOURCES[0],
    contractHash: draft.contractHash || "legacy-transition",
    contractSnapshot: draft.contractSnapshot || null,
    renewedFromSubscriptionId: draft.renewedFromSubscriptionId || null,
    legacyRuntimeData: {
      premiumBalance: premiumBalanceRows,
      addonSubscriptions: Array.isArray(draft.addonSubscriptions) ? draft.addonSubscriptions : [],
      startDate: draft.startDate,
      daysCount: draft.daysCount,
      mealsPerDay: draft.mealsPerDay,
    },
  });
}

function buildCanonicalContractActivationPayload({ userId, planId, contract, legacyRuntimeData = {} }) {
  if (!contract || typeof contract !== "object") {
    const err = new Error("contract is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const renewedFromSubscriptionId = contract.contractSnapshot && contract.contractSnapshot.origin && contract.contractSnapshot.origin.renewedFromSubscriptionId ? contract.contractSnapshot.origin.renewedFromSubscriptionId : null;
  return buildCanonicalActivationPayload({ userId, planId, contractVersion: contract.contractVersion, contractMode: contract.contractMode, contractCompleteness: contract.contractCompleteness, contractSource: contract.contractSource, contractHash: contract.contractHash, contractSnapshot: contract.contractSnapshot, renewedFromSubscriptionId, legacyRuntimeData });
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
    await persistence.insertSubscriptionDays(dayEntries.map((entry) => ({ ...entry, subscriptionId: subscription._id })), { session });
  }
  return subscription;
}

async function activateSubscriptionFromCanonicalDraft({ draft, payment, session, persistence = defaultPersistence() }) {
  const draftId = draft && draft._id ? draft._id : null;
  if (!draftId) {
    const err = new Error("draft is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const draftDoc = session
    ? await CheckoutDraft.findById(draftId).session(session)
    : await CheckoutDraft.findById(draftId);
  if (!draftDoc) {
    const err = new Error("Checkout draft not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const { subscriptionPayload, dayEntries } = await buildCanonicalSubscriptionActivationPayload({ draft: draftDoc });
  const subscription = await persistActivatedSubscription({ subscriptionPayload, dayEntries, session, persistence });

  draftDoc.status = "completed";
  draftDoc.completedAt = new Date();
  draftDoc.paymentId = payment._id;
  draftDoc.providerInvoiceId = payment.providerInvoiceId || draftDoc.providerInvoiceId;
  draftDoc.subscriptionId = subscription._id;
  draftDoc.failureReason = "";
  draftDoc.failedAt = undefined;
  await draftDoc.save({ session });

  const promoUsage = await consumePromoCodeUsageReservation({
    checkoutDraftId: draftDoc._id,
    subscriptionId: subscription._id,
    paymentId: payment && payment._id ? payment._id : null,
    session,
  });
  if (promoUsage && subscription.appliedPromo) {
    subscription.appliedPromo.usageId = promoUsage._id;
    await subscription.save({ session });
  }

  payment.subscriptionId = subscription._id;
  await payment.save({ session });
  return { applied: true, subscriptionId: String(subscription._id) };
}

async function activateSubscriptionFromCanonicalContract({ userId, planId, contract, legacyRuntimeData = {}, session, persistence = defaultPersistence() }) {
  const { subscriptionPayload, dayEntries } = buildCanonicalContractActivationPayload({ userId, planId, contract, legacyRuntimeData });
  return persistActivatedSubscription({ subscriptionPayload, dayEntries, session, persistence });
}

// Removed activatePendingLegacySubscription as the system now uses unified draft-to-subscription activation.


const finalizeRuntime = {
  activateSubscriptionFromCanonicalDraft: (...args) => activateSubscriptionFromCanonicalDraft(...args),
};


async function finalizeSubscriptionDraftPaymentFlow({ draft, payment, session }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || finalizeRuntime;
  if (!draft) return { applied: false, reason: "draft_not_found" };
  if (String(draft.userId) !== String(payment.userId)) return { applied: false, reason: "draft_user_mismatch" };

  if (draft.subscriptionId) {
    const existingSub = await Subscription.findById(draft.subscriptionId).session(session);
    if (!existingSub) return { applied: false, reason: "draft_subscription_missing" };
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

  if (!["pending_payment", "failed", "canceled", "expired"].includes(draft.status)) return { applied: false, reason: `draft_not_recoverable:${draft.status}` };
  
  // Directly activate as there is no longer a separate "legacy" path.
  return runtime.activateSubscriptionFromCanonicalDraft({ draft, payment, session });
}

module.exports = {
  buildCanonicalSubscriptionActivationPayload,
  buildCanonicalContractActivationPayload,
  activateSubscriptionFromCanonicalDraft,
  activateSubscriptionFromCanonicalContract,
  finalizeSubscriptionDraftPaymentFlow,
};
