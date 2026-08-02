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

function reservedBaseMealsForDate(subscription, businessDate) {
  return (Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : [])
    .filter((allocation) => (
      allocation
      && String(allocation.date || "") === businessDate
      && allocation.state === "reserved"
    ))
    .reduce((sum, allocation) => sum + Math.max(1, Number(allocation.quantity || 1)), 0);
}

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

  function ensureNoReservedMealConflict(subscription, businessDate, counts) {
    if (!counts || counts.total <= 0) return;
    const reservedMeals = reservedBaseMealsForDate(subscription, businessDate);
    if (reservedMeals <= 0) return;

    throw new ManualDeductionError(
      "MANUAL_DEDUCTION_CONFLICTS_WITH_RESERVED_MEALS",
      "Meals are already reserved for this subscription today; fulfill or release the reserved day instead of deducting manually",
      409,
      {
        businessDate,
        reservedMeals,
        actionRequired: "FULFILL_OR_RELEASE_RESERVED_DAY",
      }
    );
  }

  async function manualDeduction({ subscriptionId, body, actorId, actorRole }) {
    assertCashierOrAdminRole(actorRole);
    if (!repository.isValidObjectId(subscriptionId)) {
      throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
    }

    const counts = validateCounts(body || {});
    const businessDate = await getBusinessDate();

    try {
      return await runTransactionWithRetry(async (session) => {
        const subscription = await repository.findSubscriptionById(subscriptionId, session);
        validateSubscriptionCanDeduct(subscription, businessDate);
        await validateSubscriptionCustomerExists(subscription, session);
        await ensureNoDeliveryDeductionToday(subscription, businessDate, session);
        ensureNoReservedMealConflict(subscription, businessDate, counts);
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
  reservedBaseMealsForDate,
};
