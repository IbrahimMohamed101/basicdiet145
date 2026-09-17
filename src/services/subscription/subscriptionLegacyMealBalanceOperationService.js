"use strict";

const Subscription = require("../../models/Subscription");
const {
  ensureEntitlementLedger,
} = require("./subscriptionMealEntitlementService");

function serviceError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function withOptionalSession(options, session) {
  return session ? { ...options, session } : options;
}

function legacyPickupReleaseKey(pickupRequestId) {
  return `pickup_release:${String(pickupRequestId)}`;
}

async function applyLegacyPickupRelease({
  subscriptionId,
  pickupRequestId,
  mealCount,
  session = null,
} = {}) {
  const quantity = Number(mealCount || 0);
  if (!subscriptionId || !pickupRequestId || !Number.isInteger(quantity) || quantity <= 0) {
    throw serviceError("INVALID_ARGUMENTS", "A positive legacy pickup release quantity is required", 400);
  }

  // Historical direct debits are classified as consumed when the v2 ledger is
  // initialized. Releasing one must therefore atomically move the same quantity
  // from consumed back to remaining and record the operation key in that exact
  // Subscription document.
  await ensureEntitlementLedger(subscriptionId, session);
  const operationKey = legacyPickupReleaseKey(pickupRequestId);
  const updated = await Subscription.findOneAndUpdate(
    {
      _id: subscriptionId,
      entitlementVersion: 2,
      consumedMeals: { $gte: quantity },
      $expr: {
        $lte: [{ $add: ["$remainingMeals", quantity] }, "$totalMeals"],
      },
      legacyMealBalanceOperationKeys: { $ne: operationKey },
    },
    {
      $inc: { remainingMeals: quantity, consumedMeals: -quantity },
      $addToSet: { legacyMealBalanceOperationKeys: operationKey },
    },
    withOptionalSession({ new: true }, session)
  ).lean();

  if (updated) return { applied: true, alreadyApplied: false, operationKey, subscription: updated };

  const query = Subscription.findById(subscriptionId)
    .select("remainingMeals consumedMeals totalMeals legacyMealBalanceOperationKeys");
  if (session) query.session(session);
  const current = await query.lean();
  if (!current) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  if ((current.legacyMealBalanceOperationKeys || []).includes(operationKey)) {
    return { applied: false, alreadyApplied: true, operationKey, subscription: current };
  }
  throw serviceError(
    "DATA_INTEGRITY_ERROR",
    "Historical pickup credit could not be returned without breaking the meal balance invariant",
    409
  );
}

module.exports = {
  applyLegacyPickupRelease,
  legacyPickupReleaseKey,
};
