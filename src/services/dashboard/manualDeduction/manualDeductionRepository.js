"use strict";

const mongoose = require("mongoose");
const ActivityLog = require("../../../models/ActivityLog");
const Plan = require("../../../models/Plan");
const Subscription = require("../../../models/Subscription");
const User = require("../../../models/User");
const {
  transitionPickupEntitlements,
} = require("../../subscription/subscriptionMealEntitlementService");
const { ACTIVE_STATUS, MANUAL_DEDUCTION_ACTION } = require("./constants");
const { ManualDeductionError } = require("./ManualDeductionError");
const { buildPremiumAllocation } = require("./manualDeductionPolicy");

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

async function findLastManualDeduction(subscriptionId, businessDate = null, session = null) {
  const query = {
    entityType: "subscription",
    entityId: subscriptionId,
    action: MANUAL_DEDUCTION_ACTION,
  };
  if (businessDate) {
    query["meta.businessDate"] = businessDate;
  }
  let cursor = ActivityLog.findOne(query).sort({ createdAt: -1 });
  if (session) cursor = cursor.session(session);
  return cursor.lean();
}

function findUserByPhone(phone) {
  return User.findOne({ phone, role: "client" }).lean();
}

function findActiveSubscriptionsByUserId(userId) {
  return Subscription.find({
    userId,
    status: ACTIVE_STATUS,
  }).sort({ createdAt: -1 }).lean();
}

function findPlansByIds(planIds) {
  return Plan.find({ _id: { $in: planIds } }).lean();
}

async function customerExists(customerId, session) {
  return User.exists({ _id: customerId, role: "client" }).session(session);
}

function findSubscriptionById(subscriptionId, session) {
  return Subscription.findById(subscriptionId).session(session);
}

function buildPremiumRemainingExpression() {
  return {
    $sum: {
      $ifNull: ["$premiumBalance.remainingQty", []],
    },
  };
}

function buildRegularRemainingExpression() {
  return {
    $subtract: ["$remainingMeals", buildPremiumRemainingExpression()],
  };
}

function isReservedRegularAllocation(allocation) {
  if (!allocation || String(allocation.state || "") !== "reserved") return false;
  const premiumSource = String(
    allocation.premiumFunding && allocation.premiumFunding.source || "none"
  );
  return premiumSource === "none";
}

function compareReservedAllocations(left, right) {
  const dateCompare = String(left && left.date || "").localeCompare(String(right && right.date || ""));
  if (dateCompare !== 0) return dateCompare;
  const slotCompare = String(left && left.slotKey || "").localeCompare(String(right && right.slotKey || ""));
  if (slotCompare !== 0) return slotCompare;
  return String(left && left.allocationKey || "").localeCompare(String(right && right.allocationKey || ""));
}

function selectReservedRegularAllocationKeys(subscription, requestedCount) {
  const count = Math.max(0, Math.floor(Number(requestedCount) || 0));
  if (count <= 0 || Number(subscription && subscription.entitlementVersion || 0) < 2) return [];
  return (Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : [])
    .filter(isReservedRegularAllocation)
    .slice()
    .sort(compareReservedAllocations)
    .slice(0, count)
    .map((allocation) => String(allocation.allocationKey || ""))
    .filter(Boolean);
}

async function consumeReservedRegularMeals({ subscription, quantity, session }) {
  const allocationKeys = selectReservedRegularAllocationKeys(subscription, quantity);
  if (!allocationKeys.length) {
    return { consumedMeals: 0, allocationKeys: [] };
  }

  const transitioned = await transitionPickupEntitlements({
    subscriptionId: subscription._id,
    allocationKeys,
    toState: "consumed",
    session,
  });
  if (!transitioned || transitioned.changedCount !== allocationKeys.length) {
    throw new ManualDeductionError(
      "RESERVED_MEAL_CONSUMPTION_CONFLICT",
      "Reserved meal balance changed during manual deduction",
      409,
      {
        requestedReservedMeals: allocationKeys.length,
        consumedReservedMeals: transitioned ? Number(transitioned.changedCount || 0) : 0,
      }
    );
  }

  return {
    consumedMeals: allocationKeys.length,
    allocationKeys,
  };
}

