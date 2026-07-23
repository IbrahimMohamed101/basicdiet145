"use strict";

const mongoose = require("mongoose");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const dateUtils = require("../../utils/date");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const {
  releaseAddonBalanceAtomically,
  assertAddonBalanceReleaseSucceeded,
  releasePremiumBalanceAtomically,
} = require("./subscriptionSelectionService");
const { transitionDayEntitlements } = require("./subscriptionMealEntitlementService");

const CANCELABLE_STATUSES = new Set(["active", "pending_payment"]);
const COMMITTED_DAY_STATUSES = ["locked", "in_preparation", "out_for_delivery", "ready_for_pickup"];
const REMOVABLE_DAY_STATUSES = ["open", "frozen"];

const defaultRuntime = {
  startSession() {
    return startSafeSession();
  },
  findSubscriptionById({ subscriptionId, session }) {
    return Subscription.findById(subscriptionId).session(session);
  },
  countUndeductedCommittedDays({ subscriptionId, session }) {
    return SubscriptionDay.countDocuments({
      subscriptionId,
      status: { $in: COMMITTED_DAY_STATUSES },
      creditsDeducted: { $ne: true },
    }).session(session);
  },
  findFutureOpenAndFrozenDays({ subscriptionId, today, session }) {
    return SubscriptionDay.find({
      subscriptionId,
      date: { $gte: today },
      status: { $in: REMOVABLE_DAY_STATUSES },
    }).session(session);
  },
  deleteFutureOpenAndFrozenDays({ subscriptionId, today, session }) {
    return SubscriptionDay.deleteMany({
      subscriptionId,
      date: { $gte: today },
      status: { $in: REMOVABLE_DAY_STATUSES },
    }).session(session);
  },
  resolveMealsPerDay(subscription) {
    return resolveMealsPerDay(subscription);
  },
  async getTodayKSADate() {
    return getRestaurantBusinessDate();
  },
  now() {
    return new Date();
  },
};

function resolveRuntime(runtime = null) {
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    return defaultRuntime;
  }
  return { ...defaultRuntime, ...runtime };
}

function entitlementVersionGuard(subscription) {
  if (Number(subscription && subscription.entitlementVersion || 0) >= 2) {
    return { entitlementVersion: subscription.entitlementVersion };
  }
  return {
    $or: [
      { entitlementVersion: { $exists: false } },
      { entitlementVersion: null },
      { entitlementVersion: { $lt: 2 } },
    ],
  };
}

function buildCancellationBalanceUpdate(subscription, creditsToForfeit) {
  const quantity = Math.max(0, Number(creditsToForfeit || 0));
  const increment = { remainingMeals: -quantity };
  if (Number(subscription && subscription.entitlementVersion || 0) >= 2) {
    increment.forfeitedMeals = quantity;
  }
  return { $inc: increment };
}

function buildCancellationFallbackUpdate(subscription, preservedCredits, canceledAt, replacementSet) {
  const statusFields = {
    status: "canceled",
    canceledAt,
    ...replacementSet,
  };
  if (Number(subscription && subscription.entitlementVersion || 0) < 2) {
    return { $set: { remainingMeals: preservedCredits, ...statusFields } };
  }
  return [{
    $set: {
      ...statusFields,
      forfeitedMeals: {
        $add: [
          { $ifNull: ["$forfeitedMeals", 0] },
          { $max: [0, { $subtract: ["$remainingMeals", preservedCredits] }] },
        ],
      },
      remainingMeals: { $min: ["$remainingMeals", preservedCredits] },
    },
  }];
}

