#!/usr/bin/env node
"use strict";

require("dotenv").config();

const crypto = require("crypto");
const mongoose = require("mongoose");

const { resolveMongoUri } = require("../src/utils/mongoUriResolver");

const REPAIR_KEY = "delivery-balance-repair-2026-08-03-v1";
const REPAIR_ACTION = "subscription_manual_deduction_reversal";
const REQUIRED_CONFIRMATION = "REPAIR_ROA_OSAMAH_2026_08_03";
const SCRIPT_VERSION = "1.0.0";
const CORRECTION_PERIOD = Object.freeze({
  from: "2026-07-29",
  through: "2026-08-02",
  timezone: "Asia/Riyadh",
});

class RepairPreconditionError extends Error {
  constructor(message, differences = []) {
    super(message);
    this.name = "RepairPreconditionError";
    this.code = "REPAIR_PRECONDITION_FAILED";
    this.differences = differences;
  }
}

const PRODUCTION_CONFIG = Object.freeze({
  // These documents currently live in the database selected by the supplied
  // production URI. The script also requires MONGO_DB to match this name, so a
  // URI/database mismatch fails closed before any target data can be changed.
  databaseName: "test",
  targets: [
    {
      key: "roa",
      subscriptionId: "6a694dcceabe15012241bcbf",
      userId: "6a69375b9c35b9a31f1181b4",
      expectedName: "رؤي",
      identityHash: "846292790f3ecc654abd0372c096589b7c9a1f8f258988eeae16c0c37ac42f61",
      expectedWallet: {
        totalMeals: 78,
        selectedMealsPerDay: 3,
        remainingMeals: 52,
      },
      expectedSnapshotHashes: {
        subscription: "bf795ad1e60c32600d4a52abc88b0e4c9271cae8ff8e06bc5ea6478b4ef99446",
        activityLogs: "68eb9d3b2302a3885a62df604c6a51974f1e2a87611bcb107855df5e59192402",
        days: "9e5151cc06ff328d7c59f42a893de7089df756677eb54de8f9e7fbc72cbfd7d9",
        deliveries: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      },
      expectedManualLogs: [
        { id: "6a694e51eabe15012241bd3d", businessDate: "2026-07-29", total: 6, regular: 6, premium: 0 },
        { id: "6a6ced8c0d05ea74be2fa041", businessDate: "2026-07-31", total: 8, regular: 8, premium: 0 },
        { id: "6a6fd6facaeb251aab48d058", businessDate: "2026-08-03", total: 12, regular: 12, premium: 0 },
      ],
      reversedActivityLogIds: [
        "6a694e51eabe15012241bd3d",
        "6a6ced8c0d05ea74be2fa041",
      ],
      restoredRegularMeals: 14,
      restoredPremiumMeals: 0,
      releasedAllocationIds: [],
      expectedAfter: {
        totalMeals: 78,
        remainingMeals: 66,
        netManualDeductions: 12,
      },
      reason: "Reverse the first two duplicate delivery deductions; retain the verified 12-meal deduction through 2026-08-02 KSA.",
    },
    {
      key: "osamah",
      subscriptionId: "6a6bfb16669468df32d7765b",
      userId: "6a6bfa16669468df32d7757a",
      expectedName: "osamah alqarni",
      identityHash: "c3c0450f9a3a0e0adc1e9cf838948b9a554c279b95d01c147e59dd946121161b",
      expectedWallet: {
        totalMeals: 52,
        selectedMealsPerDay: 2,
        remainingMeals: 40,
        reservedMeals: 4,
        consumedMeals: 8,
        forfeitedMeals: 0,
        entitlementVersion: 2,
      },
      expectedSnapshotHashes: {
        subscription: "3a32b6838165bb6842bc2b90f2ab24ee1cc98576969e3d2a847cf7522a5d8043",
        activityLogs: "17673fdd79825df634953a91042f0c2db01842850ca6d7f88d1846d0a0eb0f11",
        days: "bb69148a3c9c020d92553fc228f1fb4daf3e2ecbb8995c19679fc0968cf27d4c",
        deliveries: "50c4bcb897dd0ec0243f9a11648cd7058d6457c2ad46ade7cab33f016b676808",
      },
      expectedManualLogs: [
        { id: "6a6db4e30d05ea74be2fcbf7", businessDate: "2026-08-01", total: 2, regular: 2, premium: 0 },
        { id: "6a6f0e2e0d05ea74be301c10", businessDate: "2026-08-02", total: 2, regular: 2, premium: 0 },
        { id: "6a6fd74ecaeb251aab48d170", businessDate: "2026-08-03", total: 4, regular: 4, premium: 0 },
      ],
      reversedActivityLogIds: ["6a6fd74ecaeb251aab48d170"],
      restoredRegularMeals: 4,
      restoredPremiumMeals: 0,
      releasedAllocationIds: [
        "6a6d542f0d05ea74be2fb2d6",
        "6a6d542f0d05ea74be2fb2d9",
        "6a6d548e0d05ea74be2fb48e",
        "6a6d548e0d05ea74be2fb491",
      ],
      expectedAllocationDates: ["2026-08-01", "2026-08-01", "2026-08-02", "2026-08-02"],
      expectedAfter: {
        totalMeals: 52,
        remainingMeals: 48,
        remainingRegularMeals: 47,
        remainingPremiumMeals: 1,
        reservedMeals: 0,
        consumedMeals: 4,
        forfeitedMeals: 0,
        netManualDeductions: 4,
      },
      reason: "Reverse only the extra 2026-08-03 deduction and release four stale base-meal reservations for 2026-08-01/02 without consuming them.",
    },
  ],
  protected: [
    {
      key: "ahmed",
      subscriptionId: "6a673cefd554e771082cd4e2",
      userId: "6a670882d554e771082cd179",
      expectedName: "ahmed",
      identityHash: "c6b0c25dce61f9883bae1cb89dddb114ab9a2e07ba38f18f9af31eddfa2e6d89",
      expectedWallet: { totalMeals: 21, remainingMeals: 3 },
      expectedSnapshotHashes: {
        subscription: "306b32beaa77bd70663f6eb0fef11345ef6f426f3db06cc7561794e96a757f94",
        activityLogs: "4503e298ad7c328b01ed2705d530dbda3d6d8e64df03ba4e810827934aad7d26",
        days: "ae715d7d42065d0940bf01ed6282c04d15f2e85e7b840e4109e6520c6a2d16d4",
        deliveries: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      },
    },
    {
      key: "haifa",
      subscriptionId: "6a67d0622c25e041a25eed25",
      userId: "6a67b3a70c08a6f7c17f88f8",
      expectedName: "هيفاء الشريف",
      identityHash: "418844213ba2e52632b92ba18c71e45cbf7d41c6d2773937ad57052e25d76826",
      expectedWallet: {
        totalMeals: 52,
        remainingMeals: 28,
        reservedMeals: 14,
        consumedMeals: 10,
        forfeitedMeals: 0,
        entitlementVersion: 2,
      },
      expectedSnapshotHashes: {
        subscription: "6099b82a99287d9c39e4225ae83f6bccb0220e817659ce022f51f1fa738ed266",
        activityLogs: "4d50e933ae043615711977d81aa57a962993e8b3eb756dcf019fafdd279f9f9a",
        days: "42e4595662b38f7cf08177ec3d598b0a54a45a9fbc4760b055912763b3a2a491",
        deliveries: "b5c3b604749747dacf4e63a10b951001a16b939c3c575fa0b65d03a2eb30152b",
      },
    },
  ],
});

