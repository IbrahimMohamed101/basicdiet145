"use strict";

const mongoose = require("mongoose");
const SubscriptionDay = require("../../models/SubscriptionDay");

function resolveTotalAllowedMeals(subscription) {
  const totalAllowedMeals = Number(subscription && subscription.totalMeals);
  return Number.isFinite(totalAllowedMeals) && totalAllowedMeals >= 0
    ? Math.floor(totalAllowedMeals)
    : 0;
}

function countCompleteMealSlots(mealSlots = []) {
  // Canonical planner slots are counted as planned meals only after validation
  // marks the slot complete. Premium data is an overlay on the slot, not an
  // additional meal.
  return (Array.isArray(mealSlots) ? mealSlots : []).filter(
    (slot) => slot && slot.status === "complete"
  ).length;
}

function normalizeAffectedDates(affectedDates = []) {
  return [...new Set(
    (Array.isArray(affectedDates) ? affectedDates : [])
      .map((date) => (typeof date === "string" ? date.trim() : ""))
      .filter(Boolean)
  )];
}

function normalizeIncomingSelections(incomingDaySelections = []) {
  return (Array.isArray(incomingDaySelections) ? incomingDaySelections : [])
    .map((entry) => ({
      date: entry && typeof entry.date === "string" ? entry.date.trim() : "",
      mealSlots: Array.isArray(entry && entry.mealSlots) ? entry.mealSlots : [],
    }))
    .filter((entry) => entry.date);
}

async function countExistingCompleteSlotsOutsideAffectedDates({
  subscriptionId,
  affectedDates,
  session = null,
}) {
  if (!subscriptionId) return 0;

  const normalizedDates = normalizeAffectedDates(affectedDates);
  const match = {
    subscriptionId: new mongoose.Types.ObjectId(String(subscriptionId)),
  };
  if (normalizedDates.length > 0) {
    match.date = { $nin: normalizedDates };
  }

  const aggregate = SubscriptionDay.aggregate([
    { $match: match },
    {
      $project: {
        completeSlotCount: {
          $size: {
            $filter: {
              input: { $ifNull: ["$mealSlots", []] },
              as: "slot",
              cond: { $eq: ["$$slot.status", "complete"] },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$completeSlotCount" },
      },
    },
  ]);

  if (session) aggregate.session(session);
  const [result] = await aggregate;
  return Number(result && result.total) || 0;
}

async function computePlanningBalanceAfterSave({
  subscription,
  affectedDates,
  incomingDaySelections,
  session = null,
}) {
  const normalizedAffectedDates = normalizeAffectedDates(affectedDates);
  const normalizedIncomingSelections = normalizeIncomingSelections(incomingDaySelections);
  const subscriptionId = subscription && subscription._id;

  const totalAllowedMeals = resolveTotalAllowedMeals(subscription);
  const existingPlannedMealsOutsideAffectedDates = await countExistingCompleteSlotsOutsideAffectedDates({
    subscriptionId,
    affectedDates: normalizedAffectedDates,
    session,
  });
  const incomingPlannedMeals = normalizedIncomingSelections.reduce(
    (sum, entry) => sum + countCompleteMealSlots(entry.mealSlots),
    0
  );
  const totalAfterSave = existingPlannedMealsOutsideAffectedDates + incomingPlannedMeals;
  const remainingPlannableMealsBeforeSave = Math.max(
    0,
    totalAllowedMeals - existingPlannedMealsOutsideAffectedDates
  );
  const remainingPlannableMealsAfterSave = Math.max(
    0,
    totalAllowedMeals - totalAfterSave
  );

  return {
    totalAllowedMeals,
    existingPlannedMealsOutsideAffectedDates,
    incomingPlannedMeals,
    totalAfterSave,
    remainingPlannableMealsBeforeSave,
    remainingPlannableMealsAfterSave,
  };
}

async function assertPlanningBalanceAfterSave(args) {
  const summary = await computePlanningBalanceAfterSave(args);

  if (summary.totalAfterSave > summary.totalAllowedMeals) {
    throw {
      status: 422,
      code: "MEAL_PLANNING_LIMIT_EXCEEDED",
      message: "Planned meals exceed subscription meal allowance",
      details: {
        ...summary,
        exceededBy: summary.totalAfterSave - summary.totalAllowedMeals,
      },
    };
  }

  return summary;
}

module.exports = {
  assertPlanningBalanceAfterSave,
  computePlanningBalanceAfterSave,
  countCompleteMealSlots,
  countExistingCompleteSlotsOutsideAffectedDates,
};
