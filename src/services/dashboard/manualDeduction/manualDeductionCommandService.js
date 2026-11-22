"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { ManualDeductionError, assertCashierOrAdminRole } = require("./ManualDeductionError");
const {
  resolveAddonBalances,
  resolveBalances,
  validateBalances,
  validateCounts,
  validateSubscriptionCanDeduct,
} = require("./manualDeductionPolicy");
const { buildDeductionLog, buildDeductionResponse } = require("./manualDeductionPresenter");
const { SAME_DAY_EXTRA_ACTION } = require("./constants");
const {
  executeStackedManualDeduction,
  hasEntitlementBatches,
} = require("./stackedManualDeductionService");
const {
  repairLegacyBatchValidityEndDates,
} = require("./legacyBatchCompatibility");

function buildResidualCounts(counts, consumedReservedRegularMeals = 0) {
  const consumedReserved = Math.min(
    Math.max(0, Math.floor(Number(consumedReservedRegularMeals) || 0)),
    counts.regularMeals
  );
  const regularMeals = counts.regularMeals - consumedReserved;
  return {
    ...counts,
    regularMeals,
    total: regularMeals + counts.premiumMeals,
  };
}

// The cashier ticks "the customer took extra meals from the balance on top of
// today's delivery". Only an explicit true counts.
function isExtraBalanceUseConfirmed(body) {
  const value = body && body.confirmExtraBalanceUse;
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

// A retried request (same idempotency key) must not add a second marker, or the
// confirmed meal count would double. The id is derived from the key, so the
// second insert is rejected as a duplicate and ignored.
function sameDayExtraLogId(subscriptionId, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!key) return undefined;
  const hex = crypto.createHash("sha256")
    .update(`same-day-extra:${subscriptionId}:${key}`)
    .digest("hex")
    .slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

function buildSameDayExtraLog({ subscriptionId, counts, actorId, actorRole, reason, businessDate, idempotencyKey }) {
  const _id = sameDayExtraLogId(subscriptionId, idempotencyKey);
  return {
    ...(_id ? { _id } : {}),
    entityType: "subscription",
    entityId: subscriptionId,
    action: SAME_DAY_EXTRA_ACTION,
    byUserId: actorId,
    byRole: actorRole,
    meta: {
      subscriptionId: String(subscriptionId),
      businessDate,
      confirmed: true,
      deductedTotalMeals: counts.total,
      actorId: actorId ? String(actorId) : null,
      actorRole,
      reason: String(reason || ""),
    },
  };
}

function createManualDeductionCommandService({
  repository,
  getBusinessDate,
  runTransactionWithRetry,
  entitlementBatchDetector = hasEntitlementBatches,
  stackedManualDeductionExecutor = executeStackedManualDeduction,
  legacyBatchValidityRepair = repairLegacyBatchValidityEndDates,
}) {
  async function validateSubscriptionCustomerExists(subscription, session) {
    const customer = await repository.customerExists(subscription.userId, session);
    if (!customer) {
      throw new ManualDeductionError("CUSTOMER_NOT_FOUND", "Customer not found", 404);
    }
  }

  async function ensureNoDeliveryDeductionToday(subscription, businessDate, session) {
    if (subscription.deliveryMode !== "delivery") return;
    const existing = await repository.findLastManualDeduction(subscription._id, businessDate, session);
    if (existing) {
      throw new ManualDeductionError(
        "DELIVERY_ALREADY_DEDUCTED_TODAY",
        "Delivery subscription already deducted today",
        409
      );
    }
  }

  // Never blocks. When the day was already delivered and the cashier did not say
  // the extra meals are on purpose, the response carries a warning so the
  // dashboard can ask, and the day is surfaced for review if it stays unexplained.
  async function buildWarnings({ subscription, businessDate, confirmed, session }) {
    if (confirmed || !subscription || subscription.deliveryMode !== "delivery") return [];
    if (typeof repository.findFulfilledDeliveryDay !== "function") return [];
    try {
      const day = await repository.findFulfilledDeliveryDay(subscription._id, businessDate, session);
      return day ? ["DAY_ALREADY_DELIVERED_TODAY"] : [];
    } catch (err) {
      // The warning is advisory. A failed lookup must never fail a deduction
      // that already went through.
      return [];
    }
  }

  // Evidence that the cashier confirmed the extra meals. It is written AFTER the
  // deduction committed and never throws: if it is lost the day simply stays in
  // the review list, which is the safe direction (an extra alert, never a hidden one).
  async function recordSameDayExtra({ subscriptionId, counts, actorId, actorRole, body, businessDate, idempotencyKey }) {
    try {
      await repository.createDeductionLog(
        buildSameDayExtraLog({
          subscriptionId, counts, actorId, actorRole, reason: body && body.reason, businessDate, idempotencyKey,
        }),
        null
      );
    } catch (err) {
      // Best effort by design.
    }
  }

  async function manualDeduction({ subscriptionId, body, actorId, actorRole, idempotencyKey }) {
    assertCashierOrAdminRole(actorRole);
    if (!repository.isValidObjectId(subscriptionId)) {
      throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
    }

    const counts = validateCounts(body || {});
    const businessDate = await getBusinessDate();
    const extraConfirmed = isExtraBalanceUseConfirmed(body);

    // Stacked subscriptions use entitlement batches as their balance/date
    // source of truth. Keep the parent subscription as the lifecycle/identity
    // guard, but do not reject a valid batch because the aggregate mirror is
    // temporarily stale. The stacked executor performs package-level balance
    // validation, idempotency, leasing and reconciliation atomically.
    if (await entitlementBatchDetector(subscriptionId)) {
      await legacyBatchValidityRepair(subscriptionId);
      const subscription = await repository.findSubscriptionById(subscriptionId, null);
      if (!subscription) {
        throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
      }
      if (String(subscription.status || "") !== "active") {
        throw new ManualDeductionError("SUBSCRIPTION_NOT_ACTIVE", "Subscription is not active", 409);
      }
      await validateSubscriptionCustomerExists(subscription, null);
      const stackedResult = await stackedManualDeductionExecutor({
        subscriptionId,
        counts,
        body: body || {},
        actorId,
        actorRole,
        businessDate,
        idempotencyKey,
      });
      if (extraConfirmed) {
        // A replayed request returns the originally committed response, so the
        // marker uses the date of that deduction, not the date of the retry.
        const deductionDate = stackedResult && typeof stackedResult === "object" && stackedResult.businessDate
          ? String(stackedResult.businessDate)
          : businessDate;
        await recordSameDayExtra({
          subscriptionId, counts, actorId, actorRole, body, businessDate: deductionDate, idempotencyKey,
        });
      }
      const stackedWarnings = await buildWarnings({ subscription, businessDate, confirmed: extraConfirmed, session: null });
      return stackedWarnings.length && stackedResult && typeof stackedResult === "object"
        ? { ...stackedResult, warnings: stackedWarnings }
        : stackedResult;
    }

    let committed;
    try {
      committed = await runTransactionWithRetry(async (session) => {
        const subscription = await repository.findSubscriptionById(subscriptionId, session);
        validateSubscriptionCanDeduct(subscription, businessDate);
        await validateSubscriptionCustomerExists(subscription, session);
        await ensureNoDeliveryDeductionToday(subscription, businessDate, session);
        const before = validateBalances(subscription, counts);

        // For entitlement-ledger subscriptions, a reserved meal is selected but
        // not received. Consume matching regular reservations first, then debit
        // only the residual request from unreserved remainingMeals. This keeps
        // remainingMeals non-negative and prevents double-debiting a reservation.
        let mutationSubscription = subscription;
        let writeCounts = counts;
        let allocationKeys = [];
        if (
          counts.regularMeals > 0
          && Number(subscription.entitlementVersion || 0) >= 2
          && typeof repository.consumeReservedRegularMeals === "function"
        ) {
          const reservedConsumption = await repository.consumeReservedRegularMeals({
            subscription,
            quantity: counts.regularMeals,
            session,
          });
          const consumedReservedMeals = Number(
            reservedConsumption && reservedConsumption.consumedMeals || 0
          );
          if (consumedReservedMeals > 0) {
            allocationKeys = reservedConsumption.allocationKeys || [];
            writeCounts = buildResidualCounts(counts, consumedReservedMeals);
            mutationSubscription = await repository.findSubscriptionById(subscriptionId, session);
            if (!mutationSubscription) {
              throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
            }
          }
        }

        const needsAtomicWrite = writeCounts.total > 0
          || (Array.isArray(writeCounts.addons) && writeCounts.addons.length > 0);
        const updated = needsAtomicWrite
          ? await repository.deductAtomically({
            subscription: mutationSubscription,
            counts: writeCounts,
            session,
          })
          : mutationSubscription;

        const after = resolveBalances(updated);
        const afterAddonBalances = resolveAddonBalances(updated);

        const log = buildDeductionLog({
          subscription: updated,
          counts,
          before,
          after,
          actorId,
          actorRole,
          reason: body && body.reason,
          notes: body && body.notes,
          businessDate,
          allocationKeys,
        });
        await repository.createDeductionLog(log, session);

        return {
          ...buildDeductionResponse({
            subscription: updated,
            counts,
            balances: after,
            addonBalances: afterAddonBalances,
            businessDate,
          }),
          __subscription: updated,
        };
      }, {
        label: "manual_subscription_deduction",
        context: { subscriptionId: String(subscriptionId) },
      });
    } catch (err) {
      if (err && err.code === 11000) {
        throw new ManualDeductionError(
          "DELIVERY_ALREADY_DEDUCTED_TODAY",
          "Delivery subscription already deducted today",
          409
        );
      }
      throw err;
    }

    // Everything below is advisory and runs after the deduction committed, so it
    // can never block or undo it.
    const { __subscription: updatedSubscription, ...response } = committed;
    if (extraConfirmed) {
      await recordSameDayExtra({ subscriptionId, counts, actorId, actorRole, body, businessDate });
    }
    const warnings = await buildWarnings({
      subscription: updatedSubscription, businessDate, confirmed: extraConfirmed, session: null,
    });
    return warnings.length ? { ...response, warnings } : response;
  }

  return { manualDeduction };
}

module.exports = {
  buildResidualCounts,
  buildSameDayExtraLog,
  isExtraBalanceUseConfirmed,
  createManualDeductionCommandService,
};
