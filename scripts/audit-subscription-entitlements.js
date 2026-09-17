#!/usr/bin/env node
"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const SubscriptionDayAppendOperation = require("../src/models/SubscriptionDayAppendOperation");
const SubscriptionDailyAddonOperation = require("../src/models/SubscriptionDailyAddonOperation");
const { resolveMongoUri, getDbNameFromUri } = require("../src/utils/mongoUriResolver");
const {
  auditSubscriptionEntitlements,
} = require("../src/services/subscription/subscriptionEntitlementAuditService");

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positiveInt(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(keyFn(row) || "");
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function requireObjectId(value, label) {
  if (!value) return null;
  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    throw new Error(`${label} is not a valid ObjectId`);
  }
  return new mongoose.Types.ObjectId(String(value));
}

async function main() {
  if (hasFlag("apply") || hasFlag("execute") || hasFlag("write")) {
    throw new Error("This audit is read-only and does not support apply/execute/write flags");
  }

  const subscriptionId = requireObjectId(readArg("subscription-id"), "--subscription-id");
  const userId = requireObjectId(readArg("user-id"), "--user-id");
  const limit = positiveInt(readArg("limit", "100"), 100);
  const staleMinutes = positiveInt(readArg("stale-minutes", "5"), 5);
  const staleMs = staleMinutes * 60 * 1000;
  const includeAllStatuses = hasFlag("all-statuses");
  const failOnWarning = hasFlag("fail-on-warning");

  const uri = resolveMongoUri();
  console.log(`Database: ${getDbNameFromUri(uri)}`);
  console.log("Mode: READ ONLY");
  console.log(`Limit: ${limit}`);
  console.log(`Stale threshold: ${staleMinutes} minutes`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const query = {};
    if (subscriptionId) query._id = subscriptionId;
    if (userId) query.userId = userId;
    if (!includeAllStatuses) query.status = "active";

    const subscriptions = await Subscription.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const subscriptionIds = subscriptions.map((row) => row._id);

    const [days, pickupRequests, appendOperations, addonOperations] = subscriptionIds.length
      ? await Promise.all([
        SubscriptionDay.find({ subscriptionId: { $in: subscriptionIds } }).lean(),
        SubscriptionPickupRequest.find({ subscriptionId: { $in: subscriptionIds } }).lean(),
        SubscriptionDayAppendOperation.find({ subscriptionId: { $in: subscriptionIds } }).lean(),
        SubscriptionDailyAddonOperation.find({ subscriptionId: { $in: subscriptionIds } }).lean(),
      ])
      : [[], [], [], []];

    const daysBySubscription = groupBy(days, (row) => row.subscriptionId);
    const pickupBySubscription = groupBy(pickupRequests, (row) => row.subscriptionId);
    const appendBySubscription = groupBy(appendOperations, (row) => row.subscriptionId);
    const addonOpsBySubscription = groupBy(addonOperations, (row) => row.subscriptionId);
    const now = new Date();

    const reports = subscriptions.map((subscription) => {
      const id = String(subscription._id);
      return auditSubscriptionEntitlements({
        subscription,
        days: daysBySubscription.get(id) || [],
        pickupRequests: pickupBySubscription.get(id) || [],
        appendOperations: appendBySubscription.get(id) || [],
        addonOperations: addonOpsBySubscription.get(id) || [],
        now,
        staleMs,
      });
    });

    const summary = {
      readOnly: true,
      database: getDbNameFromUri(uri),
      generatedAt: now.toISOString(),
      subscriptionsScanned: reports.length,
      subscriptionsWithErrors: reports.filter((row) => row.errorCount > 0).length,
      subscriptionsWithWarnings: reports.filter((row) => row.warningCount > 0).length,
      errorCount: reports.reduce((sum, row) => sum + row.errorCount, 0),
      warningCount: reports.reduce((sum, row) => sum + row.warningCount, 0),
      filters: {
        subscriptionId: subscriptionId ? String(subscriptionId) : null,
        userId: userId ? String(userId) : null,
        statuses: includeAllStatuses ? "all" : ["active"],
      },
    };

    console.log(JSON.stringify({ summary, reports }, null, 2));

    if (summary.errorCount > 0 || (failOnWarning && summary.warningCount > 0)) {
      process.exitCode = 2;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  try {
    await mongoose.disconnect();
  } catch (_error) {
    // Ignore cleanup failure after the original error.
  }
  process.exitCode = 1;
});