function buildDeductionAtomicMutation({ subscription, counts }) {
  const allocations = buildPremiumAllocation(subscription, counts.premiumMeals);
  const usesEntitlementLedger = Number(subscription.entitlementVersion || 0) >= 2;
  const filter = {
    _id: subscription._id,
    status: ACTIVE_STATUS,
    remainingMeals: { $gte: counts.total },
  };

  const andClauses = [];
  // Never allow a concurrent legacy-to-v2 migration to leave the canonical
  // ledger half-updated. A failed compare-and-set is safer than a corrupt row.
  if (usesEntitlementLedger) {
    filter.entitlementVersion = subscription.entitlementVersion;
  } else {
    andClauses.push({
      $or: [
        { entitlementVersion: { $exists: false } },
        { entitlementVersion: null },
        { entitlementVersion: { $lt: 2 } },
      ],
    });
  }

  if (counts.regularMeals > 0) {
    andClauses.push({
      $expr: {
        $gte: [buildRegularRemainingExpression(), counts.regularMeals],
      },
    });
  }

  if (allocations.length) {
    andClauses.push(...allocations.map((allocation) => ({
      premiumBalance: {
        $elemMatch: {
          _id: allocation.rowId,
          remainingQty: { $gte: allocation.qty },
        },
      },
    })));
  }

  if (counts.addons && counts.addons.length > 0) {
    andClauses.push(...counts.addons.map((addonRequest) => ({
      addonBalance: {
        $elemMatch: {
          addonId: new mongoose.Types.ObjectId(addonRequest.addonId),
          remainingQty: { $gte: addonRequest.qty },
        },
      },
    })));
  }

  if (andClauses.length > 0) filter.$and = andClauses;

  const update = {};
  if (counts.total > 0) {
    update.$inc = { remainingMeals: -counts.total };
    if (usesEntitlementLedger) update.$inc.consumedMeals = counts.total;
  }

  const arrayFilters = [];
  if (allocations.length) {
    if (!update.$inc) update.$inc = {};
    allocations.forEach((allocation, index) => {
      update.$inc[`premiumBalance.$[p${index}].remainingQty`] = -allocation.qty;
      update.$inc[`premiumBalance.$[p${index}].consumedQty`] = allocation.qty;
      arrayFilters.push({ [`p${index}._id`]: allocation.rowId });
    });
  }

  if (counts.addons && counts.addons.length > 0) {
    if (!update.$inc) update.$inc = {};
    counts.addons.forEach((addonRequest, index) => {
      update.$inc[`addonBalance.$[a${index}].remainingQty`] = -addonRequest.qty;
      update.$inc[`addonBalance.$[a${index}].consumedQty`] = addonRequest.qty;
      arrayFilters.push({ [`a${index}.addonId`]: new mongoose.Types.ObjectId(addonRequest.addonId) });
    });
  }

  return { filter, update, arrayFilters, usesEntitlementLedger };
}

async function deductAtomically({ subscription, counts, session }) {
  const { filter, update, arrayFilters } = buildDeductionAtomicMutation({ subscription, counts });
  const options = { new: true, session };
  if (arrayFilters.length > 0) {
    options.arrayFilters = arrayFilters;
  }

  const updated = await Subscription.findOneAndUpdate(filter, update, options);
  if (!updated) {
    throw new ManualDeductionError("INSUFFICIENT_REMAINING_MEALS", "Subscription balance changed; not enough remaining balance", 409);
  }
  return updated;
}

async function createDeductionLog(log, session) {
  await ActivityLog.create([log], { session });
}

function listManualDeductionLogs(subscriptionId, limit) {
  return ActivityLog.find({
    entityType: "subscription",
    entityId: subscriptionId,
    action: MANUAL_DEDUCTION_ACTION,
  }).sort({ createdAt: -1 }).limit(limit).lean();
}

module.exports = {
  buildDeductionAtomicMutation,
  consumeReservedRegularMeals,
  createDeductionLog,
  customerExists,
  deductAtomically,
  findActiveSubscriptionsByUserId,
  findLastManualDeduction,
  findPlansByIds,
  findSubscriptionById,
  findUserByPhone,
  isReservedRegularAllocation,
  isValidObjectId,
  listManualDeductionLogs,
  selectReservedRegularAllocationKeys,
};
