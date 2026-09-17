"use strict";

const Payment = require("../../models/Payment");
const Subscription = require("../../models/Subscription");

const UNIFIED_DAY_PAYMENT_TYPE = "day_planning_payment";
const ACTIVE_PAYMENT_ALLOCATION_STATES = new Set(["reserved", "consumed"]);

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_error) {
    return "";
  }
}

function metadataOf(payment) {
  return payment && payment.metadata && typeof payment.metadata === "object"
    ? payment.metadata
    : {};
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(clean)
    .filter(Boolean))];
}

function paymentSnapshotSlotKeys(metadata = {}) {
  return unique((Array.isArray(metadata.premiumSelections) ? metadata.premiumSelections : [])
    .map((selection) => selection && (selection.slotKey || (selection.slotIndex ? `slot_${selection.slotIndex}` : ""))));
}

function allocationPaymentIds(allocation = {}) {
  return unique([
    allocation.paymentId,
    allocation.premiumFunding && allocation.premiumFunding.paymentId,
  ]);
}

async function loadAllocationContext({ subscriptionId, allocationKeys, session = null } = {}) {
  const keys = unique(allocationKeys);
  let query = Subscription.findById(subscriptionId).select("baseMealAllocations");
  if (session) query = query.session(session);
  const subscription = await query.lean();
  const allocations = (subscription && Array.isArray(subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => keys.includes(clean(allocation && allocation.allocationKey)));
  return { keys, subscription, allocations };
}

function resolveExactPaymentAllocationKeys({ allocations = [], metadata = {}, plannerRevisionHash = null } = {}) {
  const slotKeys = paymentSnapshotSlotKeys(metadata);
  const expectedRevision = clean(plannerRevisionHash || metadata.revisionHash);
  const dayId = clean(metadata.dayId);

  if (!slotKeys.length) {
    if (Number(metadata.premiumAmountHalala || 0) > 0) {
      const error = new Error("Unified day payment Premium snapshot is missing slot identities");
      error.code = "PAYMENT_ALLOCATION_SCOPE_MISMATCH";
      error.status = 409;
      throw error;
    }
    return [];
  }

  const exactKeys = [];
  for (const slotKey of slotKeys) {
    const matches = allocations.filter((allocation) => (
      clean(allocation && allocation.slotKey) === slotKey
        && (!dayId || clean(allocation && allocation.dayId) === dayId)
        && ACTIVE_PAYMENT_ALLOCATION_STATES.has(clean(allocation && allocation.state))
        && (!expectedRevision || clean(allocation && allocation.plannerRevisionHash) === expectedRevision)
    ));

    if (matches.length !== 1) {
      const error = new Error("Unified day payment could not resolve exactly one allocation for a paid Premium slot");
      error.code = "PAYMENT_ALLOCATION_SCOPE_MISMATCH";
      error.status = 409;
      error.details = {
        dayId,
        slotKey,
        plannerRevisionHash: expectedRevision,
        matchCount: matches.length,
        allocationKeys: matches.map((row) => clean(row && row.allocationKey)).filter(Boolean),
      };
      throw error;
    }
    exactKeys.push(clean(matches[0].allocationKey));
  }

  return unique(exactKeys);
}

function resolveReservationAllocationKeys({ allocations = [], metadata = {} } = {}) {
  const dayId = clean(metadata.dayId);
  const revisionHash = clean(metadata.revisionHash);
  return unique(allocations
    .filter((allocation) => (
      clean(allocation && allocation.state) === "reserved"
        && (!dayId || clean(allocation && allocation.dayId) === dayId)
        && (!revisionHash || clean(allocation && allocation.plannerRevisionHash) === revisionHash)
    ))
    .map((allocation) => allocation && allocation.allocationKey));
}

async function findPaymentForValidation({ subscriptionId, allocations, allocationKeys, plannerRevisionHash, session = null }) {
  const candidateIds = unique((Array.isArray(allocations) ? allocations : [])
    .flatMap((allocation) => allocationPaymentIds(allocation)));

  let query = Payment.findOne({
    type: UNIFIED_DAY_PAYMENT_TYPE,
    subscriptionId,
    ...(candidateIds.length ? { _id: { $in: candidateIds } } : {}),
    ...(plannerRevisionHash ? { "metadata.revisionHash": clean(plannerRevisionHash) } : {}),
  }).sort({ createdAt: -1 });
  if (session) query = query.session(session);
  let payment = await query.lean();
  if (payment) return payment;

  query = Payment.findOne({
    type: UNIFIED_DAY_PAYMENT_TYPE,
    subscriptionId,
    "metadata.baseAllocationKeys": { $in: unique(allocationKeys) },
    ...(plannerRevisionHash ? { "metadata.revisionHash": clean(plannerRevisionHash) } : {}),
  }).sort({ createdAt: -1 });
  if (session) query = query.session(session);
  payment = await query.lean();
  return payment || null;
}

function createScopedLinkPaymentToAllocations(originalLink) {
  if (typeof originalLink !== "function") throw new TypeError("originalLink is required");

  async function linkPaymentToCurrentPremiumAllocations({ subscriptionId, allocationKeys, paymentId, session = null } = {}) {
    let paymentQuery = Payment.findById(paymentId);
    if (session) paymentQuery = paymentQuery.session(session);
    const payment = await paymentQuery;
    if (!payment || clean(payment.type) !== UNIFIED_DAY_PAYMENT_TYPE) {
      return originalLink({ subscriptionId, allocationKeys, paymentId, session });
    }

    const metadata = metadataOf(payment);
    const context = await loadAllocationContext({ subscriptionId, allocationKeys, session });
    const exactPaymentAllocationKeys = resolveExactPaymentAllocationKeys({
      allocations: context.allocations,
      metadata,
      plannerRevisionHash: metadata.revisionHash,
    });
    const reservationAllocationKeys = resolveReservationAllocationKeys({
      allocations: context.allocations,
      metadata,
    });

    payment.metadata = {
      ...metadata,
      baseAllocationKeys: exactPaymentAllocationKeys,
      reservationAllocationKeys,
      allocationScope: "pending_premium_slots",
      allocationScopeVersion: 2,
    };
    payment.markModified("metadata");
    await payment.save(session ? { session } : undefined);

    const result = await originalLink({
      subscriptionId,
      allocationKeys: exactPaymentAllocationKeys,
      paymentId,
      session,
    });
    return {
      ...result,
      allocationScope: "pending_premium_slots",
      paymentAllocationKeys: exactPaymentAllocationKeys,
      reservationAllocationKeys,
    };
  }

  Object.defineProperty(linkPaymentToCurrentPremiumAllocations, "__unifiedDayPaymentAllocationScoped", { value: true });
  Object.defineProperty(linkPaymentToCurrentPremiumAllocations, "__original", { value: originalLink });
  return linkPaymentToCurrentPremiumAllocations;
}

function createScopedValidatePaymentAllocations(originalValidate) {
  if (typeof originalValidate !== "function") throw new TypeError("originalValidate is required");

  async function validateCurrentPremiumPaymentAllocations({ subscriptionId, allocationKeys, plannerRevisionHash, session = null } = {}) {
    const context = await loadAllocationContext({ subscriptionId, allocationKeys, session });
    const payment = await findPaymentForValidation({
      subscriptionId,
      allocations: context.allocations,
      allocationKeys,
      plannerRevisionHash,
      session,
    });
    if (!payment || clean(payment.type) !== UNIFIED_DAY_PAYMENT_TYPE) {
      return originalValidate({ subscriptionId, allocationKeys, plannerRevisionHash, session });
    }

    try {
      const exactPaymentAllocationKeys = resolveExactPaymentAllocationKeys({
        allocations: context.allocations,
        metadata: metadataOf(payment),
        plannerRevisionHash,
      });
      const result = await originalValidate({
        subscriptionId,
        allocationKeys: exactPaymentAllocationKeys,
        plannerRevisionHash,
        session,
      });
      return {
        ...result,
        allocationScope: "pending_premium_slots",
        paymentAllocationKeys: exactPaymentAllocationKeys,
        ignoredHistoricalAllocationKeys: context.keys.filter((key) => !exactPaymentAllocationKeys.includes(key)),
      };
    } catch (error) {
      return {
        valid: false,
        reason: clean(error && error.code) || "PAYMENT_ALLOCATION_SCOPE_MISMATCH",
        details: error && error.details,
      };
    }
  }

  Object.defineProperty(validateCurrentPremiumPaymentAllocations, "__unifiedDayPaymentAllocationScoped", { value: true });
  Object.defineProperty(validateCurrentPremiumPaymentAllocations, "__original", { value: originalValidate });
  return validateCurrentPremiumPaymentAllocations;
}

function createScopedMarkPaidFunding(originalMarkPaidFunding) {
  if (typeof originalMarkPaidFunding !== "function") throw new TypeError("originalMarkPaidFunding is required");

  async function markCurrentPremiumPaymentFunding({ subscriptionId, allocationKeys, paymentId, session = null } = {}) {
    let paymentQuery = Payment.findById(paymentId);
    if (session) paymentQuery = paymentQuery.session(session);
    const payment = await paymentQuery.lean();
    if (!payment || clean(payment.type) !== UNIFIED_DAY_PAYMENT_TYPE) {
      return originalMarkPaidFunding({ subscriptionId, allocationKeys, paymentId, session });
    }

    const context = await loadAllocationContext({ subscriptionId, allocationKeys, session });
    const exactPaymentAllocationKeys = resolveExactPaymentAllocationKeys({
      allocations: context.allocations,
      metadata: metadataOf(payment),
      plannerRevisionHash: metadataOf(payment).revisionHash,
    });
    const result = await originalMarkPaidFunding({
      subscriptionId,
      allocationKeys: exactPaymentAllocationKeys,
      paymentId,
      session,
    });
    return {
      ...result,
      allocationScope: "pending_premium_slots",
      paymentAllocationKeys: exactPaymentAllocationKeys,
    };
  }

  Object.defineProperty(markCurrentPremiumPaymentFunding, "__unifiedDayPaymentAllocationScoped", { value: true });
  Object.defineProperty(markCurrentPremiumPaymentFunding, "__original", { value: originalMarkPaidFunding });
  return markCurrentPremiumPaymentFunding;
}

function createTerminalReservationReleaseWrapper(originalVerify, { transitionAllocation } = {}) {
  if (typeof originalVerify !== "function") throw new TypeError("originalVerify is required");
  if (typeof transitionAllocation !== "function") throw new TypeError("transitionAllocation is required");

  async function verifyUnifiedDayPaymentWithScopedRelease(args = {}) {
    const result = await originalVerify(args);
    const code = clean(result && result.code).toUpperCase();
    if (!result || result.ok !== false || !["PAYMENT_EXPIRED", "PAYMENT_NOT_PAYABLE"].includes(code)) {
      return result;
    }

    const payment = await Payment.findById(args.paymentId).lean();
    const metadata = metadataOf(payment);
    const reservationAllocationKeys = unique(metadata.reservationAllocationKeys);
    let releasedCount = 0;
    for (const allocationKey of reservationAllocationKeys) {
      try {
        const transition = await transitionAllocation({
          subscriptionId: args.subscriptionId,
          allocationKey,
          toState: "released",
        });
        if (transition && transition.changed) releasedCount += 1;
      } catch (_error) {
        // Fail closed for consumed or concurrently changed allocations. The
        // original verification result remains the source of truth.
      }
    }
    return {
      ...result,
      details: {
        ...(result.details && typeof result.details === "object" ? result.details : {}),
        releasedReservationCount: releasedCount,
      },
    };
  }

  Object.defineProperty(verifyUnifiedDayPaymentWithScopedRelease, "__unifiedDayPaymentTerminalReleaseScoped", { value: true });
  Object.defineProperty(verifyUnifiedDayPaymentWithScopedRelease, "__original", { value: originalVerify });
  return verifyUnifiedDayPaymentWithScopedRelease;
}

module.exports = {
  ACTIVE_PAYMENT_ALLOCATION_STATES,
  UNIFIED_DAY_PAYMENT_TYPE,
  createScopedLinkPaymentToAllocations,
  createScopedMarkPaidFunding,
  createScopedValidatePaymentAllocations,
  createTerminalReservationReleaseWrapper,
  findPaymentForValidation,
  loadAllocationContext,
  paymentSnapshotSlotKeys,
  resolveExactPaymentAllocationKeys,
  resolveReservationAllocationKeys,
};