async function cancelSubscriptionDomain({
  subscriptionId,
  actor,
  session: suppliedSession = null,
  reason = "",
  replacedBySubscriptionId = null,
  runtime = null,
}) {
  const resolvedRuntime = resolveRuntime(runtime);
  const ownsSession = !suppliedSession;
  const session = suppliedSession || await resolvedRuntime.startSession();
  let transactionOpen = false;

  try {
    if (ownsSession) {
      session.startTransaction();
      transactionOpen = true;
    }

    let subscription = await resolvedRuntime.findSubscriptionById({ subscriptionId, session });
    if (!subscription) {
      if (transactionOpen) await session.abortTransaction();
      transactionOpen = false;
      return { outcome: "not_found" };
    }

    if (actor && actor.kind === "client" && String(subscription.userId) !== String(actor.userId)) {
      if (transactionOpen) await session.abortTransaction();
      transactionOpen = false;
      return { outcome: "forbidden" };
    }

    if (subscription.status === "canceled") {
      if (transactionOpen) await session.commitTransaction();
      transactionOpen = false;
      return {
        outcome: "already_canceled",
        subscriptionId: String(subscription._id),
        mutation: {
          canceledAt: subscription.canceledAt ? subscription.canceledAt.toISOString() : null,
        },
      };
    }

    if (!CANCELABLE_STATUSES.has(subscription.status)) {
      if (transactionOpen) await session.abortTransaction();
      transactionOpen = false;
      return {
        outcome: "invalid_transition",
        currentStatus: subscription.status,
      };
    }

    let removedFutureDays = 0;
    let preservedCredits = 0;
    const previousStatus = subscription.status;

    if (subscription.status === "active") {
      const today = await resolvedRuntime.getTodayKSADate();
      const mealsPerDay = resolvedRuntime.resolveMealsPerDay(subscription);
      const undeductedCommittedDays = await resolvedRuntime.countUndeductedCommittedDays({
        subscriptionId: subscription._id,
        session,
      });

      preservedCredits = Math.min(
        Number(subscription.remainingMeals || 0),
        Number(undeductedCommittedDays || 0) * mealsPerDay
      );

      // Release addon & premium balances for future open/frozen days
      const futureDays = await resolvedRuntime.findFutureOpenAndFrozenDays({
        subscriptionId: subscription._id,
        today,
        session,
      });

      for (const day of futureDays) {
        const entitlementRelease = await transitionDayEntitlements({
          subscriptionId: subscription._id,
          day,
          toState: "released",
          session,
        });
        if (!day.addonCreditsReleased && Array.isArray(day.addonSelections)) {
          for (const sel of day.addonSelections) {
            if (sel.source === "subscription") {
              const releaseResult = await releaseAddonBalanceAtomically({
                subscription,
                addonId: sel.addonId,
                addonPlanId: sel.addonPlanId,
                category: sel.category,
                unitPriceHalala: Object.prototype.hasOwnProperty.call(sel, "unitPriceHalala") ? sel.unitPriceHalala : null,
                currency: sel.currency || null,
                balanceBucketId: sel.balanceBucketId || null,
                session,
              });
              assertAddonBalanceReleaseSucceeded(releaseResult, sel);
            }
          }
        }

        if (!entitlementRelease.handled && !day.premiumCreditsReleased && Array.isArray(day.premiumUpgradeSelections)) {
          for (const sel of day.premiumUpgradeSelections) {
            if (sel.premiumSource === "balance") {
              const releaseResult = await releasePremiumBalanceAtomically({
                subscription,
                premiumKey: sel.premiumKey,
                balanceBucketId: sel.balanceBucketId || sel.premiumWalletRowId || null,
                configId: sel.configId || null,
                revision: sel.revision != null ? sel.revision : null,
                session,
              });
              if (!releaseResult.released) {
                const err = new Error("Premium balance bucket could not be released");
                err.code = "DATA_INTEGRITY_ERROR";
                err.status = 409;
                err.details = { reason: releaseResult.reason || "release_failed" };
                throw err;
              }
            }
          }
        }
      }

      const deleteResult = await resolvedRuntime.deleteFutureOpenAndFrozenDays({
        subscriptionId: subscription._id,
        today,
        session,
      });
      removedFutureDays = Number((deleteResult && deleteResult.deletedCount) || 0);

      // Re-read inside the same transaction. Releasing a legacy day's entitlement
      // can upgrade the subscription ledger to entitlementVersion=2 and can also
      // change remaining/reserved balances. Building the cancellation CAS from the
      // pre-release snapshot would then reject the service's own successful upgrade.
      const refreshedSubscription = await resolvedRuntime.findSubscriptionById({
        subscriptionId: subscription._id,
        session,
      });
      if (!refreshedSubscription) {
        const err = new Error("Subscription disappeared during cancellation");
        err.code = "SUBSCRIPTION_NOT_FOUND";
        err.status = 404;
        throw err;
      }
      subscription = refreshedSubscription;
      preservedCredits = Math.min(
        Number(subscription.remainingMeals || 0),
        Number(undeductedCommittedDays || 0) * mealsPerDay
      );
    } else {
      preservedCredits = 0;
    }

    const canceledAt = resolvedRuntime.now();
    const creditsToForfeit = Math.max(0, Number(subscription.remainingMeals || 0) - preservedCredits);
    const replacementSet = {};
    if (reason) replacementSet.cancellationReason = String(reason);
    if (replacedBySubscriptionId) {
      replacementSet.replacedBySubscriptionId = replacedBySubscriptionId;
      replacementSet.replacedAt = canceledAt;
    }
    
    // Atomic update to avoid in-memory read-then-write race conditions
    // Try $inc first to preserve any concurrent deductions
    const updateQuery = {
      _id: subscription._id,
      ...entitlementVersionGuard(subscription),
    };
    if (creditsToForfeit > 0) {
      updateQuery.remainingMeals = { $gte: creditsToForfeit };
    }

    let updatedSub = await Subscription.findOneAndUpdate(
      updateQuery,
      {
        ...buildCancellationBalanceUpdate(subscription, creditsToForfeit),
        $set: { 
          status: "canceled", 
          canceledAt,
          ...replacementSet,
        } 
      },
      { session, new: true }
    );
    
    if (!updatedSub && creditsToForfeit > 0) {
      // Fallback: if balance dropped concurrently below the forfeit amount, force it to preservedCredits
      updatedSub = await Subscription.findOneAndUpdate(
        {
          _id: subscription._id,
          ...entitlementVersionGuard(subscription),
        },
        buildCancellationFallbackUpdate(
          subscription,
          preservedCredits,
          canceledAt,
          replacementSet
        ),
        { session, new: true }
      );
    }

    if (!updatedSub) {
      const err = new Error("Subscription balance changed during cancellation");
      err.code = "SUBSCRIPTION_BALANCE_CONFLICT";
      err.status = 409;
      throw err;
    }
    
    subscription.remainingMeals = updatedSub ? updatedSub.remainingMeals : preservedCredits;
    subscription.status = "canceled";
    subscription.canceledAt = canceledAt;

    if (transactionOpen) await session.commitTransaction();
    transactionOpen = false;

    return {
      outcome: "canceled",
      subscriptionId: String(subscription._id),
      mutation: {
        previousStatus,
        removedFutureDays,
        preservedCredits,
        canceledAt: canceledAt.toISOString(),
        cancellationReason: reason || "",
        replacedBySubscriptionId: replacedBySubscriptionId ? String(replacedBySubscriptionId) : null,
      },
    };
  } catch (err) {
    if (transactionOpen && typeof session.abortTransaction === "function") {
      try {
        await session.abortTransaction();
      } catch (_) {
        // Preserve the original error when abort cleanup also fails.
      }
    }
    throw err;
  } finally {
    if (ownsSession && session && typeof session.endSession === "function") {
      session.endSession();
    }
  }
}

module.exports = {
  buildCancellationBalanceUpdate,
  buildCancellationFallbackUpdate,
  cancelSubscriptionDomain,
  entitlementVersionGuard,
};
