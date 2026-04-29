const crypto = require("crypto");

const SYSTEM_CURRENCY = "SAR";
const FULFILLABLE_DAY_STATUSES = new Set(["open"]);
const PREMIUM_EXTRA_PAYMENT_STATUSES = new Set([
  "none",
  "pending",
  "paid",
  "failed",
  "expired",
  "revision_mismatch",
]);

function normalizeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeString(value, fallback = "") {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  return normalized || fallback;
}

function buildPlannerRevisionHash({ day, mealSlots }) {
  const normalized = (Array.isArray(mealSlots) ? mealSlots : [])
    .map((slot) => {
      // Sort carbs by ID for consistent hashing
      const normalizedCarbs = (Array.isArray(slot.carbs) ? slot.carbs : [])
        .map(c => ({ carbId: String(c.carbId), grams: normalizeNumber(c.grams) }))
        .sort((a, b) => a.carbId.localeCompare(b.carbId));

      return {
        slotIndex: normalizeNumber(slot && slot.slotIndex),
        slotKey: normalizeString(slot && slot.slotKey),
        status: normalizeString(slot && slot.status, "empty"),
        selectionType: normalizeString(slot && slot.selectionType),
        proteinId: slot && slot.proteinId ? String(slot.proteinId) : null,
        sandwichId: slot && slot.sandwichId ? String(slot.sandwichId) : null,
        carbs: normalizedCarbs,
        salad: slot && slot.salad ? slot.salad : null,
        isPremium: Boolean(slot && slot.isPremium),
        premiumSource: normalizeString(slot && slot.premiumSource, "none"),
        premiumExtraFeeHalala: normalizeNumber(slot && slot.premiumExtraFeeHalala),
      };
    })
    .sort((a, b) => (a.slotIndex - b.slotIndex) || a.slotKey.localeCompare(b.slotKey));

  const addonSelectionPart = (Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
    .map((s) => ({
      addonId: String(s.addonId),
      source: s.source,
      priceHalala: normalizeNumber(s.priceHalala),
    }));

  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ slots: normalized, addons: addonSelectionPart }))
    .digest("hex");
}

function buildAddonSummary({ addonSelections, currency = SYSTEM_CURRENCY }) {
  const selections = Array.isArray(addonSelections) ? addonSelections : [];
  const pending = selections.filter((s) => s.source === "pending_payment");
  const sub = selections.filter((s) => s.source === "subscription");
  const paid = selections.filter((s) => s.source === "paid");

  return {
    selectedCount: selections.length,
    inclusiveCount: sub.length,
    pendingPaymentCount: pending.length,
    paidCount: paid.length,
    totalExtraHalala: pending.reduce((sum, s) => sum + normalizeNumber(s.priceHalala), 0),
    currency,
  };
}

function buildPremiumSummary({ plannerMeta, currency = SYSTEM_CURRENCY }) {
  const meta = plannerMeta && typeof plannerMeta === "object" ? plannerMeta : {};
  return {
    selectedCount: normalizeNumber(meta.premiumSlotCount),
    coveredByBalanceCount: normalizeNumber(meta.premiumCoveredByBalanceCount),
    pendingPaymentCount: normalizeNumber(meta.premiumPendingPaymentCount),
    paidExtraCount: normalizeNumber(meta.premiumPaidExtraCount),
    totalExtraHalala: normalizeNumber(meta.premiumTotalHalala),
    currency,
  };
}

function countMealSlotState(mealSlots = []) {
  return (Array.isArray(mealSlots) ? mealSlots : []).reduce((acc, slot) => {
    const status = normalizeString(slot && slot.status, "empty");
    if (status === "complete") acc.complete += 1;
    if (status === "partial") acc.partial += 1;
    if (slot && slot.isPremium) {
      acc.premiumSelected += 1;
      if (slot.premiumSource === "pending_payment") {
        acc.premiumPending += 1;
        acc.pendingAmount += normalizeNumber(slot.premiumExtraFeeHalala);
      } else if (slot.premiumSource === "balance") {
        acc.premiumBalance += 1;
      } else if (slot.premiumSource === "paid_extra" || slot.premiumSource === "paid") {
        acc.premiumPaid += 1;
      }
    }
    return acc;
  }, {
    complete: 0,
    partial: 0,
    premiumSelected: 0,
    premiumPending: 0,
    premiumBalance: 0,
    premiumPaid: 0,
    pendingAmount: 0,
  });
}

