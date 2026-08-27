"use strict";

const crypto = require("node:crypto");
const Subscription = require("../models/Subscription");
const SubscriptionAuditLog = require("../models/SubscriptionAuditLog");
const SubscriptionEntitlementAllocation = require("../models/SubscriptionEntitlementAllocation");
const SubscriptionEntitlementBatch = require("../models/SubscriptionEntitlementBatch");
const SubscriptionQuickDayDeduction = require("../models/SubscriptionQuickDayDeduction");
const dateUtils = require("../utils/date");
const { getRestaurantBusinessDate } = require("./restaurantHoursService");
const { buildContainerMirror } = require("./subscription/subscriptionStackingActivationService");
const { buildAllocationKey } = require("./subscription/subscriptionEntitlementLedgerService");
const { resolveContainerLifecycleStatus } = require("./subscription/subscriptionStackingLifecycleService");
const quickService = require("./dashboard/subscriptionQuickDayDeductionService");
const {
  buildQuickDeductionBlueprint,
  buildRevisionHash,
} = require("./dashboard/subscriptionQuickDayDeductionLedgerAdapter");

const INSTALL_FLAG = Symbol.for("basicdiet.quickDayDeductionStandaloneFallback.installed");
const SOURCE = "pickup_quick_deduction";
const LEASE_MS = 30000;

function qerr(code, message, status = 409, details = {}) {
  return new quickService.QuickDayDeductionError(code, message, status, details);
}

function journalRows(batch) {
  return batch && batch.metadata && Array.isArray(batch.metadata.quickDayDeductions)
    ? batch.metadata.quickDayDeductions
    : [];
}

function findJournal(batch, key) {
  return journalRows(batch).find((row) => String(row && row.idempotencyKey || "") === String(key || "")) || null;
}

function assertJournal(journal, input) {
  if (!journal
    || String(journal.subscriptionId || "") !== String(input.subscriptionId)
    || String(journal.batchId || "") !== String(input.batchId)
    || Number(journal.days) !== Number(input.days)) {
    throw qerr("IDEMPOTENCY_KEY_CONFLICT", "Idempotency key was already used for a different quick deduction", 409);
  }
}

function serialize(operation, idempotent) {
  const row = operation && typeof operation.toObject === "function" ? operation.toObject() : operation || {};
  return {
    id: row._id ? String(row._id) : null,
    idempotent: Boolean(idempotent),
    source: row.source || SOURCE,
    subscriptionId: String(row.subscriptionId || ""),
    batchId: String(row.entitlementBatchId || ""),
    businessDate: row.businessDate || null,
    days: Number(row.days || 0),
    mealsPerDay: Number(row.mealsPerDay || 0),
    mealsDeducted: Number(row.mealsDeducted || 0),
    before: row.before || null,
    after: row.after || null,
    allocationKeys: Array.isArray(row.allocationKeys) ? row.allocationKeys : [],
    createdAt: row.createdAt || null,
  };
}

async function acquireLease(subscriptionId, key) {
  const now = new Date();
  const token = crypto.randomUUID();
  const leased = await Subscription.findOneAndUpdate(
    {
      _id: subscriptionId,
      status: "active",
      $or: [
        { "stackingActivationLease.expiresAt": null },
        { "stackingActivationLease.expiresAt": { $exists: false } },
        { "stackingActivationLease.expiresAt": { $lte: now } },
      ],
    },
    { $set: { stackingActivationLease: {
      token,
      sourceKey: `quick-deduction:${key}`,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + LEASE_MS),
    } } },
    { new: true }
  );
  if (!leased) throw qerr("QUICK_DEDUCTION_BUSY", "Another subscription update is already running for this customer", 409);
  return { subscriptionId: String(subscriptionId), token };
}

async function releaseLease(lease) {
  if (!lease) return;
  await Subscription.updateOne(
    { _id: lease.subscriptionId, "stackingActivationLease.token": lease.token },
    {
      $set: { stackingActivationLease: { token: "", sourceKey: "", acquiredAt: null, expiresAt: null } },
      $inc: { stackingRevision: 1 },
    }
  );
}

async function journalOwner(key) {
  return SubscriptionEntitlementBatch.findOne({ "metadata.quickDayDeductions.idempotencyKey": key }).lean();
}

