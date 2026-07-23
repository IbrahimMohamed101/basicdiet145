#!/usr/bin/env node

"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");

// Install the same production composition used by routes before repairing data.
require("../src/services/installSubscriptionDayFullMealCompatibility");
require("../src/services/installSubscriptionBackendRepairComposition");
require("../src/services/installPaidPremiumBaseMealEntitlement");

const {
  ensurePaidPremiumBaseMealEntitlement,
} = require("../src/services/installPaidPremiumBaseMealEntitlement");

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseArgs(argv) {
  const args = {
    execute: false,
    allActive: false,
    subscriptionId: "",
    phone: "",
  };
  for (const token of argv) {
    if (token === "--execute") args.execute = true;
    else if (token === "--all-active") args.allActive = true;
    else if (token.startsWith("--subscription-id=")) args.subscriptionId = clean(token.split("=").slice(1).join("="));
    else if (token.startsWith("--phone=")) args.phone = clean(token.split("=").slice(1).join("="));
  }
  return args;
}

function completeSlotKeys(day) {
  return (Array.isArray(day && day.mealSlots) ? day.mealSlots : [])
    .filter((slot) => slot && String(slot.status || "complete") === "complete")
    .map((slot, index) => clean(slot.slotKey) || `slot_${Number(slot.slotIndex || index + 1)}`);
}

function hasPaidPremium(day) {
  if (clean(day && day.premiumExtraPayment && day.premiumExtraPayment.status) === "paid") return true;
  return (Array.isArray(day && day.mealSlots) ? day.mealSlots : []).some((slot) => (
    slot
      && slot.isPremium === true
      && ["paid", "paid_extra"].includes(clean(slot.premiumSource))
  ));
}

function activeAllocationIdentities(subscription, day) {
  const dayId = clean(day && day._id);
  const date = clean(day && day.date);
  return new Set(
    (Array.isArray(subscription && subscription.baseMealAllocations) ? subscription.baseMealAllocations : [])
      .filter((allocation) => {
        if (!allocation || !["reserved", "consumed", "forfeited"].includes(clean(allocation.state))) return false;
        return (dayId && clean(allocation.dayId) === dayId)
          || (!clean(allocation.dayId) && date && clean(allocation.date) === date);
      })
      .map((allocation) => clean(allocation.slotKey))
      .filter(Boolean)
  );
}

async function resolveSubscriptions(args) {
  if (args.subscriptionId) {
    if (!mongoose.Types.ObjectId.isValid(args.subscriptionId)) {
      throw new Error("--subscription-id must be a valid MongoDB ObjectId");
    }
    return Subscription.find({ _id: args.subscriptionId }).lean();
  }

  if (args.phone) {
    const user = await User.findOne({ phone: args.phone }).select("_id phone").lean();
    if (!user) throw new Error(`No user found for phone ${args.phone}`);
    return Subscription.find({ userId: user._id, status: "active" }).sort({ createdAt: -1 }).lean();
  }

  if (args.allActive) {
    return Subscription.find({ status: "active" }).sort({ createdAt: 1 }).lean();
  }

  throw new Error("Choose one scope: --subscription-id=<id>, --phone=<phone>, or --all-active");
}

async function auditSubscription(subscription, { execute }) {
  const days = await SubscriptionDay.find({
    subscriptionId: subscription._id,
    $or: [
      { "premiumExtraPayment.status": "paid" },
      { mealSlots: { $elemMatch: { isPremium: true, premiumSource: { $in: ["paid", "paid_extra"] } } } },
    ],
  }).sort({ date: 1 });

  const rows = [];
  let currentSubscription = await Subscription.findById(subscription._id).lean();
  for (const day of days) {
    if (!hasPaidPremium(day)) continue;
    const slotKeys = completeSlotKeys(day);
    if (!slotKeys.length) continue;
    const activeIdentities = activeAllocationIdentities(currentSubscription, day);
    const missingSlotKeys = slotKeys.filter((key) => !activeIdentities.has(key));
    if (!missingSlotKeys.length) {
      rows.push({
        date: day.date,
        status: "ok",
        completeSlots: slotKeys.length,
        missingSlotKeys: [],
      });
      continue;
    }

    const before = Number(currentSubscription.remainingMeals || 0);
    if (!execute) {
      rows.push({
        date: day.date,
        status: "needs_repair",
        completeSlots: slotKeys.length,
        missingSlotKeys,
        remainingMealsBefore: before,
      });
      continue;
    }

    const reservation = await ensurePaidPremiumBaseMealEntitlement({
      subscription: currentSubscription,
      day,
      payment: day.premiumExtraPayment && day.premiumExtraPayment.paymentId
        ? { _id: day.premiumExtraPayment.paymentId }
        : null,
    });
    currentSubscription = await Subscription.findById(subscription._id).lean();
    rows.push({
      date: day.date,
      status: "repaired",
      completeSlots: slotKeys.length,
      missingSlotKeys,
      allocationKeys: reservation.allocationKeys,
      newlyReservedKeys: reservation.newlyReservedKeys,
      remainingMealsBefore: before,
      remainingMealsAfter: Number(currentSubscription.remainingMeals || 0),
    });
  }

  return {
    subscriptionId: clean(subscription._id),
    userId: clean(subscription.userId),
    totalMeals: Number(currentSubscription && currentSubscription.totalMeals || subscription.totalMeals || 0),
    remainingMeals: Number(currentSubscription && currentSubscription.remainingMeals || subscription.remainingMeals || 0),
    paidPremiumDaysAudited: rows.length,
    needsRepair: rows.filter((row) => row.status === "needs_repair").length,
    repaired: rows.filter((row) => row.status === "repaired").length,
    days: rows,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    const subscriptions = await resolveSubscriptions(args);
    if (!subscriptions.length) throw new Error("No matching subscriptions found");

    const reports = [];
    for (const subscription of subscriptions) {
      reports.push(await auditSubscription(subscription, { execute: args.execute }));
    }

    const summary = {
      mode: args.execute ? "execute" : "dry_run",
      subscriptions: reports.length,
      paidPremiumDaysAudited: reports.reduce((sum, row) => sum + row.paidPremiumDaysAudited, 0),
      needsRepair: reports.reduce((sum, row) => sum + row.needsRepair, 0),
      repaired: reports.reduce((sum, row) => sum + row.repaired, 0),
      reports,
    };
    console.log("[repair-paid-premium-base-meal-allocations] completed");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[repair-paid-premium-base-meal-allocations:error] ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  activeAllocationIdentities,
  auditSubscription,
  completeSlotKeys,
  hasPaidPremium,
  parseArgs,
};