function buildEffectivePremiumSummary({ plannerMeta, mealSlots = [], premiumExtraPayment = null, currency = SYSTEM_CURRENCY }) {
  const summary = buildPremiumSummary({ plannerMeta, currency });
  const slotSummary = countMealSlotState(mealSlots);
  const normalizedPayment = normalizePremiumExtraPayment(premiumExtraPayment);
  
  const slotHasPremiumState = Boolean(
    slotSummary.premiumSelected > 0
      || slotSummary.premiumPending > 0
      || slotSummary.premiumBalance > 0
      || slotSummary.premiumPaid > 0
  );
  
  const metaHasPremiumState = Boolean(
    summary.selectedCount > 0
      || summary.pendingPaymentCount > 0
      || summary.paidExtraCount > 0
      || summary.coveredByBalanceCount > 0
  );

  // If slot summary says there are premium slots but meta doesn't, or they mismatch, trust slot summary
  if (slotHasPremiumState) {
    const slotPendingAmount = slotSummary.pendingAmount > 0
      ? slotSummary.pendingAmount
      : (slotSummary.premiumPending > 0 ? normalizedPayment.amountHalala : 0);
      
    const hasDivergence = Boolean(
      !metaHasPremiumState
        || summary.selectedCount !== slotSummary.premiumSelected
        || summary.coveredByBalanceCount !== slotSummary.premiumBalance
        || summary.pendingPaymentCount !== slotSummary.premiumPending
        || summary.paidExtraCount !== slotSummary.premiumPaid
        || (slotSummary.premiumPending > 0 && Math.abs(summary.totalExtraHalala - slotPendingAmount) > 1)
    );

    if (hasDivergence) {
      return {
        selectedCount: slotSummary.premiumSelected,
        coveredByBalanceCount: slotSummary.premiumBalance,
        pendingPaymentCount: slotSummary.premiumPending,
        paidExtraCount: slotSummary.premiumPaid,
        totalExtraHalala: slotPendingAmount,
        currency,
      };
    }
  }

  return summary;
}

function hasPlannerWorkflow(day = {}, plannerMeta = null) {
  return Boolean(
    day.plannerState !== undefined
      || (Array.isArray(day.mealSlots) && day.mealSlots.length > 0)
      || (plannerMeta && typeof plannerMeta === "object" && Object.keys(plannerMeta).length > 0)
  );
}

function isPlanningComplete(plannerMeta, mealSlots = []) {
  const meta = plannerMeta && typeof plannerMeta === "object" ? plannerMeta : {};
  const effectiveRequired = normalizeNumber(meta.requiredSlotCount);
  
  if (effectiveRequired > 0) {
    return Boolean(
      normalizeBoolean(meta.isDraftValid)
        && normalizeNumber(meta.partialSlotCount) === 0
        && normalizeNumber(meta.completeSlotCount) === effectiveRequired
    );
  }
  
  const slotSummary = countMealSlotState(mealSlots);
  return Boolean(slotSummary.partial === 0 && slotSummary.complete > 0);
}

function normalizePremiumExtraPayment(rawPayment = null) {
  const source = rawPayment && typeof rawPayment === "object" ? rawPayment : {};
  const status = PREMIUM_EXTRA_PAYMENT_STATUSES.has(source.status) ? source.status : "none";

  return {
    status,
    paymentId: source.paymentId ? String(source.paymentId) : null,
    providerInvoiceId: source.providerInvoiceId ? String(source.providerInvoiceId) : null,
    amountHalala: normalizeNumber(source.amountHalala),
    currency: normalizeString(source.currency, SYSTEM_CURRENCY),
    expiresAt: source.expiresAt || null,
    reused: Boolean(source.reused),
    revisionHash: normalizeString(source.revisionHash),
    createdAt: source.createdAt || null,
    paidAt: source.paidAt || null,
    extraPremiumCount: normalizeNumber(source.extraPremiumCount),
  };
}