function objectId(value) {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) {
    throw new RepairPreconditionError(`Invalid ObjectId in repair configuration: ${value}`);
  }
  return new mongoose.Types.ObjectId(String(value));
}

function canonicalize(value) {
  if (value === undefined) return "__undefined__";
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value && value._bsontype === "ObjectId") return value.toHexString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function hash(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function plainClone(value) {
  return canonicalize(value);
}

function difference(path, expected, actual) {
  return { path, expected: canonicalize(expected), actual: canonicalize(actual) };
}

function assertNoDifferences(differences, message = "Repair preconditions do not match") {
  if (differences.length) throw new RepairPreconditionError(message, differences);
}

function walletSummary(subscription) {
  const premium = Array.isArray(subscription.premiumBalance) ? subscription.premiumBalance : [];
  const remainingPremiumMeals = premium.reduce(
    (sum, row) => sum + Number(row && row.remainingQty || 0),
    0
  );
  const remainingMeals = Number(subscription.remainingMeals || 0);
  return {
    totalMeals: Number(subscription.totalMeals || 0),
    selectedMealsPerDay: Number(subscription.selectedMealsPerDay || 0),
    remainingMeals,
    remainingRegularMeals: remainingMeals - remainingPremiumMeals,
    remainingPremiumMeals,
    reservedMeals: Number(subscription.reservedMeals || 0),
    consumedMeals: Number(subscription.consumedMeals || 0),
    forfeitedMeals: Number(subscription.forfeitedMeals || 0),
    entitlementVersion: Number(subscription.entitlementVersion || 0),
  };
}

function manualLogSummary(log) {
  const meta = log && log.meta || {};
  return {
    id: String(log && log._id || ""),
    businessDate: String(meta.businessDate || ""),
    total: Number(meta.deductedTotalMeals || 0),
    regular: Number(meta.deductedRegularMeals || 0),
    premium: Number(meta.deductedPremiumMeals || 0),
  };
}

function manualTotals(logs, reversedIds = []) {
  const reversed = new Set(reversedIds.map(String));
  const gross = logs.reduce((sum, log) => sum + Number(log.meta?.deductedTotalMeals || 0), 0);
  const reversedMeals = logs.reduce(
    (sum, log) => sum + (reversed.has(String(log._id)) ? Number(log.meta?.deductedTotalMeals || 0) : 0),
    0
  );
  return { gross, reversed: reversedMeals, net: gross - reversedMeals };
}

async function loadScope(db, spec, { session = null } = {}) {
  const subscriptionId = objectId(spec.subscriptionId);
  const options = session ? { session } : {};
  const subscription = await db.collection("subscriptions").findOne({ _id: subscriptionId }, options);
  const user = subscription
    ? await db.collection("users").findOne({ _id: subscription.userId }, options)
    : null;
  const activityLogs = await db.collection("activitylogs")
    .find({ entityType: "subscription", entityId: subscriptionId }, options)
    .sort({ _id: 1 })
    .toArray();
  const days = await db.collection("subscriptiondays")
    .find({ subscriptionId }, options)
    .sort({ _id: 1 })
    .toArray();
  const deliveries = await db.collection("deliveries")
    .find({ subscriptionId }, options)
    .sort({ _id: 1 })
    .toArray();
  return { subscription, user, activityLogs, days, deliveries };
}

function scopeHashes(scope) {
  return {
    subscription: hash(scope.subscription),
    activityLogs: hash(scope.activityLogs),
    days: hash(scope.days),
    deliveries: hash(scope.deliveries),
  };
}

function identityHash(user) {
  return hash({
    name: String(user && user.name || "").trim(),
    phone: String(user && (user.phoneE164 || user.phone) || "").trim(),
  });
}

function maskPhone(user) {
  const phone = String(user && (user.phoneE164 || user.phone) || "").trim();
  if (!phone) return "";
  return phone.length <= 4 ? "****" : `${phone.slice(0, 3)}***${phone.slice(-3)}`;
}

function validateScope(spec, scope, { requireSnapshotHashes = true } = {}) {
  const differences = [];
  const prefix = spec.key || spec.subscriptionId;
  if (!scope.subscription) {
    differences.push(difference(`${prefix}.subscription`, "present", "missing"));
    return differences;
  }
  if (!scope.user) differences.push(difference(`${prefix}.user`, "present", "missing"));
  if (String(scope.subscription.userId) !== String(spec.userId)) {
    differences.push(difference(`${prefix}.userId`, spec.userId, scope.subscription.userId));
  }
  if (String(scope.user && scope.user.name || "").trim() !== spec.expectedName) {
    differences.push(difference(`${prefix}.name`, spec.expectedName, scope.user && scope.user.name));
  }
  if (scope.user && identityHash(scope.user) !== spec.identityHash) {
    differences.push(difference(`${prefix}.identityHash`, spec.identityHash, identityHash(scope.user)));
  }
  for (const [field, expected] of Object.entries(spec.expectedWallet || {})) {
    if (Number(scope.subscription[field] || 0) !== Number(expected)) {
      differences.push(difference(`${prefix}.${field}`, expected, scope.subscription[field]));
    }
  }
  if (requireSnapshotHashes && spec.expectedSnapshotHashes) {
    const actualHashes = scopeHashes(scope);
    for (const [field, expected] of Object.entries(spec.expectedSnapshotHashes)) {
      if (actualHashes[field] !== expected) {
        differences.push(difference(`${prefix}.snapshot.${field}`, expected, actualHashes[field]));
      }
    }
  }
  return differences;
}

function validateTarget(spec, scope) {
  const differences = validateScope(spec, scope);
  if (!scope.subscription) return differences;

  const manualLogs = scope.activityLogs
    .filter((row) => row.action === "manual_subscription_meal_deduction")
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  const actualManual = manualLogs.map(manualLogSummary);
  if (hash(actualManual) !== hash(spec.expectedManualLogs)) {
    differences.push(difference(`${spec.key}.manualLogs`, spec.expectedManualLogs, actualManual));
  }

  const reversedIds = new Set(spec.reversedActivityLogIds.map(String));
  const selectedLogs = manualLogs.filter((row) => reversedIds.has(String(row._id)));
  if (selectedLogs.length !== reversedIds.size) {
    differences.push(difference(`${spec.key}.reversedActivityLogIds.count`, reversedIds.size, selectedLogs.length));
  }
  const totals = manualTotals(manualLogs, spec.reversedActivityLogIds);
  if (totals.reversed !== spec.restoredRegularMeals + spec.restoredPremiumMeals) {
    differences.push(difference(
      `${spec.key}.reversalTotal`,
      spec.restoredRegularMeals + spec.restoredPremiumMeals,
      totals.reversed
    ));
  }

  const allocations = Array.isArray(scope.subscription.baseMealAllocations)
    ? scope.subscription.baseMealAllocations
    : [];
  const releaseIds = new Set((spec.releasedAllocationIds || []).map(String));
  const selectedAllocations = allocations.filter((row) => releaseIds.has(String(row._id)));
  if (selectedAllocations.length !== releaseIds.size) {
    differences.push(difference(`${spec.key}.releaseAllocations.count`, releaseIds.size, selectedAllocations.length));
  }
  if (selectedAllocations.some((row) => row.state !== "reserved" || Number(row.quantity || 1) !== 1)) {
    differences.push(difference(
      `${spec.key}.releaseAllocations.state`,
      "all reserved quantity=1",
      selectedAllocations.map((row) => ({ id: String(row._id), state: row.state, quantity: row.quantity }))
    ));
  }
  if (spec.expectedAllocationDates) {
    const dates = selectedAllocations.map((row) => String(row.date)).sort();
    const expectedDates = [...spec.expectedAllocationDates].sort();
    if (hash(dates) !== hash(expectedDates)) {
      differences.push(difference(`${spec.key}.releaseAllocations.dates`, expectedDates, dates));
    }
  }
  return differences;
}

function previewTarget(spec, scope) {
  const before = walletSummary(scope.subscription);
  const releasedReservedMeals = (spec.releasedAllocationIds || []).length;
  const after = {
    ...before,
    remainingMeals: before.remainingMeals
      + spec.restoredRegularMeals
      + spec.restoredPremiumMeals
      + releasedReservedMeals,
    reservedMeals: before.reservedMeals - releasedReservedMeals,
    consumedMeals: before.entitlementVersion >= 2
      ? before.consumedMeals - spec.restoredRegularMeals - spec.restoredPremiumMeals
      : before.consumedMeals,
  };
  after.remainingRegularMeals = after.remainingMeals - after.remainingPremiumMeals;
  const manualLogs = scope.activityLogs.filter((row) => row.action === "manual_subscription_meal_deduction");
  const manual = manualTotals(manualLogs, spec.reversedActivityLogIds);
  return {
    key: spec.key,
    subscriptionId: spec.subscriptionId,
    customer: { name: spec.expectedName, phone: maskPhone(scope.user) },
    reversedActivityLogIds: [...spec.reversedActivityLogIds],
    releasedAllocationIds: [...(spec.releasedAllocationIds || [])],
    releasedReservedMeals,
    restoredRegularMeals: spec.restoredRegularMeals,
    restoredPremiumMeals: spec.restoredPremiumMeals,
    manualDeductions: manual,
    before,
    after,
  };
}

function validatePreview(spec, preview) {
  const differences = [];
  for (const [field, expected] of Object.entries(spec.expectedAfter || {})) {
    const actual = field === "netManualDeductions"
      ? preview.manualDeductions.net
      : preview.after[field];
    if (Number(actual) !== Number(expected)) {
      differences.push(difference(`${spec.key}.expectedAfter.${field}`, expected, actual));
    }
  }
  if (preview.after.entitlementVersion >= 2) {
    const accounted = preview.after.remainingMeals
      + preview.after.reservedMeals
      + preview.after.consumedMeals
      + preview.after.forfeitedMeals;
    if (accounted !== preview.after.totalMeals) {
      differences.push(difference(`${spec.key}.balanceEquation`, preview.after.totalMeals, accounted));
    }
  } else if (preview.after.remainingMeals + preview.manualDeductions.net !== preview.after.totalMeals) {
    differences.push(difference(
      `${spec.key}.legacyBalanceEquation`,
      preview.after.totalMeals,
      preview.after.remainingMeals + preview.manualDeductions.net
    ));
  }
  return differences;
}

async function assertRepairKeyUnused(db, session) {
  const existing = await db.collection("activitylogs").findOne({
    entityType: "subscription",
    action: REPAIR_ACTION,
    "meta.repairKey": REPAIR_KEY,
  }, { session });
  if (existing) {
    throw new RepairPreconditionError("Repair key has already been used", [
      difference("repairKey", "unused", { activityLogId: String(existing._id), repairKey: REPAIR_KEY }),
    ]);
  }
}

function reversalLog(spec, preview, executedAt) {
  return {
    entityType: "subscription",
    entityId: objectId(spec.subscriptionId),
    action: REPAIR_ACTION,
    byRole: "system",
    meta: {
      repairKey: REPAIR_KEY,
      subscriptionId: spec.subscriptionId,
      reversedActivityLogIds: spec.reversedActivityLogIds.map(objectId),
      restoredRegularMeals: spec.restoredRegularMeals,
      restoredPremiumMeals: spec.restoredPremiumMeals,
      releasedReservedMeals: preview.releasedReservedMeals,
      before: preview.before,
      after: preview.after,
      reason: spec.reason,
      correctionPeriod: CORRECTION_PERIOD,
      executedAt,
      scriptVersion: SCRIPT_VERSION,
    },
    createdAt: executedAt,
    updatedAt: executedAt,
  };
}

async function applyTarget(db, spec, preview, session, executedAt) {
  const releaseIds = (spec.releasedAllocationIds || []).map(objectId);
  const releasedReservedMeals = releaseIds.length;
  const increment = {
    remainingMeals: spec.restoredRegularMeals + spec.restoredPremiumMeals + releasedReservedMeals,
  };
  if (Number(preview.before.entitlementVersion || 0) >= 2) {
    increment.consumedMeals = -(spec.restoredRegularMeals + spec.restoredPremiumMeals);
    if (releasedReservedMeals) increment.reservedMeals = -releasedReservedMeals;
  }
  const update = { $inc: increment };
  const options = { session };
  if (releaseIds.length) {
    update.$set = {
      "baseMealAllocations.$[allocation].state": "released",
      "baseMealAllocations.$[allocation].releasedAt": executedAt,
    };
    options.arrayFilters = [{ "allocation._id": { $in: releaseIds }, "allocation.state": "reserved" }];
  }
  const result = await db.collection("subscriptions").updateOne(
    { _id: objectId(spec.subscriptionId) },
    update,
    options
  );
  if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
    throw new RepairPreconditionError(`Atomic subscription update failed for ${spec.key}`, [
      difference(`${spec.key}.updateResult`, { matchedCount: 1, modifiedCount: 1 }, result),
    ]);
  }
  await db.collection("activitylogs").insertOne(reversalLog(spec, preview, executedAt), { session });
}