function dateWindow(date) {
  const start = new Date(`${date}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 86400000 - 1) };
}

async function applyBatch(input, businessDate, mealsPerDay, mealsToDeduct, actorId, actorRole) {
  const existingOwner = await journalOwner(input.idempotencyKey);
  if (existingOwner) {
    const journal = findJournal(existingOwner, input.idempotencyKey);
    assertJournal(journal, input);
    return { batch: existingOwner, journal, idempotent: true };
  }

  const now = new Date();
  const window = dateWindow(businessDate);
  const batch = await SubscriptionEntitlementBatch.findOneAndUpdate(
    {
      _id: input.batchId,
      containerSubscriptionId: input.subscriptionId,
      applicationState: "applied",
      status: { $in: ["active", "paid_scheduled"] },
      effectiveStartDate: { $lte: window.end },
      validityEndDate: { $gte: window.start },
      remainingMeals: { $gte: mealsToDeduct },
      "metadata.quickDayDeductions.idempotencyKey": { $ne: input.idempotencyKey },
    },
    [
      { $set: { metadata: { $cond: [{ $eq: [{ $type: "$metadata" }, "object"] }, "$metadata", {}] } } },
      { $set: {
        "metadata.quickDayDeductions": { $concatArrays: [
          { $cond: [{ $isArray: "$metadata.quickDayDeductions" }, "$metadata.quickDayDeductions", []] },
          [{
            idempotencyKey: input.idempotencyKey,
            subscriptionId: input.subscriptionId,
            batchId: input.batchId,
            businessDate,
            days: input.days,
            mealsPerDay,
            mealsDeducted: mealsToDeduct,
            actorId: actorId ? String(actorId) : null,
            actorRole: String(actorRole || ""),
            beforeRemainingMeals: "$remainingMeals",
            beforeReservedMeals: { $ifNull: ["$reservedMeals", 0] },
            beforeConsumedMeals: { $ifNull: ["$consumedMeals", 0] },
            afterRemainingMeals: { $subtract: ["$remainingMeals", mealsToDeduct] },
            afterReservedMeals: { $ifNull: ["$reservedMeals", 0] },
            afterConsumedMeals: { $add: [{ $ifNull: ["$consumedMeals", 0] }, mealsToDeduct] },
            appliedAt: now,
          }],
        ] },
        remainingMeals: { $subtract: ["$remainingMeals", mealsToDeduct] },
        consumedMeals: { $add: [{ $ifNull: ["$consumedMeals", 0] }, mealsToDeduct] },
        stackVersion: { $add: [{ $ifNull: ["$stackVersion", 1] }, 1] },
      } },
      { $set: {
        status: { $cond: [{ $eq: ["$remainingMeals", 0] }, "exhausted", "active"] },
        exhaustedAt: { $cond: [{ $eq: ["$remainingMeals", 0] }, now, null] },
        activatedAt: { $cond: [
          { $and: [{ $gt: ["$remainingMeals", 0] }, { $eq: [{ $ifNull: ["$activatedAt", null] }, null] }] },
          now,
          "$activatedAt",
        ] },
      } },
    ],
    { new: true }
  ).lean();

  if (batch) return { batch, journal: findJournal(batch, input.idempotencyKey), idempotent: false };

  const current = await SubscriptionEntitlementBatch.findOne({
    _id: input.batchId,
    containerSubscriptionId: input.subscriptionId,
  }).lean();
  if (!current) throw qerr("ENTITLEMENT_BATCH_NOT_FOUND", "Entitlement batch does not belong to this subscription", 404);
  const journal = findJournal(current, input.idempotencyKey);
  if (journal) {
    assertJournal(journal, input);
    return { batch: current, journal, idempotent: true };
  }
  const start = dateUtils.toKSADateString(current.effectiveStartDate);
  const end = dateUtils.toKSADateString(current.validityEndDate || current.endDate);
  if (current.applicationState !== "applied"
    || !["active", "paid_scheduled"].includes(String(current.status || ""))
    || businessDate < start || businessDate > end) {
    throw qerr("ENTITLEMENT_BATCH_NOT_ELIGIBLE", "Entitlement batch is not eligible for pickup deduction today", 409, { businessDate, batchStatus: current.status });
  }
  if (Number(current.remainingMeals || 0) < mealsToDeduct) {
    throw qerr("INSUFFICIENT_BATCH_CREDITS", "Selected package does not have enough remaining meals", 422, {
      remainingMeals: Number(current.remainingMeals || 0), requestedMeals: mealsToDeduct,
    });
  }
  throw qerr("BATCH_BALANCE_CONFLICT", "Package balance changed while the deduction was being applied", 409);
}

async function ensureAllocations(subscription, batch, businessDate, mealsToDeduct, key) {
  const revision = buildRevisionHash(key);
  const blueprint = buildQuickDeductionBlueprint({ batch, businessDate, mealsToDeduct });
  const keys = [];
  for (const slot of blueprint.slots) {
    const allocationKey = buildAllocationKey({
      containerSubscriptionId: subscription._id,
      entitlementBatchId: batch._id,
      date: businessDate,
      slotKey: slot.slotKey,
      plannerRevisionHash: revision,
    });
    const payload = {
      allocationKey,
      userId: subscription.userId,
      containerSubscriptionId: subscription._id,
      entitlementBatchId: batch._id,
      date: businessDate,
      slotKey: slot.slotKey,
      plannerRevisionHash: revision,
      quantity: 1,
      proteinGrams: Number(batch.proteinGrams || 0),
      state: "consumed",
      parentAllocationKey: "",
      operationIdempotencyKey: `pickup-quick:${revision}:${slot.slotKey}`,
      paymentId: batch.paymentId || null,
      consumedAt: new Date(),
      metadata: { quickDayDeductionStandalone: true },
    };
    let row;
    try {
      row = await SubscriptionEntitlementAllocation.findOneAndUpdate(
        { allocationKey }, { $setOnInsert: payload }, { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();
    } catch (error) {
      if (!(error && error.code === 11000)) throw error;
      row = await SubscriptionEntitlementAllocation.findOne({ allocationKey }).lean();
    }
    if (!row
      || String(row.containerSubscriptionId) !== String(subscription._id)
      || String(row.entitlementBatchId) !== String(batch._id)
      || row.state !== "consumed"
      || row.date !== businessDate
      || row.slotKey !== slot.slotKey
      || String(row.plannerRevisionHash || "") !== revision) {
      throw qerr("STACKING_ALLOCATION_CONFLICT", "Quick deduction allocation changed concurrently", 409, { allocationKey });
    }
    keys.push(String(allocationKey));
  }
  return keys;
}

async function reconcile(subscriptionId, businessDate) {
  const container = await Subscription.findById(subscriptionId);
  if (!container || container.status === "canceled") throw qerr("SUBSCRIPTION_NOT_ACTIVE", "Active subscription not found", 404);
  const batches = await SubscriptionEntitlementBatch.find({ containerSubscriptionId: subscriptionId })
    .sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 }).lean();
  const mirror = buildContainerMirror({ container, batches, businessDate });
  const status = resolveContainerLifecycleStatus({ container, batches, businessDate });
  const updated = await Subscription.findOneAndUpdate(
    { _id: subscriptionId, status: { $ne: "canceled" } },
    { $set: { ...mirror, status } },
    { new: true }
  );
  if (!updated) throw qerr("STACKING_CONTAINER_UPDATE_CONFLICT", "Subscription changed while the deduction was being reconciled", 409);
  return { container: updated };
}

async function ensureAudit(subscription, lifecycle, batch, input, businessDate, mealsPerDay, mealsToDeduct, allocationKeys, before, after, actorId, actorRole) {
  const filter = {
    entityType: "subscription",
    entityId: subscription._id,
    action: "quick_day_deduction",
    "meta.idempotencyKey": input.idempotencyKey,
  };
  const existing = await SubscriptionAuditLog.findOne(filter).lean();
  if (existing) return existing;
  const [created] = await SubscriptionAuditLog.create([{
    entityType: "subscription",
    entityId: subscription._id,
    action: "quick_day_deduction",
    fromStatus: subscription.status,
    toStatus: lifecycle.container.status,
    actorType: String(actorRole || "admin"),
    actorId: actorId || undefined,
    note: SOURCE,
    meta: {
      source: SOURCE, standaloneFallback: true, idempotencyKey: input.idempotencyKey,
      businessDate, entitlementBatchId: String(batch._id), days: input.days,
      mealsPerDay, mealsDeducted: mealsToDeduct, allocationKeys, before, after,
    },
  }]);
  return created;
}

async function standalone(args) {
  const input = {
    subscriptionId: String(args.subscriptionId),
    batchId: String(args.batchId),
    days: Number(args.days),
    idempotencyKey: String(args.idempotencyKey || "").trim(),
  };
  const lease = await acquireLease(input.subscriptionId, input.idempotencyKey);
  try {
    const replay = await SubscriptionQuickDayDeduction.findOne({ idempotencyKey: input.idempotencyKey }).lean();
    if (replay) {
      if (String(replay.subscriptionId) !== input.subscriptionId
        || String(replay.entitlementBatchId) !== input.batchId
        || Number(replay.days) !== input.days) {
        throw qerr("IDEMPOTENCY_KEY_CONFLICT", "Idempotency key was already used for a different quick deduction", 409);
      }
      return serialize(replay, true);
    }

    const subscription = await Subscription.findOne({ _id: input.subscriptionId, status: "active" });
    if (!subscription) throw qerr("SUBSCRIPTION_NOT_ACTIVE", "Active subscription not found", 404);
    const businessDate = await getRestaurantBusinessDate();
    const owner = await journalOwner(input.idempotencyKey);

    let applied;
    let mealsPerDay;
    let mealsToDeduct;
    if (owner) {
      const journal = findJournal(owner, input.idempotencyKey);
      assertJournal(journal, input);
      mealsPerDay = Number(journal.mealsPerDay || 0);
      mealsToDeduct = Number(journal.mealsDeducted || 0);
      applied = { batch: owner, journal, idempotent: true };
    } else {
      const batch = await SubscriptionEntitlementBatch.findOne({
        _id: input.batchId, containerSubscriptionId: input.subscriptionId,
      }).lean();
      if (!batch) throw qerr("ENTITLEMENT_BATCH_NOT_FOUND", "Entitlement batch does not belong to this subscription", 404);
      const start = dateUtils.toKSADateString(batch.effectiveStartDate);
      const end = dateUtils.toKSADateString(batch.validityEndDate || batch.endDate);
      if (batch.applicationState !== "applied"
        || !["active", "paid_scheduled"].includes(String(batch.status || ""))
        || businessDate < start || businessDate > end) {
        throw qerr("ENTITLEMENT_BATCH_NOT_ELIGIBLE", "Entitlement batch is not eligible for pickup deduction today", 409, { businessDate, batchStatus: batch.status });
      }
      mealsPerDay = Number(batch.mealsPerDay || 0);
      if (!Number.isInteger(mealsPerDay) || mealsPerDay <= 0) throw qerr("INVALID_BATCH_MEALS_PER_DAY", "Batch meals-per-day is invalid", 409);
      mealsToDeduct = input.days * mealsPerDay;
      if (Number(batch.remainingMeals || 0) < mealsToDeduct) {
        throw qerr("INSUFFICIENT_BATCH_CREDITS", "Selected package does not have enough remaining meals", 422, {
          remainingMeals: Number(batch.remainingMeals || 0), requestedMeals: mealsToDeduct,
        });
      }
      applied = await applyBatch(input, businessDate, mealsPerDay, mealsToDeduct, args.actorId, args.actorRole);
    }

    const journal = applied.journal;
    const before = {
      remainingMeals: Number(journal.beforeRemainingMeals || 0),
      reservedMeals: Number(journal.beforeReservedMeals || 0),
      consumedMeals: Number(journal.beforeConsumedMeals || 0),
    };
    const allocationKeys = await ensureAllocations(subscription, applied.batch, businessDate, mealsToDeduct, input.idempotencyKey);
    const lifecycle = await reconcile(input.subscriptionId, businessDate);
    const after = {
      remainingMeals: Number(journal.afterRemainingMeals || 0),
      reservedMeals: Number(journal.afterReservedMeals || 0),
      consumedMeals: Number(journal.afterConsumedMeals || 0),
      subscriptionRemainingMeals: Number(lifecycle.container.remainingMeals || 0),
      subscriptionConsumedMeals: Number(lifecycle.container.consumedMeals || 0),
    };

    await ensureAudit(subscription, lifecycle, applied.batch, input, businessDate, mealsPerDay, mealsToDeduct, allocationKeys, before, after, args.actorId, args.actorRole);

    let operation;
    try {
      [operation] = await SubscriptionQuickDayDeduction.create([{
        idempotencyKey: input.idempotencyKey,
        subscriptionId: subscription._id,
        entitlementBatchId: applied.batch._id,
        targetType: "entitlement_batch",
        userId: subscription.userId,
        actorId: args.actorId || null,
        actorRole: String(args.actorRole || ""),
        source: SOURCE,
        businessDate,
        days: input.days,
        mealsPerDay,
        mealsDeducted: mealsToDeduct,
        allocationKeys,
        before,
        after,
      }]);
    } catch (error) {
      if (!(error && error.code === 11000)) throw error;
      operation = await SubscriptionQuickDayDeduction.findOne({ idempotencyKey: input.idempotencyKey }).lean();
      if (!operation) throw error;
    }
    return serialize(operation, applied.idempotent);
  } finally {
    await releaseLease(lease).catch(() => {});
  }
}

function install() {
  if (globalThis[INSTALL_FLAG]) return quickService;
  const original = quickService.deduct;
  quickService.deduct = async function deductWithStandaloneFallback(args) {
    try {
      return await original(args);
    } catch (error) {
      if (!error || error.code !== "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED") throw error;
      return standalone(args);
    }
  };
  globalThis[INSTALL_FLAG] = true;
  return quickService;
}

install();

module.exports = { install, standalone };