function buildDerivedPremiumExtraPayment({
  plannerMeta,
  mealSlots = [],
  plannerRevisionHash,
  existingPremiumExtraPayment = null,
  currency = SYSTEM_CURRENCY,
}) {
  const summary = buildEffectivePremiumSummary({ plannerMeta, mealSlots, premiumExtraPayment: existingPremiumExtraPayment, currency });
  const normalizedExisting = normalizePremiumExtraPayment(existingPremiumExtraPayment);
  const hasPendingPremium = summary.pendingPaymentCount > 0;

  if (!hasPendingPremium) {
    if (normalizedExisting.status === "paid") {
      return {
        ...normalizedExisting,
        status: "paid",
        amountHalala: normalizeNumber(normalizedExisting.amountHalala),
        currency,
        revisionHash: plannerRevisionHash,
        extraPremiumCount: Math.max(
          normalizeNumber(normalizedExisting.extraPremiumCount),
          normalizeNumber(summary.paidExtraCount)
        ),
      };
    }
    return {
      status: "none",
      paymentId: null,
      providerInvoiceId: null,
      amountHalala: 0,
      currency,
      expiresAt: null,
      reused: false,
      revisionHash: plannerRevisionHash,
      createdAt: null,
      paidAt: null,
      extraPremiumCount: 0,
    };
  }

  const hasRevisionMismatch = Boolean(
    normalizedExisting.paymentId
      && normalizedExisting.revisionHash
      && normalizedExisting.revisionHash !== plannerRevisionHash
  );

  if (hasRevisionMismatch) {
    return {
      ...normalizedExisting,
      status: "revision_mismatch",
      amountHalala: summary.totalExtraHalala,
      currency,
      revisionHash: plannerRevisionHash,
      extraPremiumCount: summary.pendingPaymentCount,
      reused: false,
    };
  }

  const status = normalizedExisting.status !== "none" ? normalizedExisting.status : "none";
  return {
    ...normalizedExisting,
    status,
    amountHalala: summary.totalExtraHalala,
    currency,
    revisionHash: plannerRevisionHash,
    extraPremiumCount: summary.pendingPaymentCount,
  };
}

function buildPaymentRequirement({
  day = {},
  plannerMeta,
  mealSlots = [],
  plannerState = "draft",
  status = "open",
  premiumExtraPayment = null,
  currency = SYSTEM_CURRENCY,
}) {
  const summary = buildEffectivePremiumSummary({ plannerMeta, mealSlots, premiumExtraPayment, currency });
  const addonSummary = buildAddonSummary({ addonSelections: day.addonSelections, currency });
  const planningComplete = isPlanningComplete(plannerMeta, mealSlots);
  const plannerFlowEnabled = hasPlannerWorkflow(day, plannerMeta);
  const normalizedPremiumExtraPayment = normalizePremiumExtraPayment(premiumExtraPayment);
  const isLocked = normalizeString(status, "open") !== "open";
  
  const hasPendingPremium = summary.pendingPaymentCount > 0;
  const hasPendingAddons = addonSummary.pendingPaymentCount > 0;
  const hasAnythingPending = hasPendingPremium || hasPendingAddons;

  let pricingStatus = "not_required";
  let blockingReason = null;
  let requiresPayment = false;

  if (hasAnythingPending) {
    const totalPending = summary.totalExtraHalala + addonSummary.totalExtraHalala;
    if (totalPending > 0) {
      pricingStatus = "priced";
    } else {
      pricingStatus = normalizedPremiumExtraPayment.status === "failed" ? "failed" : "pending";
    }
  }

  if (isLocked) {
    blockingReason = "LOCKED";
  } else if (hasAnythingPending) {
    requiresPayment = true;
    if (normalizedPremiumExtraPayment.status === "revision_mismatch") {
      blockingReason = "PAYMENT_REVISION_MISMATCH";
    } else if (pricingStatus === "failed") {
      blockingReason = "PRICING_FAILED";
    } else if (pricingStatus === "pending") {
      blockingReason = "PRICING_PENDING";
    } else {
      blockingReason = hasPendingPremium ? "PREMIUM_PAYMENT_REQUIRED" : "ADDON_PAYMENT_REQUIRED";
    }
  } else if (!planningComplete) {
    blockingReason = "PLANNING_INCOMPLETE";
  } else if (plannerFlowEnabled && normalizeString(plannerState, "draft") !== "confirmed") {
    blockingReason = "PLANNER_UNCONFIRMED";
  }

  return {
    status: pricingStatus === "priced" && requiresPayment ? "priced" : (requiresPayment ? pricingStatus : "satisfied"),
    requiresPayment,
    pricingStatus,
    blockingReason,
    canCreatePayment: Boolean(
      !isLocked
        && hasAnythingPending
        && pricingStatus === "priced"
    ),
    premiumSelectedCount: summary.selectedCount,
    premiumPendingPaymentCount: summary.pendingPaymentCount,
    addonSelectedCount: addonSummary.selectedCount,
    addonPendingPaymentCount: addonSummary.pendingPaymentCount,
    pendingAmountHalala: hasAnythingPending ? (summary.totalExtraHalala + addonSummary.totalExtraHalala) : 0,
    amountHalala: hasAnythingPending ? (summary.totalExtraHalala + addonSummary.totalExtraHalala) : 0,
    currency,
  };
}

