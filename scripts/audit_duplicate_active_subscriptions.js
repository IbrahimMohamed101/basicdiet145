#!/usr/bin/env node
"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Subscription = require("../src/models/Subscription");

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function isProduction() {
  return ["production", "prod"].includes(String(process.env.NODE_ENV || "").trim().toLowerCase())
    || isTruthy(process.env.RAILWAY_ENVIRONMENT_NAME && String(process.env.RAILWAY_ENVIRONMENT_NAME).includes("production"));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }
  if (apply && isProduction() && !isTruthy(process.env.ALLOW_PRODUCTION_ACTIVE_SUBSCRIPTION_REPAIR)) {
    throw new Error("Refusing to repair Production without ALLOW_PRODUCTION_ACTIVE_SUBSCRIPTION_REPAIR=true");
  }

  await mongoose.connect(mongoUri);

  const duplicates = await Subscription.aggregate([
    { $match: { status: "active" } },
    {
      $group: {
        _id: "$userId",
        count: { $sum: 1 },
        subscriptions: {
          $push: {
            _id: "$_id",
            createdAt: "$createdAt",
            startDate: "$startDate",
          },
        },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry_run",
    duplicateUsers: duplicates.length,
    users: duplicates.map((row) => ({
      userId: String(row._id),
      activeCount: row.count,
      subscriptionIds: row.subscriptions
        .sort((a, b) => new Date(b.createdAt || b.startDate || 0) - new Date(a.createdAt || a.startDate || 0))
        .map((sub) => String(sub._id)),
    })),
  }, null, 2));

  if (!apply) {
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  for (const row of duplicates) {
    const sorted = row.subscriptions
      .slice()
      .sort((a, b) => new Date(b.createdAt || b.startDate || 0) - new Date(a.createdAt || a.startDate || 0));
    const keep = sorted[0];
    const cancelIds = sorted.slice(1).map((sub) => sub._id);
    if (!cancelIds.length) continue;
    await Subscription.updateMany(
      { _id: { $in: cancelIds }, status: "active" },
      {
        $set: {
          status: "canceled",
          canceledAt: now,
          cancellationReason: "duplicate_active_subscription_repair",
          replacedBySubscriptionId: keep._id,
          replacedAt: now,
        },
      }
    );
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.stack || err.message);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
