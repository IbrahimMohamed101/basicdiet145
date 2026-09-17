#!/usr/bin/env node
"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
const {
  buildEntitlementDiagnostics,
} = require("../src/services/subscription/pickupEntitlementLinkService");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log([
    "Usage:",
    "  npm run diagnose:pickup-entitlements -- --subscription <id> --date YYYY-MM-DD",
    "",
    "Optional:",
    "  --allow-inconsistent   Return exit code 0 even when issues are found",
    "",
    "The command is read-only. It does not mutate production data.",
  ].join("\n"));
}

function validateInputs(subscriptionId, date) {
  if (!subscriptionId || !mongoose.isValidObjectId(subscriptionId)) {
    throw new Error("--subscription must be a valid MongoDB ObjectId");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    throw new Error("--date must use YYYY-MM-DD");
  }
}

function collectIssues(diagnostics) {
  const issues = [];
  const completeSlots = diagnostics.slots.filter((slot) => slot.status === "complete");
  if (!diagnostics.dayId) issues.push("SUBSCRIPTION_DAY_NOT_FOUND");
  if (completeSlots.length > 0 && diagnostics.allocations.length === 0) {
    issues.push("MISSING_DAY_ALLOCATIONS");
  }
  if (diagnostics.allocations.length > 0 && diagnostics.allocations.length < completeSlots.length) {
    issues.push("PARTIAL_DAY_ALLOCATIONS");
  }
  if (diagnostics.allocations.some((allocation) => allocation.staleClaim)) {
    issues.push("STALE_PICKUP_REQUEST_CLAIM");
  }
  if (diagnostics.allocations.some((allocation) => allocation.state === "released")) {
    issues.push("RELEASED_ALLOCATION_ON_PLANNED_DAY");
  }
  const duplicateSlotKeys = diagnostics.allocations
    .map((allocation) => allocation.slotKey)
    .filter((slotKey, index, rows) => slotKey && rows.indexOf(slotKey) !== index);
  if (duplicateSlotKeys.length) issues.push("DUPLICATE_DAY_ALLOCATION_SLOT_KEY");
  return [...new Set(issues)];
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    usage();
    return;
  }

  const subscriptionId = readArg("--subscription");
  const date = readArg("--date");
  validateInputs(subscriptionId, date);

  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    const [subscription, day, pickupRequests] = await Promise.all([
      Subscription.findById(subscriptionId)
        .select("totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals entitlementVersion baseMealAllocations")
        .lean(),
      SubscriptionDay.findOne({ subscriptionId, date }).lean(),
      SubscriptionPickupRequest.find({ subscriptionId, date })
        .select("_id status selectedMealSlotIds selectedPickupItemIds creditsReserved creditsReleasedAt creditsConsumedAt baseAllocationKeys baseAllocationMode createdAt")
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    if (!subscription) throw new Error("Subscription not found");
    const diagnostics = buildEntitlementDiagnostics({ subscription, day, pickupRequests });
    const issues = collectIssues(diagnostics);
    const output = {
      ok: issues.length === 0,
      issues,
      counters: {
        totalMeals: Number(subscription.totalMeals || 0),
        remainingMeals: Number(subscription.remainingMeals || 0),
        reservedMeals: Number(subscription.reservedMeals || 0),
        consumedMeals: Number(subscription.consumedMeals || 0),
        forfeitedMeals: Number(subscription.forfeitedMeals || 0),
        invariantTotal: Number(subscription.remainingMeals || 0)
          + Number(subscription.reservedMeals || 0)
          + Number(subscription.consumedMeals || 0)
          + Number(subscription.forfeitedMeals || 0),
      },
      diagnostics,
      pickupRequests: pickupRequests.map((request) => ({
        id: String(request._id),
        status: request.status,
        selectedMealSlotIds: request.selectedMealSlotIds || [],
        selectedPickupItemIds: request.selectedPickupItemIds || [],
        creditsReserved: Boolean(request.creditsReserved),
        creditsReleasedAt: request.creditsReleasedAt || null,
        creditsConsumedAt: request.creditsConsumedAt || null,
        baseAllocationKeys: request.baseAllocationKeys || [],
        baseAllocationMode: request.baseAllocationMode || null,
      })),
    };

    console.log(JSON.stringify(output, null, 2));
    if (issues.length && !hasFlag("--allow-inconsistent")) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(`[pickup-diagnostic] ${err.message}`);
  process.exitCode = 1;
});
