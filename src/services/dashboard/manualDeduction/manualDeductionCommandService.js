"use strict";

const { ManualDeductionError, assertCashierOrAdminRole } = require("./ManualDeductionError");
const {
  resolveAddonBalances,
  resolveBalances,
  validateBalances,
  validateCounts,
  validateSubscriptionCanDeduct,
} = require("./manualDeductionPolicy");
const { buildDeductionLog, buildDeductionResponse } = require("./manualDeductionPresenter");
const {
  executeStackedManualDeduction,
  hasEntitlementBatches,
} = require("./stackedManualDeductionService");
const {
  repairLegacyBatchValidityEndDates,
} = require("./legacyBatchCompatibility");

function createManualDeductionCommandService({ repository, getBusinessDate, runTransactionWithRetry }) {
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

  async function manualDeduction({ subscriptionId, body, actorId, actorRole, idempotencyKey }) {
    assertCashierOrAdminRole(actorRole);
    if (!repository.isValidObjectId(subscriptionId)) {
      throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
    }

    const counts = validateCounts(body || {});
    const businessDate = await getBusinessDate();

    // Stacked subscriptions use entitlement batches as their balance/date
    // source of truth. Keep the parent subscription as the lifecycle/identity
    // guard, but do not reject a valid batch because the aggregate mirror is
    // temporarily stale. The stacked executor performs package-level balance
    // validation, idempotency, leasing and reconciliation atomically.
    if (await hasEntitlementBatches(subscriptionId)) {
      await repairLegacyBatchValidityEndDates(subscriptionId);
      const subscription = await repository.findSubscriptionById(subscriptionId, null);
      if (!subscription) {
        throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
      }
      if (String(subscription.status || "") !== "active") {
        throw new ManualDeductionError("SUBSCRIPTION_NOT_ACTIVE", "Subscription is not active", 409);
      }
      await validateSubscriptionCustomerExists(subscription, null);
      return executeStackedManualDeduction({
        subscriptionId,
        counts,
        body: body || {},
        actorId,
        actorRole,
        businessDate,
        idempotencyKey,
      });
    }

    try {
      return await runTransactionWithRetry(async (session) => {
        const subscription = await repository.findSubscriptionById(subscriptionId, session);
        validateSubscriptionCanDeduct(subscription, businessDate);
        await validateSubscriptionCustomerExists(subscription, session);
        await ensureNoDeliveryDeductionToday(subscription, businessDate, session);
        const before = validateBalances(subscription, counts);
        const updated = await repository.deductAtomically({ subscription, counts, session });
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
        });
        await repository.createDeductionLog(log, session);

        return buildDeductionResponse({
          subscription: updated,
          counts,
          balances: after,
          addonBalances: afterAddonBalances,
          businessDate,
        });
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
  }

  return { manualDeduction };
}

module.exports = {
  createManualDeductionCommandService,
};
