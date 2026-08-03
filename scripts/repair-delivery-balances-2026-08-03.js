#!/usr/bin/env node
"use strict";

require("dotenv").config();

const crypto = require("crypto");
const mongoose = require("mongoose");

const { resolveMongoUri } = require("../src/utils/mongoUriResolver");

const REPAIR_KEY = "delivery-balance-repair-2026-08-03-v1";
const REPAIR_ACTION = "subscription_manual_deduction_reversal";
const REQUIRED_CONFIRMATION = "REPAIR_ROA_OSAMAH_2026_08_03";
const REQUIRED_STANDALONE_CONFIRMATION = "REPAIR_ROA_OSAMAH_STANDALONE_2026_08_03";
const SCRIPT_VERSION = "1.1.0";
const EXECUTION_MODES = Object.freeze({
  transaction: "transactional_repair",
  standalone: "standalone_resumable_repair",
});
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

function deterministicJournalId(subscriptionId) {
  const hex = crypto.createHash("sha256")
    .update(`${REPAIR_KEY}:${String(subscriptionId)}`)
    .digest("hex")
    .slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

async function detectTopology(db) {
  const hello = await db.admin().command({ hello: 1 });
  if (hello && hello.msg === "isdbgrid") return "mongos";
  if (hello && hello.setName) return "replica_set";
  return "standalone";
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
    _id: deterministicJournalId(spec.subscriptionId),
    entityType: "subscription",
    entityId: objectId(spec.subscriptionId),
    action: REPAIR_ACTION,
    byRole: "system",
    meta: {
      repairKey: REPAIR_KEY,
      targetKey: spec.key,
      status: "applied",
      subscriptionId: spec.subscriptionId,
      reversedActivityLogIds: spec.reversedActivityLogIds.map(objectId),
      restoredRegularMeals: spec.restoredRegularMeals,
      restoredPremiumMeals: spec.restoredPremiumMeals,
      releasedReservedMeals: preview.releasedReservedMeals,
      before: preview.before,
      expectedAfter: preview.after,
      after: preview.after,
      reason: spec.reason,
      correctionPeriod: CORRECTION_PERIOD,
      preparedAt: executedAt,
      appliedAt: executedAt,
      executedAt,
      scriptVersion: SCRIPT_VERSION,
      executionMode: "transaction",
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

function targetPreviewFromBefore(spec, scope, before) {
  const previewScope = {
    ...scope,
    subscription: { ...scope.subscription, ...before },
  };
  return previewTarget(spec, previewScope);
}

function repairJournalFilter(spec) {
  return { _id: deterministicJournalId(spec.subscriptionId) };
}

function withoutRepairJournals(scope) {
  return {
    ...scope,
    activityLogs: scope.activityLogs.filter((row) => row.action !== REPAIR_ACTION),
  };
}

function subscriptionInvariantHash(subscription) {
  const value = { ...(subscription || {}) };
  for (const field of [
    "remainingMeals",
    "reservedMeals",
    "consumedMeals",
    "updatedAt",
    "baseMealAllocations",
    "premiumBalance",
    "addonBalance",
  ]) delete value[field];
  return hash(value);
}

function targetAllocations(subscription, spec) {
  const ids = new Set((spec.releasedAllocationIds || []).map(String));
  return (Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((row) => ids.has(String(row && row._id)));
}

function journalPreflightSnapshot(spec, scope) {
  const subscription = scope.subscription;
  return {
    updatedAt: subscription.updatedAt || null,
    premiumBalance: subscription.premiumBalance || [],
    addonBalance: subscription.addonBalance || [],
    baseMealAllocations: subscription.baseMealAllocations || [],
    targetedBaseMealAllocations: targetAllocations(subscription, spec),
    subscriptionSnapshotHash: hash(subscription),
    subscriptionInvariantHash: subscriptionInvariantHash(subscription),
  };
}

function preparedJournal(spec, preview, scope, preparedAt) {
  return {
    _id: deterministicJournalId(spec.subscriptionId),
    entityType: "subscription",
    entityId: objectId(spec.subscriptionId),
    action: REPAIR_ACTION,
    byRole: "system",
    meta: {
      repairKey: REPAIR_KEY,
      targetKey: spec.key,
      status: "prepared",
      subscriptionId: spec.subscriptionId,
      reversedActivityLogIds: spec.reversedActivityLogIds.map(objectId),
      restoredRegularMeals: spec.restoredRegularMeals,
      restoredPremiumMeals: spec.restoredPremiumMeals,
      releasedReservedMeals: preview.releasedReservedMeals,
      before: preview.before,
      expectedAfter: preview.after,
      reason: spec.reason,
      correctionPeriod: CORRECTION_PERIOD,
      scriptVersion: SCRIPT_VERSION,
      preparedAt,
      appliedAt: null,
      after: null,
      executionMode: "standalone_resumable",
      preflight: journalPreflightSnapshot(spec, scope),
    },
    createdAt: preparedAt,
    updatedAt: preparedAt,
  };
}

function journalDifferences(spec, journal, preview) {
  const differences = [];
  const meta = journal && journal.meta || {};
  const expected = {
    id: String(deterministicJournalId(spec.subscriptionId)),
    entityType: "subscription",
    entityId: spec.subscriptionId,
    action: REPAIR_ACTION,
    repairKey: REPAIR_KEY,
    targetKey: spec.key,
    subscriptionId: spec.subscriptionId,
    reversedActivityLogIds: spec.reversedActivityLogIds.map(String),
    restoredRegularMeals: spec.restoredRegularMeals,
    restoredPremiumMeals: spec.restoredPremiumMeals,
    releasedReservedMeals: preview.releasedReservedMeals,
    before: preview.before,
    expectedAfter: preview.after,
    reason: spec.reason,
    correctionPeriod: CORRECTION_PERIOD,
    scriptVersion: SCRIPT_VERSION,
    executionMode: "standalone_resumable",
  };
  const actual = {
    id: String(journal && journal._id || ""),
    entityType: journal && journal.entityType,
    entityId: String(journal && journal.entityId || ""),
    action: journal && journal.action,
    repairKey: meta.repairKey,
    targetKey: meta.targetKey,
    subscriptionId: String(meta.subscriptionId || ""),
    reversedActivityLogIds: (meta.reversedActivityLogIds || []).map(String),
    restoredRegularMeals: Number(meta.restoredRegularMeals || 0),
    restoredPremiumMeals: Number(meta.restoredPremiumMeals || 0),
    releasedReservedMeals: Number(meta.releasedReservedMeals || 0),
    before: meta.before,
    expectedAfter: meta.expectedAfter,
    reason: meta.reason,
    correctionPeriod: meta.correctionPeriod,
    scriptVersion: meta.scriptVersion,
    executionMode: meta.executionMode,
  };
  if (hash(actual) !== hash(expected)) {
    differences.push(difference(`${spec.key}.journal`, expected, actual));
  }
  if (!['prepared', 'applied'].includes(String(meta.status || ""))) {
    differences.push(difference(`${spec.key}.journal.status`, ["prepared", "applied"], meta.status));
  }
  if (!meta.preparedAt) differences.push(difference(`${spec.key}.journal.preparedAt`, "present", meta.preparedAt));
  if (!meta.preflight || !meta.preflight.updatedAt) {
    differences.push(difference(`${spec.key}.journal.preflight`, "complete", meta.preflight || null));
  }
  return differences;
}

function staticTargetDifferences(spec, scope) {
  const differences = [];
  const baselineScope = withoutRepairJournals(scope);
  if (!scope.subscription) return [difference(`${spec.key}.subscription`, "present", "missing")];
  if (!scope.user) differences.push(difference(`${spec.key}.user`, "present", "missing"));
  if (String(scope.subscription.userId) !== String(spec.userId)) {
    differences.push(difference(`${spec.key}.userId`, spec.userId, scope.subscription.userId));
  }
  if (String(scope.user && scope.user.name || "").trim() !== spec.expectedName) {
    differences.push(difference(`${spec.key}.name`, spec.expectedName, scope.user && scope.user.name));
  }
  if (scope.user && identityHash(scope.user) !== spec.identityHash) {
    differences.push(difference(`${spec.key}.identityHash`, spec.identityHash, identityHash(scope.user)));
  }
  for (const field of ["activityLogs", "days", "deliveries"]) {
    const actual = scopeHashes(baselineScope)[field];
    if (spec.expectedSnapshotHashes && actual !== spec.expectedSnapshotHashes[field]) {
      differences.push(difference(`${spec.key}.snapshot.${field}`, spec.expectedSnapshotHashes[field], actual));
    }
  }
  const manualLogs = baselineScope.activityLogs
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
  return differences;
}

function expectedReleasedAllocations(journal, spec) {
  const preparedAt = new Date(journal.meta.preparedAt);
  const releaseIds = new Set((spec.releasedAllocationIds || []).map(String));
  return (journal.meta.preflight.baseMealAllocations || []).map((row) => {
    if (!releaseIds.has(String(row && row._id))) return row;
    return { ...row, state: "released", releasedAt: preparedAt };
  });
}

function targetStateDetails(spec, scope, preview, journal) {
  const beforeDifferences = [];
  const afterDifferences = [];
  const subscription = scope.subscription || {};
  const wallet = walletSummary(subscription);
  const preflight = journal && journal.meta && journal.meta.preflight;

  if (!journal) {
    beforeDifferences.push(...validateTarget(spec, scope));
    return {
      state: beforeDifferences.length ? "inconsistent" : "before",
      beforeDifferences,
      afterDifferences: [],
    };
  }

  if (!preflight) {
    return {
      state: "inconsistent",
      beforeDifferences: [difference(`${spec.key}.journal.preflight`, "complete", null)],
      afterDifferences: [difference(`${spec.key}.journal.preflight`, "complete", null)],
    };
  }

  for (const [field, expected] of Object.entries(preview.before)) {
    if (Number(wallet[field]) !== Number(expected)) {
      beforeDifferences.push(difference(`${spec.key}.before.${field}`, expected, wallet[field]));
    }
  }
  if (hash(subscription) !== preflight.subscriptionSnapshotHash) {
    beforeDifferences.push(difference(
      `${spec.key}.before.subscriptionSnapshotHash`,
      preflight.subscriptionSnapshotHash,
      hash(subscription)
    ));
  }

  for (const [field, expected] of Object.entries(preview.after)) {
    if (Number(wallet[field]) !== Number(expected)) {
      afterDifferences.push(difference(`${spec.key}.after.${field}`, expected, wallet[field]));
    }
  }
  if (subscriptionInvariantHash(subscription) !== preflight.subscriptionInvariantHash) {
    afterDifferences.push(difference(
      `${spec.key}.after.subscriptionInvariantHash`,
      preflight.subscriptionInvariantHash,
      subscriptionInvariantHash(subscription)
    ));
  }
  if (hash(subscription.premiumBalance || []) !== hash(preflight.premiumBalance || [])) {
    afterDifferences.push(difference(`${spec.key}.after.premiumBalance`, "unchanged", "changed"));
  }
  if (hash(subscription.addonBalance || []) !== hash(preflight.addonBalance || [])) {
    afterDifferences.push(difference(`${spec.key}.after.addonBalance`, "unchanged", "changed"));
  }
  if (hash(subscription.baseMealAllocations || []) !== hash(expectedReleasedAllocations(journal, spec))) {
    afterDifferences.push(difference(`${spec.key}.after.baseMealAllocations`, "expected released allocation state", "changed"));
  }
  if (hash(subscription.updatedAt || null) !== hash(journal.meta.preparedAt || null)) {
    afterDifferences.push(difference(`${spec.key}.after.updatedAt`, journal.meta.preparedAt, subscription.updatedAt));
  }

  if (!beforeDifferences.length) return { state: "before", beforeDifferences, afterDifferences };
  if (!afterDifferences.length) return { state: "after", beforeDifferences, afterDifferences };
  return { state: "inconsistent", beforeDifferences, afterDifferences };
}

async function assertProtectedScopes(db, config, stage) {
  const snapshots = {};
  const differences = [];
  for (const spec of config.protected) {
    const scope = await loadScope(db, spec);
    differences.push(...validateScope(spec, scope));
    snapshots[spec.key] = scopeHashes(scope);
  }
  assertNoDifferences(differences, `Protected subscription verification failed at ${stage}`);
  return snapshots;
}

async function standaloneGlobalPreflight(db, config) {
  const deterministicIds = config.targets.map((spec) => deterministicJournalId(spec.subscriptionId));
  const [journalsById, journalsByRepairKey] = await Promise.all([
    db.collection("activitylogs").find({ _id: { $in: deterministicIds } }).toArray(),
    db.collection("activitylogs").find({
      entityType: "subscription",
      action: REPAIR_ACTION,
      "meta.repairKey": REPAIR_KEY,
    }).toArray(),
  ]);
  const expectedIdSet = new Set(deterministicIds.map(String));
  const differences = [];
  for (const journal of journalsByRepairKey) {
    if (!expectedIdSet.has(String(journal._id))) {
      differences.push(difference("repairJournals.unexpectedId", [...expectedIdSet], String(journal._id)));
    }
  }
  for (const journal of journalsById) {
    if (journal.meta && journal.meta.repairKey !== REPAIR_KEY) {
      differences.push(difference(`repairJournals.${journal._id}.repairKey`, REPAIR_KEY, journal.meta.repairKey));
    }
  }

  const journals = new Map(journalsById.map((row) => [String(row._id), row]));
  const contexts = new Map();
  for (const spec of config.targets) {
    const scope = await loadScope(db, spec);
    differences.push(...staticTargetDifferences(spec, scope));
    const journal = journals.get(String(deterministicJournalId(spec.subscriptionId))) || null;
    const before = journal && journal.meta && journal.meta.before
      ? journal.meta.before
      : walletSummary(scope.subscription);
    const preview = targetPreviewFromBefore(spec, scope, before);
    differences.push(...validatePreview(spec, preview));
    if (journal) differences.push(...journalDifferences(spec, journal, preview));
    const state = targetStateDetails(spec, scope, preview, journal);
    if (state.state === "inconsistent") {
      differences.push(difference(
        `${spec.key}.subscriptionState`,
        "exact before or expected after",
        { beforeDifferences: state.beforeDifferences, afterDifferences: state.afterDifferences }
      ));
    }
    if (journal && journal.meta.status === "applied" && state.state !== "after") {
      differences.push(difference(`${spec.key}.stateMachine`, "journal applied + subscription after", {
        journalStatus: journal.meta.status,
        subscriptionState: state.state,
      }));
    }
    contexts.set(spec.key, { spec, scope, journal, preview, state: state.state });
  }

  const protectedSnapshots = await assertProtectedScopes(db, config, "global_preflight");
  assertNoDifferences(differences, "Standalone global preflight failed");
  return { contexts, protectedSnapshots };
}

async function prepareStandaloneJournal(db, context) {
  if (context.journal) return { journal: context.journal, created: false };
  const preparedAt = new Date();
  const document = preparedJournal(context.spec, context.preview, context.scope, preparedAt);
  try {
    await db.collection("activitylogs").insertOne(document);
    return { journal: document, created: true };
  } catch (error) {
    if (!(error && error.code === 11000)) throw error;
    const existing = await db.collection("activitylogs").findOne(repairJournalFilter(context.spec));
    const differences = journalDifferences(context.spec, existing, context.preview);
    assertNoDifferences(differences, `Existing deterministic journal does not match for ${context.spec.key}`);
    return { journal: existing, created: false };
  }
}

function standaloneCasFilter(context) {
  const { spec, journal, preview } = context;
  const preflight = journal.meta.preflight;
  const before = preview.before;
  const filter = {
    _id: objectId(spec.subscriptionId),
    totalMeals: before.totalMeals,
    selectedMealsPerDay: before.selectedMealsPerDay,
    remainingMeals: before.remainingMeals,
    updatedAt: preflight.updatedAt,
    premiumBalance: preflight.premiumBalance || [],
    addonBalance: preflight.addonBalance || [],
  };
  if (Number(before.entitlementVersion || 0) >= 2) {
    for (const field of ["reservedMeals", "consumedMeals", "forfeitedMeals", "entitlementVersion"]) {
      filter[field] = before[field];
    }
  }
  const targeted = preflight.targetedBaseMealAllocations || [];
  if (targeted.length) {
    filter.$and = targeted.map((row) => ({
      baseMealAllocations: {
        $elemMatch: {
          _id: row._id,
          date: row.date,
          state: "reserved",
          quantity: 1,
        },
      },
    }));
  }
  return filter;
}

function standaloneCasUpdate(context) {
  const { spec, journal, preview } = context;
  const set = {
    remainingMeals: preview.after.remainingMeals,
    updatedAt: new Date(journal.meta.preparedAt),
  };
  if (Number(preview.before.entitlementVersion || 0) >= 2) {
    set.reservedMeals = preview.after.reservedMeals;
    set.consumedMeals = preview.after.consumedMeals;
  }
  const update = { $set: set };
  const options = {};
  const releaseIds = (spec.releasedAllocationIds || []).map(objectId);
  if (releaseIds.length) {
    set["baseMealAllocations.$[allocation].state"] = "released";
    set["baseMealAllocations.$[allocation].releasedAt"] = new Date(journal.meta.preparedAt);
    options.arrayFilters = [{
      "allocation._id": { $in: releaseIds },
      "allocation.state": "reserved",
      "allocation.quantity": 1,
    }];
  }
  return { update, options };
}

async function finalizeStandaloneJournal(db, context, afterScope) {
  const appliedAt = new Date();
  const result = await db.collection("activitylogs").updateOne(
    { _id: context.journal._id, "meta.status": "prepared" },
    {
      $set: {
        "meta.status": "applied",
        "meta.appliedAt": appliedAt,
        "meta.after": walletSummary(afterScope.subscription),
        "meta.afterSnapshotHash": hash(afterScope.subscription),
        updatedAt: appliedAt,
      },
    }
  );
  if (result.matchedCount === 1 && result.modifiedCount === 1) {
    context.journal.meta.status = "applied";
    context.journal.meta.appliedAt = appliedAt;
    return true;
  }
  const current = await db.collection("activitylogs").findOne({ _id: context.journal._id });
  if (current && current.meta && current.meta.status === "applied") {
    context.journal = current;
    return false;
  }
  throw new RepairPreconditionError(`Journal finalization failed for ${context.spec.key}`, [
    difference(`${context.spec.key}.journalFinalize`, { matchedCount: 1, modifiedCount: 1 }, result),
  ]);
}

async function applyStandaloneTarget(db, context, config, { faultInjectionStep = "", beforeTargetApply = null } = {}) {
  const { spec, preview } = context;
  const actionsPerformed = [];
  await assertProtectedScopes(db, config, `before_${spec.key}`);
  let scope = await loadScope(db, spec);
  let state = targetStateDetails(spec, scope, preview, context.journal);
  assertNoDifferences(
    state.state === "inconsistent" ? [difference(`${spec.key}.state`, "before or after", state)] : [],
    `Standalone target state is inconsistent for ${spec.key}`
  );
  const stateBefore = `${context.journal.meta.status}_${state.state}`;

  if (context.journal.meta.status === "applied") {
    if (state.state !== "after") {
      throw new RepairPreconditionError(`Critical journal/subscription inconsistency for ${spec.key}`, [
        difference(`${spec.key}.stateMachine`, "applied_after", stateBefore),
      ]);
    }
    actionsPerformed.push("already_applied_noop");
  } else if (state.state === "after") {
    const finalized = await finalizeStandaloneJournal(db, context, scope);
    actionsPerformed.push(finalized ? "journal_finalized_recovery" : "already_finalized_noop");
  } else {
    if (typeof beforeTargetApply === "function") await beforeTargetApply({ db, context });
    const { update, options } = standaloneCasUpdate(context);
    const result = await db.collection("subscriptions").updateOne(
      standaloneCasFilter(context),
      update,
      options
    );
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
      scope = await loadScope(db, spec);
      state = targetStateDetails(spec, scope, preview, context.journal);
      if (state.state !== "after") {
        throw new RepairPreconditionError(`Standalone compare-and-set failed for ${spec.key}`, [
          difference(`${spec.key}.casResult`, { matchedCount: 1, modifiedCount: 1 }, result),
          difference(`${spec.key}.stateAfterCasFailure`, "expected after for recovery", state),
        ]);
      }
      actionsPerformed.push("subscription_already_updated_recovery");
    } else {
      actionsPerformed.push("subscription_updated_cas");
    }
    if (faultInjectionStep === `after_${spec.key}_subscription_update`) {
      throw new Error(`Injected failure after ${spec.key} subscription update`);
    }
    scope = await loadScope(db, spec);
    state = targetStateDetails(spec, scope, preview, context.journal);
    assertNoDifferences(
      state.state === "after" ? [] : [difference(`${spec.key}.appliedState`, "after", state)],
      `Standalone applied result validation failed for ${spec.key}`
    );
    const finalized = await finalizeStandaloneJournal(db, context, scope);
    actionsPerformed.push(finalized ? "journal_finalized" : "already_finalized_noop");
  }

  if (faultInjectionStep === `after_${spec.key}_finalize`) {
    throw new Error(`Injected failure after ${spec.key} finalize`);
  }
  const protectedAfter = await assertProtectedScopes(db, config, `after_${spec.key}`);
  const finalScope = await loadScope(db, spec);
  const finalState = targetStateDetails(spec, finalScope, preview, context.journal);
  assertNoDifferences(
    finalState.state === "after" ? [] : [difference(`${spec.key}.finalState`, "after", finalState)],
    `Standalone final state validation failed for ${spec.key}`
  );
  return {
    stateBefore,
    actionsPerformed,
    stateAfter: "applied_after",
    journalId: String(context.journal._id),
    before: preview.before,
    after: walletSummary(finalScope.subscription),
    protectedAfter,
  };
}

async function runStandaloneRepair({ db, apply, config, faultInjectionStep, beforeTargetApply }) {
  const preflight = await standaloneGlobalPreflight(db, config);
  const deterministicJournalIds = Object.fromEntries(config.targets.map((spec) => [
    spec.key,
    String(deterministicJournalId(spec.subscriptionId)),
  ]));
  if (!apply) {
    return {
      ok: true,
      mode: "dry_run",
      topology: "standalone",
      databaseName: db.databaseName,
      repairKey: REPAIR_KEY,
      writes: 0,
      executionPlan: EXECUTION_MODES.standalone,
      deterministicJournalIds,
      targetStates: Object.fromEntries([...preflight.contexts].map(([key, context]) => [
        key,
        context.journal ? `${context.journal.meta.status}_${context.state}` : context.state,
      ])),
      targets: [...preflight.contexts.values()].map((context) => ({
        ...context.preview,
        journalId: deterministicJournalIds[context.spec.key],
      })),
      protected: config.protected.map((spec) => ({
        key: spec.key,
        subscriptionId: spec.subscriptionId,
        snapshotBefore: preflight.protectedSnapshots[spec.key],
        snapshotAfter: preflight.protectedSnapshots[spec.key],
        unchanged: true,
      })),
    };
  }

  const prepareActions = {};
  for (const spec of config.targets) {
    const context = preflight.contexts.get(spec.key);
    const prepared = await prepareStandaloneJournal(db, context);
    context.journal = prepared.journal;
    prepareActions[spec.key] = prepared.created ? "journal_prepared" : "journal_reused";
    if (faultInjectionStep === "after_prepare_roa" && spec.key === "roa") {
      throw new Error("Injected failure after preparing Roa journal");
    }
  }
  if (faultInjectionStep === "after_prepare_all") {
    throw new Error("Injected failure after preparing all journals");
  }

  const targets = {};
  try {
    for (const spec of config.targets) {
      const context = preflight.contexts.get(spec.key);
      const result = await applyStandaloneTarget(db, context, config, {
        faultInjectionStep,
        beforeTargetApply,
      });
      result.actionsPerformed.unshift(prepareActions[spec.key]);
      targets[spec.key] = result;
    }
  } catch (error) {
    const targetStates = {};
    for (const spec of config.targets) {
      const context = preflight.contexts.get(spec.key);
      const journal = await db.collection("activitylogs").findOne(repairJournalFilter(spec));
      const scope = await loadScope(db, spec);
      const state = targetStateDetails(spec, scope, context.preview, journal);
      targetStates[spec.key] = {
        journalStatus: journal && journal.meta && journal.meta.status || "missing",
        subscriptionState: state.state,
        result: targets[spec.key] || null,
      };
    }
    error.resumable = true;
    error.executionPlan = EXECUTION_MODES.standalone;
    error.targetStates = targetStates;
    throw error;
  }
  const protectedSnapshots = await assertProtectedScopes(db, config, "final");
  return {
    ok: true,
    mode: "standalone_apply",
    topology: "standalone",
    databaseName: db.databaseName,
    repairKey: REPAIR_KEY,
    executionPlan: EXECUTION_MODES.standalone,
    resumable: true,
    deterministicJournalIds,
    targets,
    protected: config.protected.map((spec) => ({
      key: spec.key,
      subscriptionId: spec.subscriptionId,
      snapshotAfter: protectedSnapshots[spec.key],
      unchanged: true,
    })),
  };
}

async function runRepair({
  apply = false,
  confirmation = "",
  allowStandalone = false,
  config = PRODUCTION_CONFIG,
  expectedDatabaseName = process.env.MONGO_DB || config.databaseName,
  faultInjectionStep = "",
  beforeTargetApply = null,
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

  const topology = await detectTopology(db);
  if (topology === "standalone") {
    if (apply && !allowStandalone) {
      const error = new RepairPreconditionError(
        "Standalone MongoDB apply requires ALLOW_STANDALONE_REPAIR=true",
        [difference("topology", "replica_set or mongos, or explicit standalone authorization", topology)]
      );
      error.topology = topology;
      throw error;
    }
    if (apply && confirmation !== REQUIRED_STANDALONE_CONFIRMATION) {
      const error = new RepairPreconditionError("Explicit standalone repair confirmation is missing or invalid", [
        difference("REPAIR_CONFIRMATION", REQUIRED_STANDALONE_CONFIRMATION, confirmation || "missing"),
      ]);
      error.topology = topology;
      throw error;
    }
    try {
      return await runStandaloneRepair({ db, apply, config, faultInjectionStep, beforeTargetApply });
    } catch (error) {
      error.topology = topology;
      throw error;
    }
  }

  if (apply && confirmation !== REQUIRED_CONFIRMATION) {
    const error = new RepairPreconditionError("Explicit production repair confirmation is missing or invalid", [
      difference("REPAIR_CONFIRMATION", REQUIRED_CONFIRMATION, confirmation || "missing"),
    ]);
    error.topology = topology;
    throw error;
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
        topology,
        repairKey: REPAIR_KEY,
        databaseName: actualDatabaseName,
        writes: 0,
        executionPlan: EXECUTION_MODES.transaction,
        deterministicJournalIds: Object.fromEntries(config.targets.map((spec) => [
          spec.key,
          String(deterministicJournalId(spec.subscriptionId)),
        ])),
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
      topology,
      repairKey: REPAIR_KEY,
      databaseName: actualDatabaseName,
      executionPlan: EXECUTION_MODES.transaction,
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
  const allowStandalone = process.env.ALLOW_STANDALONE_REPAIR === "true";
  const confirmation = String(process.env.REPAIR_CONFIRMATION || "");
  if (allow !== Boolean(confirmation)) {
    throw new RepairPreconditionError(
      "ALLOW_PRODUCTION_REPAIR and REPAIR_CONFIRMATION must either both be absent (dry run) or both be supplied (apply)"
    );
  }
  if (allowStandalone && !allow) {
    throw new RepairPreconditionError(
      "ALLOW_STANDALONE_REPAIR requires ALLOW_PRODUCTION_REPAIR=true and explicit confirmation"
    );
  }
  return { apply: allow, allowStandalone, confirmation };
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
      topology: error && error.topology || undefined,
      executionPlan: error && error.executionPlan || undefined,
      resumable: error && error.resumable || undefined,
      targetStates: error && error.targetStates || undefined,
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
  REQUIRED_STANDALONE_CONFIRMATION,
  RepairPreconditionError,
  SCRIPT_VERSION,
  detectTopology,
  deterministicJournalId,
  hash,
  loadScope,
  manualTotals,
  previewTarget,
  runRepair,
  scopeHashes,
  validatePreview,
  walletSummary,
};
