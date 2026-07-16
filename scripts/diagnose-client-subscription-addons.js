#!/usr/bin/env node
"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const {
  buildAddonChoiceGroups,
} = require("../src/services/subscription/subscriptionAddonChoicesService");
const {
  buildAddonCategoryAllowances,
  buildAddonSubscriptionAllowances,
} = require("../src/services/subscription/subscriptionAddonBalanceService");
const {
  selectCurrentSubscription,
  subscriptionDateWindow,
} = require("../src/services/subscription/subscriptionCurrentResolverService");
const { getTodayKSADate } = require("../src/utils/date");

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function idOf(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function entitlementDetails(row) {
  return {
    addonPlanId: idOf(row && (row.addonPlanId || row.addonId)),
    addonPlanName: row && (row.addonPlanName || row.name) || "",
    displayKey: row && row.displayKey || "",
    displayCategory: row && row.displayCategory || "",
    allowanceCategory: row && (row.allowanceCategory || row.category) || "",
    entitlementKey: row && row.entitlementKey || "",
    menuProductIds: (Array.isArray(row && row.menuProductIds) ? row.menuProductIds : []).map(String),
    menuCategoryKeys: Array.isArray(row && row.menuCategoryKeys) ? row.menuCategoryKeys : [],
    includedTotalQty: Number(row && row.includedTotalQty || 0),
    currency: row && row.currency || "SAR",
    sourceRequestShape: row && row.sourceRequestShape || null,
  };
}

function balanceDetails(row) {
  return {
    balanceBucketId: idOf(row && (row._id || row.balanceBucketId)),
    addonPlanId: idOf(row && (row.addonPlanId || row.addonId)),
    entitlementKey: row && row.entitlementKey || "",
    displayKey: row && (row.displayKey || row.displayCategory) || "",
    allowanceCategory: row && (row.allowanceCategory || row.category) || "",
    includedTotalQty: Number(row && row.includedTotalQty || 0),
    purchasedQty: Number(row && row.purchasedQty || 0),
    consumedQty: Number(row && row.consumedQty || 0),
    remainingQty: Number(row && row.remainingQty || 0),
    currency: row && row.currency || "SAR",
  };
}

function paymentDetails(row) {
  return {
    paymentId: idOf(row && row._id),
    type: row && row.type || "",
    status: row && row.status || "",
    applied: row && row.applied === true,
    paidAt: row && row.paidAt || null,
    createdAt: row && row.createdAt || null,
  };
}

async function main() {
  const userId = argumentValue(process.argv.slice(2), "--user-id");
  if (!mongoose.Types.ObjectId.isValid(String(userId || ""))) {
    throw new Error("Usage: node scripts/diagnose-client-subscription-addons.js --user-id <24-character-user-id>");
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI or MONGODB_URI is required. The value is never printed.");
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

  const subscriptions = await Subscription.find({ userId })
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  const subscriptionIds = subscriptions.map((row) => row._id);
  const payments = subscriptionIds.length
    ? await Payment.find({ subscriptionId: { $in: subscriptionIds } }).sort({ createdAt: -1 }).lean()
    : [];
  const paymentsBySubscription = new Map();
  for (const payment of payments) {
    const subscriptionId = idOf(payment.subscriptionId);
    const rows = paymentsBySubscription.get(subscriptionId) || [];
    rows.push(paymentDetails(payment));
    paymentsBySubscription.set(subscriptionId, rows);
  }

  const businessDate = getTodayKSADate();
  const resolution = selectCurrentSubscription(subscriptions, { businessDate });
  const selected = resolution.subscription;
  const addonChoiceGroups = selected
    ? await buildAddonChoiceGroups({ subscription: selected, userId, lang: "ar" })
    : [];
  const addonSubscriptionAllowances = selected ? buildAddonSubscriptionAllowances(selected) : [];
  const addonCategoryAllowances = selected ? buildAddonCategoryAllowances(selected) : [];

  const ownedAddonPlanIds = new Set(
    (Array.isArray(selected && selected.addonSubscriptions) ? selected.addonSubscriptions : [])
      .map((row) => idOf(row && (row.addonPlanId || row.addonId)))
      .filter(Boolean)
  );
  const groupsByPlanId = new Map(addonChoiceGroups.map((group) => [String(group.addonPlanId || ""), group]));
  const missingOwnedGroups = [...ownedAddonPlanIds].filter((addonPlanId) => !groupsByPlanId.has(addonPlanId));
  const incorrectlyUnpurchasedGroups = [...ownedAddonPlanIds].filter((addonPlanId) => {
    const group = groupsByPlanId.get(addonPlanId);
    return group && (group.source !== "subscription" || group.isPurchased !== true);
  });

  const report = {
    generatedAt: new Date().toISOString(),
    businessDate,
    userId: String(userId),
    subscriptionsCount: subscriptions.length,
    subscriptions: subscriptions.map((row) => {
      const evaluation = resolution.evaluated.find((candidate) => String(candidate.subscription._id) === String(row._id));
      return {
        subscriptionId: String(row._id),
        status: row.status,
        createdAt: row.createdAt || null,
        ...subscriptionDateWindow(row),
        validityEndDate: row.validityEndDate || null,
        selectedPlanId: idOf(row.planId),
        currentResolverEligibility: evaluation && evaluation.evaluation || null,
        payments: paymentsBySubscription.get(String(row._id)) || [],
        addonSubscriptionsCount: Array.isArray(row.addonSubscriptions) ? row.addonSubscriptions.length : 0,
        addonSubscriptions: (Array.isArray(row.addonSubscriptions) ? row.addonSubscriptions : []).map(entitlementDetails),
        addonBalancesCount: Array.isArray(row.addonBalance) ? row.addonBalance.length : 0,
        addonBalances: (Array.isArray(row.addonBalance) ? row.addonBalance : []).map(balanceDetails),
      };
    }),
    selectedCurrentSubscription: selected ? {
      subscriptionId: String(selected._id),
      reason: resolution.reason,
      status: selected.status,
      ...subscriptionDateWindow(selected),
      activationPaymentPaid: (paymentsBySubscription.get(String(selected._id)) || []).some((payment) => (
        ["subscription_activation", "subscription_renewal"].includes(payment.type)
        && payment.status === "paid"
        && payment.applied === true
      )),
      addonSubscriptionsCount: Array.isArray(selected.addonSubscriptions) ? selected.addonSubscriptions.length : 0,
      addonBalancesCount: Array.isArray(selected.addonBalance) ? selected.addonBalance.length : 0,
    } : null,
    addonSubscriptionAllowances,
    addonCategoryAllowances,
    addonChoiceGroupsOwnershipSummary: addonChoiceGroups.map((group) => ({
      addonPlanId: group.addonPlanId,
      groupId: group.groupId,
      label: group.label,
      displayKey: group.displayKey,
      source: group.source,
      isPurchased: group.isPurchased,
      includedTotalQty: group.includedTotalQty,
      remainingIncludedQty: group.remainingIncludedQty,
      choicesCount: Array.isArray(group.choices) ? group.choices.length : 0,
      pricingModes: [...new Set((group.choices || []).map((choice) => choice.pricingMode))],
    })),
    mismatches: {
      ownedAddonPlanIdsMissingFromChoiceGroups: missingOwnedGroups,
      ownedAddonPlanIdsMarkedUnpurchased: incorrectlyUnpurchasedGroups,
      hasMismatch: missingOwnedGroups.length > 0 || incorrectlyUnpurchasedGroups.length > 0,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error && (error.code || error.name) || "DIAGNOSTIC_FAILED",
      message: error && error.message || "Diagnostic failed",
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