async function validateAppliedTarget(db, spec, beforeScope, session) {
  const afterSubscription = await db.collection("subscriptions").findOne(
    { _id: objectId(spec.subscriptionId) },
    { session }
  );
  const after = walletSummary(afterSubscription);
  const differences = [];
  for (const [field, expected] of Object.entries(spec.expectedAfter || {})) {
    if (field === "netManualDeductions") continue;
    if (Number(after[field]) !== Number(expected)) {
      differences.push(difference(`${spec.key}.applied.${field}`, expected, after[field]));
    }
  }
  const releasedIds = new Set((spec.releasedAllocationIds || []).map(String));
  const allocations = (afterSubscription.baseMealAllocations || [])
    .filter((row) => releasedIds.has(String(row._id)));
  if (allocations.some((row) => row.state !== "released" || !row.releasedAt)) {
    differences.push(difference(
      `${spec.key}.applied.allocations`,
      "released with releasedAt",
      allocations.map((row) => ({ id: String(row._id), state: row.state, releasedAt: row.releasedAt }))
    ));
  }
  if (hash(afterSubscription.premiumBalance || []) !== hash(beforeScope.subscription.premiumBalance || [])) {
    differences.push(difference(`${spec.key}.premiumBalance`, "unchanged", "changed"));
  }
  if (hash(afterSubscription.addonBalance || []) !== hash(beforeScope.subscription.addonBalance || [])) {
    differences.push(difference(`${spec.key}.addonBalance`, "unchanged", "changed"));
  }
  assertNoDifferences(differences, `Applied result validation failed for ${spec.key}`);
}