function buildCommercialState({
  plannerMeta,
  plannerState = "draft",
  paymentRequirement,
}) {
  const planningComplete = isPlanningComplete(plannerMeta);
  const normalizedPlannerState = normalizeString(plannerState, "draft");
  const requirement = paymentRequirement && typeof paymentRequirement === "object" ? paymentRequirement : { requiresPayment: false };

  if (!planningComplete) return "draft";
  if (requirement.requiresPayment) return "payment_required";
  if (normalizedPlannerState === "confirmed") return "confirmed";
  return "ready_to_confirm";
}

function buildDayCommercialState(day = {}) {
  const normalizedStatus = normalizeString(day.status, "open");
  const normalizedPlannerState = normalizeString(day.plannerState, "draft");
  const plannerMeta = day && typeof day.plannerMeta === "object" ? day.plannerMeta : {};
  const plannerRevisionHash = buildPlannerRevisionHash({ day, mealSlots: day.mealSlots });
  
  const premiumSummary = buildEffectivePremiumSummary({
    plannerMeta,
    mealSlots: day.mealSlots,
    premiumExtraPayment: day.premiumExtraPayment || null,
    currency: day && day.premiumExtraPayment && day.premiumExtraPayment.currency
      ? day.premiumExtraPayment.currency
      : SYSTEM_CURRENCY,
  });
  
  const premiumExtraPayment = buildDerivedPremiumExtraPayment({
    plannerMeta,
    mealSlots: day.mealSlots,
    plannerRevisionHash,
    existingPremiumExtraPayment: day.premiumExtraPayment || null,
    currency: premiumSummary.currency,
  });
  
  const paymentRequirement = buildPaymentRequirement({
    day,
    plannerMeta,
    mealSlots: day.mealSlots,
    plannerState: normalizedPlannerState,
    status: normalizedStatus,
    premiumExtraPayment,
    currency: premiumSummary.currency,
  });
  
  const commercialState = buildCommercialState({
    plannerMeta,
    plannerState: normalizedPlannerState,
    paymentRequirement,
  });
  
  const isFulfillable = Boolean(
    normalizedPlannerState === "confirmed"
      && commercialState === "confirmed"
      && paymentRequirement.requiresPayment === false
      && FULFILLABLE_DAY_STATUSES.has(normalizedStatus)
  );

  return {
    plannerRevisionHash,
    premiumSummary,
    addonSummary: buildAddonSummary({ addonSelections: day.addonSelections, currency: premiumSummary.currency }),
    premiumExtraPayment,
    paymentRequirement,
    commercialState,
    isFulfillable,
    canBePrepared: isFulfillable,
  };
}

function applyCommercialStateToDay(day = {}) {
  const derived = buildDayCommercialState(day);
  return {
    ...day,
    plannerRevisionHash: derived.plannerRevisionHash,
    premiumSummary: derived.premiumSummary,
    premiumExtraPayment: derived.premiumExtraPayment,
    paymentRequirement: derived.paymentRequirement,
    commercialState: derived.commercialState,
    isFulfillable: derived.isFulfillable,
    canBePrepared: derived.canBePrepared,
  };
}

module.exports = {
  SYSTEM_CURRENCY,
  applyCommercialStateToDay,
  buildCommercialState,
  buildDayCommercialState,
  buildEffectivePremiumSummary,
  buildPaymentRequirement,
  buildPlannerRevisionHash,
  buildPremiumSummary,
  isPlanningComplete,
  normalizePremiumExtraPayment,
};
