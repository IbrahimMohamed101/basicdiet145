"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const dateUtils = require("../../utils/date");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const {
  releaseAddonBalanceAtomically,
  releasePremiumBalanceAtomically,
} = require("./subscriptionSelectionService");

const CANCELABLE_STATUSES = new Set(["active", "pending_payment"]);
const COMMITTED_DAY_STATUSES = ["locked", "in_preparation", "out_for_delivery", "ready_for_pickup"];
const REMOVABLE_DAY_STATUSES = ["open", "frozen"];

const defaultRuntime = {
  startSession() {
    return mongoose.startSession();
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

async function cancelSubscriptionDomain({ subscriptionId, actor, runtime = null }) {
  const resolvedRuntime = resolveRuntime(runtime);
  const session = await resolvedRuntime.startSession();
  let transactionOpen = false;

  try {
    session.startTransaction();
    transactionOpen = true;

    const subscription = await resolvedRuntime.findSubscriptionById({ subscriptionId, session });
    if (!subscription) {
      await session.abortTransaction();
      transactionOpen = false;
      return { outcome: "not_found" };
    }

    if (actor && actor.kind === "client" && String(subscription.userId) !== String(actor.userId)) {
      await session.abortTransaction();
      transactionOpen = false;
      return { outcome: "forbidden" };
    }

    if (subscription.status === "canceled") {
      await session.commitTransaction();
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
      await session.abortTransaction();
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
        if (!day.addonCreditsReleased && Array.isArray(day.addonSelections)) {
          for (const sel of day.addonSelections) {
            if (sel.source === "subscription") {
              await releaseAddonBalanceAtomically({
                subscription,
                addonId: sel.addonId,
                addonPlanId: sel.addonPlanId,
                category: sel.category,
                unitPriceHalala: sel.unitPriceHalala || 0,
                session,
              });
            }
          }
        }

        if (!day.premiumCreditsReleased && Array.isArray(day.premiumUpgradeSelections)) {
          for (const sel of day.premiumUpgradeSelections) {
            if (sel.premiumSource === "balance") {
              await releasePremiumBalanceAtomically({
                subscription,
                premiumKey: sel.premiumKey,
                session,
              });
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
    } else {
      preservedCredits = 0;
    }

    const canceledAt = resolvedRuntime.now();
    const creditsToForfeit = Math.max(0, Number(subscription.remainingMeals || 0) - preservedCredits);
    
    // Atomic update to avoid in-memory read-then-write race conditions
    // Try $inc first to preserve any concurrent deductions
    const updateQuery = { _id: subscription._id };
    if (creditsToForfeit > 0) {
      updateQuery.remainingMeals = { $gte: creditsToForfeit };
    }

    let updatedSub = await Subscription.findOneAndUpdate(
      updateQuery,
      { 
        $inc: { remainingMeals: -creditsToForfeit },
        $set: { 
          status: "canceled", 
          canceledAt 
        } 
      },
      { session, new: true }
    );
    
    if (!updatedSub && creditsToForfeit > 0) {
      // Fallback: if balance dropped concurrently below the forfeit amount, force it to preservedCredits
      updatedSub = await Subscription.findOneAndUpdate(
        { _id: subscription._id },
        { 
          $set: { 
            remainingMeals: preservedCredits, 
            status: "canceled", 
            canceledAt 
          } 
        },
        { session, new: true }
      );
    }
    
    subscription.remainingMeals = updatedSub ? updatedSub.remainingMeals : preservedCredits;
    subscription.status = "canceled";
    subscription.canceledAt = canceledAt;

    await session.commitTransaction();
    transactionOpen = false;

    return {
      outcome: "canceled",
      subscriptionId: String(subscription._id),
      mutation: {
        previousStatus,
        removedFutureDays,
        preservedCredits,
        canceledAt: canceledAt.toISOString(),
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
    if (session && typeof session.endSession === "function") {
      session.endSession();
    }
  }
}

module.exports = {
  cancelSubscriptionDomain,
};