async function runRepair({
  apply = false,
  confirmation = "",
  config = PRODUCTION_CONFIG,
  expectedDatabaseName = process.env.MONGO_DB || config.databaseName,
  faultInjectionStep = "",
} = {}) {
  if (!mongoose.connection.db) throw new Error("MongoDB connection is required");
  const db = mongoose.connection.db;
  const actualDatabaseName = db.databaseName;
  const databaseDifferences = [];
  if (actualDatabaseName !== config.databaseName) {
    databaseDifferences.push(difference("databaseName.config", config.databaseName, actualDatabaseName));
  }
  if (!expectedDatabaseName || actualDatabaseName !== expectedDatabaseName) {
    databaseDifferences.push(difference("databaseName.environment", expectedDatabaseName || "required", actualDatabaseName));
  }
  assertNoDifferences(databaseDifferences, "Database name verification failed");

  if (apply && confirmation !== REQUIRED_CONFIRMATION) {
    throw new RepairPreconditionError("Explicit production repair confirmation is missing or invalid", [
      difference("REPAIR_CONFIRMATION", REQUIRED_CONFIRMATION, confirmation || "missing"),
    ]);
  }

  const execute = async (session = null) => {
    await assertRepairKeyUnused(db, session);
    const targetScopes = new Map();
    const protectedScopes = new Map();
    const differences = [];

    for (const spec of config.targets) {
      const scope = await loadScope(db, spec, { session });
      targetScopes.set(spec.key, scope);
      differences.push(...validateTarget(spec, scope));
    }
    for (const spec of config.protected) {
      const scope = await loadScope(db, spec, { session });
      protectedScopes.set(spec.key, scope);
      differences.push(...validateScope(spec, scope));
    }
    assertNoDifferences(differences);

    const previews = config.targets.map((spec) => {
      const preview = previewTarget(spec, targetScopes.get(spec.key));
      assertNoDifferences(validatePreview(spec, preview), `Expected result validation failed for ${spec.key}`);
      return preview;
    });

    if (!apply) {
      return {
        ok: true,
        mode: "dry_run",
        repairKey: REPAIR_KEY,
        databaseName: actualDatabaseName,
        writes: 0,
        targets: previews,
        protected: config.protected.map((spec) => ({
          key: spec.key,
          subscriptionId: spec.subscriptionId,
          snapshotBefore: scopeHashes(protectedScopes.get(spec.key)),
          snapshotAfter: scopeHashes(protectedScopes.get(spec.key)),
          unchanged: true,
        })),
      };
    }

    const executedAt = new Date();
    for (let index = 0; index < config.targets.length; index += 1) {
      const spec = config.targets[index];
      await applyTarget(db, spec, previews[index], session, executedAt);
      if (faultInjectionStep === `after_target_${index + 1}`) {
        throw new Error(`Injected failure after target ${index + 1}`);
      }
    }

    for (const spec of config.targets) {
      await validateAppliedTarget(db, spec, targetScopes.get(spec.key), session);
    }
    for (const spec of config.protected) {
      const afterScope = await loadScope(db, spec, { session });
      const beforeHashes = scopeHashes(protectedScopes.get(spec.key));
      const afterHashes = scopeHashes(afterScope);
      if (hash(beforeHashes) !== hash(afterHashes)) {
        throw new RepairPreconditionError(`Protected subscription changed: ${spec.key}`, [
          difference(`${spec.key}.protectedSnapshot`, beforeHashes, afterHashes),
        ]);
      }
    }

    return {
      ok: true,
      mode: "apply",
      repairKey: REPAIR_KEY,
      databaseName: actualDatabaseName,
      targets: previews,
      protected: config.protected.map((spec) => ({
        key: spec.key,
        subscriptionId: spec.subscriptionId,
        unchanged: true,
      })),
    };
  };

  if (!apply) return execute(null);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await execute(session);
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function applyRequestedFromEnvironment() {
  const allow = process.env.ALLOW_PRODUCTION_REPAIR === "true";
  const confirmation = String(process.env.REPAIR_CONFIRMATION || "");
  if (allow !== Boolean(confirmation)) {
    throw new RepairPreconditionError(
      "ALLOW_PRODUCTION_REPAIR and REPAIR_CONFIRMATION must either both be absent (dry run) or both be supplied (apply)"
    );
  }
  return { apply: allow, confirmation };
}

async function main() {
  const mode = applyRequestedFromEnvironment();
  const uri = resolveMongoUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await runRepair(mode);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    const output = {
      ok: false,
      code: error && error.code || "REPAIR_FAILED",
      message: error && error.message || "Repair failed",
      differences: error && error.differences || [],
    };
    console.error(JSON.stringify(output, null, 2));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = {
  CORRECTION_PERIOD,
  PRODUCTION_CONFIG,
  REPAIR_ACTION,
  REPAIR_KEY,
  REQUIRED_CONFIRMATION,
  RepairPreconditionError,
  SCRIPT_VERSION,
  hash,
  loadScope,
  manualTotals,
  previewTarget,
  runRepair,
  scopeHashes,
  validatePreview,
  walletSummary,
};
