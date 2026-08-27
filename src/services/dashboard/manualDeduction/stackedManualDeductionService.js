"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");
const ActivityLog = require("../../../models/ActivityLog");
const Subscription = require("../../../models/Subscription");
const SubscriptionEntitlementBatch = require("../../../models/SubscriptionEntitlementBatch");
const SubscriptionExtraEntitlementBucket = require("../../../models/SubscriptionExtraEntitlementBucket");
const { buildContainerMirror } = require("../../subscription/subscriptionStackingActivationService");
const {
  buildPremiumAllocation,
  resolveAddonBalances,
  resolveBalances,
  validateBalances,
  validateSubscriptionCanDeduct,
} = require("./manualDeductionPolicy");
const {
  buildDeductionLog,
  buildDeductionResponse,
} = require("./manualDeductionPresenter");
const { ManualDeductionError } = require("./ManualDeductionError");
const { MANUAL_DEDUCTION_ACTION } = require("./constants");

const LEASE_MS = 30000;
const JOURNAL_KEY = "manualDeductions";
const PARENT_OPERATION_FIELD = "legacyMealBalanceOperationKeys";

function manualError(code, message, status = 409, details = {}) {
  return new ManualDeductionError(code, message, status, details);
}

function asInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeKey(value) {
  const key = String(value || "").trim();
  return key || `manual-${crypto.randomUUID()}`;
}

function fingerprintRequest({ subscriptionId, counts, reason, notes }) {
  const addons = (Array.isArray(counts.addons) ? counts.addons : [])
    .map((row) => ({ addonId: String(row.addonId), qty: asInt(row.qty) }))
    .sort((a, b) => a.addonId.localeCompare(b.addonId));
  return crypto.createHash("sha256").update(JSON.stringify({
    subscriptionId: String(subscriptionId),
    regularMeals: asInt(counts.regularMeals),
    premiumMeals: asInt(counts.premiumMeals),
    addons,
    reason: String(reason || ""),
    notes: String(notes || ""),
  })).digest("hex");
}

function parentOperationKey(idempotencyKey) {
  return `manual-deduction:${idempotencyKey}`;
}

function operationObjectId(subscriptionId, idempotencyKey) {
  const hex = crypto.createHash("sha256")
    .update(`${subscriptionId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

function journalRows(document) {
  const metadata = document && document.metadata && typeof document.metadata === "object"
    ? document.metadata
    : {};
  return Array.isArray(metadata[JOURNAL_KEY]) ? metadata[JOURNAL_KEY] : [];
}

function journalFor(document, idempotencyKey) {
  return journalRows(document).find((row) => (
    String(row && row.idempotencyKey || "") === String(idempotencyKey)
  )) || null;
}

function assertJournal(journal, fingerprint) {
  if (!journal || String(journal.fingerprint || "") !== String(fingerprint || "")) {
    throw manualError(
      "IDEMPOTENCY_KEY_CONFLICT",
      "Idempotency key was already used for a different manual deduction",
      409
    );
  }
}

function dateWindow(businessDate) {
  const start = new Date(`${businessDate}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 86400000 - 1) };
}

async function acquireLease(subscriptionId, idempotencyKey) {
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
    {
      $set: {
        stackingActivationLease: {
          token,
          sourceKey: `manual-deduction:${idempotencyKey}`,
          acquiredAt: now,
          expiresAt: new Date(now.getTime() + LEASE_MS),
        },
      },
    },
    { new: true }
  );
  if (!leased) {
    throw manualError(
      "SUBSCRIPTION_UPDATE_BUSY",
      "Another subscription update is already running for this customer",
      409
    );
  }
  return { subscriptionId: String(subscriptionId), token };
}

async function releaseLease(lease) {
  if (!lease) return;
  await Subscription.updateOne(
    { _id: lease.subscriptionId, "stackingActivationLease.token": lease.token },
    {
      $set: {
        stackingActivationLease: {
          token: "",
          sourceKey: "",
          acquiredAt: null,
          expiresAt: null,
        },
      },
      $inc: { stackingRevision: 1 },
    }
  );
}

async function hasEntitlementBatches(subscriptionId) {
  return Boolean(await SubscriptionEntitlementBatch.exists({
    containerSubscriptionId: subscriptionId,
    applicationState: "applied",
  }));
}

function buildPendingMeta({ subscription, counts, before, businessDate, idempotencyKey, fingerprint, actorId, actorRole, reason, notes }) {
  return {
    status: "applying",
    idempotencyKey,
    fingerprint,
    businessDate,
    subscriptionId: String(subscription._id),
    customerId: String(subscription.userId),
    deductedRegularMeals: counts.regularMeals,
    deductedPremiumMeals: counts.premiumMeals,
    deductedTotalMeals: counts.total,
    requestedAddons: counts.addons,
    beforeSnapshot: before,
    actorId: actorId ? String(actorId) : null,
    actorRole,
    reason: String(reason || ""),
    notes: String(notes || ""),
    fulfillmentMethod: subscription.deliveryMode === "pickup" ? "pickup" : "delivery",
    isPickup: subscription.deliveryMode === "pickup",
    isDelivery: subscription.deliveryMode === "delivery",
  };
}

async function reserveOperation({ subscription, counts, before, businessDate, idempotencyKey, fingerprint, actorId, actorRole, reason, notes }) {
  const _id = operationObjectId(subscription._id, idempotencyKey);
  let operation = await ActivityLog.findById(_id).lean();
  if (operation) {
    const meta = operation.meta || {};
    if (String(meta.fingerprint || "") !== fingerprint) {
      throw manualError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "Idempotency key was already used for a different manual deduction",
        409
      );
    }
    return { operation, existing: true };
  }

  try {
    [operation] = await ActivityLog.create([{
      _id,
      entityType: "subscription",
      entityId: subscription._id,
      action: MANUAL_DEDUCTION_ACTION,
      byUserId: actorId,
      byRole: actorRole,
      meta: buildPendingMeta({
        subscription,
        counts,
        before,
        businessDate,
        idempotencyKey,
        fingerprint,
        actorId,
        actorRole,
        reason,
        notes,
      }),
    }]);
    return { operation, existing: false };
  } catch (error) {
    if (!(error && error.code === 11000)) throw error;
    operation = await ActivityLog.findById(_id).lean();
    if (operation) {
      const meta = operation.meta || {};
      if (String(meta.fingerprint || "") !== fingerprint) {
        throw manualError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "Idempotency key was already used for a different manual deduction",
          409
        );
      }
      return { operation, existing: true };
    }
    throw manualError(
      "DELIVERY_ALREADY_DEDUCTED_TODAY",
      "Delivery subscription already deducted today",
      409
    );
  }
}

async function applyBatchDebit({ batch, quantity, idempotencyKey, fingerprint, businessDate, actorId, actorRole }) {
  if (quantity <= 0) return batch;
  const existing = journalFor(batch, idempotencyKey);
  if (existing) {
    assertJournal(existing, fingerprint);
    return batch;
  }

  const now = new Date();
  const updated = await SubscriptionEntitlementBatch.findOneAndUpdate(
    {
      _id: batch._id,
      containerSubscriptionId: batch.containerSubscriptionId,
      applicationState: "applied",
      status: { $in: ["active", "paid_scheduled"] },
      remainingMeals: { $gte: quantity },
      [`metadata.${JOURNAL_KEY}.idempotencyKey`]: { $ne: idempotencyKey },
    },
    [
      {
        $set: {
          metadata: {
            $cond: [{ $eq: [{ $type: "$metadata" }, "object"] }, "$metadata", {}],
          },
        },
      },
      {
        $set: {
          [`metadata.${JOURNAL_KEY}`]: {
            $concatArrays: [
              {
                $cond: [
                  { $isArray: `$metadata.${JOURNAL_KEY}` },
                  `$metadata.${JOURNAL_KEY}`,
                  [],
                ],
              },
              [{
                idempotencyKey,
                fingerprint,
                kind: "base_meal",
                quantity,
                businessDate,
                actorId: actorId ? String(actorId) : null,
                actorRole: String(actorRole || ""),
                appliedAt: now,
              }],
            ],
          },
          remainingMeals: { $subtract: ["$remainingMeals", quantity] },
          consumedMeals: { $add: [{ $ifNull: ["$consumedMeals", 0] }, quantity] },
          stackVersion: { $add: [{ $ifNull: ["$stackVersion", 1] }, 1] },
        },
      },
      {
        $set: {
          status: { $cond: [{ $eq: ["$remainingMeals", 0] }, "exhausted", "$status"] },
          exhaustedAt: { $cond: [{ $eq: ["$remainingMeals", 0] }, now, "$exhaustedAt"] },
        },
      },
    ],
    { new: true }
  ).lean();

  if (updated) return updated;
  const current = await SubscriptionEntitlementBatch.findById(batch._id).lean();
  const journal = journalFor(current, idempotencyKey);
  if (journal) {
    assertJournal(journal, fingerprint);
    return current;
  }
  throw manualError(
    "INSUFFICIENT_REMAINING_MEALS",
    "Subscription package balance changed; not enough remaining meals",
    409
  );
}

async function debitBaseMeals({ subscriptionId, quantity, businessDate, idempotencyKey, fingerprint, actorId, actorRole }) {
  if (quantity <= 0) return [];
  const window = dateWindow(businessDate);
  const batches = await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: subscriptionId,
    applicationState: "applied",
    status: { $in: ["active", "paid_scheduled", "exhausted"] },
    effectiveStartDate: { $lte: window.end },
    validityEndDate: { $gte: window.start },
  }).sort({ validityEndDate: 1, effectiveStartDate: 1, createdAt: 1, _id: 1 }).lean();

  let alreadyApplied = 0;
  for (const batch of batches) {
    const journal = journalFor(batch, idempotencyKey);
    if (!journal) continue;
    assertJournal(journal, fingerprint);
    if (journal.kind === "base_meal") alreadyApplied += asInt(journal.quantity);
  }
  if (alreadyApplied > quantity) {
    throw manualError("IDEMPOTENCY_KEY_CONFLICT", "Stored manual deduction exceeds the requested amount", 409);
  }

  let remaining = quantity - alreadyApplied;
  const touched = [];
  for (const batch of batches) {
    if (remaining <= 0) break;
    if (!["active", "paid_scheduled"].includes(String(batch.status || ""))) continue;
    if (journalFor(batch, idempotencyKey)) continue;
    const available = asInt(batch.remainingMeals);
    if (available <= 0) continue;
    const debit = Math.min(remaining, available);
    touched.push(await applyBatchDebit({
      batch,
      quantity: debit,
      idempotencyKey,
      fingerprint,
      businessDate,
      actorId,
      actorRole,
    }));
    remaining -= debit;
  }
  if (remaining > 0) {
    throw manualError(
      "INSUFFICIENT_REMAINING_MEALS",
      "Not enough remaining meals across subscription packages",
      409,
      { requestedMeals: quantity, missingMeals: remaining }
    );
  }
  return touched;
}

async function applyBucketDebit({ bucket, quantity, idempotencyKey, fingerprint, businessDate, kind, identity }) {
  if (quantity <= 0) return bucket;
  const existing = journalFor(bucket, idempotencyKey);
  if (existing) {
    assertJournal(existing, fingerprint);
    return bucket;
  }
  const now = new Date();
  const updated = await SubscriptionExtraEntitlementBucket.findOneAndUpdate(
    {
      _id: bucket._id,
      containerSubscriptionId: bucket.containerSubscriptionId,
      applicationState: "applied",
      remainingQty: { $gte: quantity },
      [`metadata.${JOURNAL_KEY}.idempotencyKey`]: { $ne: idempotencyKey },
    },
    [
      {
        $set: {
          metadata: {
            $cond: [{ $eq: [{ $type: "$metadata" }, "object"] }, "$metadata", {}],
          },
        },
      },
      {
        $set: {
          [`metadata.${JOURNAL_KEY}`]: {
            $concatArrays: [
              {
                $cond: [
                  { $isArray: `$metadata.${JOURNAL_KEY}` },
                  `$metadata.${JOURNAL_KEY}`,
                  [],
                ],
              },
              [{
                idempotencyKey,
                fingerprint,
                kind,
                identity: String(identity || ""),
                quantity,
                businessDate,
                appliedAt: now,
              }],
            ],
          },
          remainingQty: { $subtract: ["$remainingQty", quantity] },
          consumedQty: { $add: [{ $ifNull: ["$consumedQty", 0] }, quantity] },
        },
      },
    ],
    { new: true }
  ).lean();
  if (updated) return updated;
  const current = await SubscriptionExtraEntitlementBucket.findById(bucket._id).lean();
  const journal = journalFor(current, idempotencyKey);
  if (journal) {
    assertJournal(journal, fingerprint);
    return current;
  }
  throw manualError("EXTRA_BALANCE_CONFLICT", "Extra entitlement balance changed during manual deduction", 409);
}

async function debitMatchingBuckets({ subscriptionId, businessDate, idempotencyKey, fingerprint, kind, identity, quantity, match }) {
  if (quantity <= 0) return;
  const window = dateWindow(businessDate);
  const buckets = await SubscriptionExtraEntitlementBucket.find({
    containerSubscriptionId: subscriptionId,
    kind,
    applicationState: "applied",
    effectiveStartDate: { $lte: window.end },
    validityEndDate: { $gte: window.start },
    ...match,
  }).sort({ validityEndDate: 1, effectiveStartDate: 1, createdAt: 1, _id: 1 }).lean();

  let alreadyApplied = 0;
  for (const bucket of buckets) {
    const journal = journalFor(bucket, idempotencyKey);
    if (!journal) continue;
    assertJournal(journal, fingerprint);
    if (journal.kind === kind && String(journal.identity || "") === String(identity || "")) {
      alreadyApplied += asInt(journal.quantity);
    }
  }
  let remaining = Math.max(0, quantity - alreadyApplied);
  for (const bucket of buckets) {
    if (remaining <= 0) break;
    if (journalFor(bucket, idempotencyKey)) continue;
    const available = asInt(bucket.remainingQty);
    if (available <= 0) continue;
    const debit = Math.min(remaining, available);
    await applyBucketDebit({
      bucket,
      quantity: debit,
      idempotencyKey,
      fingerprint,
      businessDate,
      kind,
      identity,
    });
    remaining -= debit;
  }
  // A stacked container can include a legacy seed that has no extra bucket.
  // Parent wallet validation remains authoritative for that legacy remainder,
  // so absence of a bucket is not an error here.
}

function buildAddonParentAllocations(subscription, addonRequests) {
  const rows = Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [];
  const allocations = [];
  for (const request of addonRequests || []) {
    let remaining = asInt(request.qty);
    const matching = rows
      .filter((row) => row && row._id && String(row.addonId) === String(request.addonId) && asInt(row.remainingQty) > 0)
      .sort((a, b) => {
        const aTime = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
        const bTime = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
        if (aTime !== bTime) return aTime - bTime;
        return String(a._id).localeCompare(String(b._id));
      });
    for (const row of matching) {
      if (remaining <= 0) break;
      const qty = Math.min(remaining, asInt(row.remainingQty));
      allocations.push({ rowId: row._id, addonId: request.addonId, qty });
      remaining -= qty;
    }
    if (remaining > 0) {
      throw manualError("INSUFFICIENT_ADDON_BALANCE", `Not enough balance for addon: ${request.addonId}`, 409);
    }
  }
  return allocations;
}

async function debitExtraBuckets({ subscription, businessDate, idempotencyKey, fingerprint, premiumAllocations, addonAllocations }) {
  const premiumRowMap = new Map(
    (Array.isArray(subscription.premiumBalance) ? subscription.premiumBalance : [])
      .map((row) => [String(row._id), row])
  );
  const premiumDemands = new Map();
  for (const allocation of premiumAllocations) {
    const row = premiumRowMap.get(String(allocation.rowId));
    if (!row) continue;
    const identity = `${String(row.premiumKey || "").toLowerCase()}:${String(row.configId || "")}:${asInt(row.revision)}`;
    const demand = premiumDemands.get(identity) || {
      quantity: 0,
      match: {
        premiumKey: String(row.premiumKey || "").toLowerCase(),
        revision: asInt(row.revision),
      },
    };
    if (row.configId) demand.match.configId = row.configId;
    demand.quantity += allocation.qty;
    premiumDemands.set(identity, demand);
  }
  for (const [identity, demand] of premiumDemands.entries()) {
    await debitMatchingBuckets({
      subscriptionId: subscription._id,
      businessDate,
      idempotencyKey,
      fingerprint,
      kind: "premium",
      identity,
      quantity: demand.quantity,
      match: demand.match,
    });
  }

  const addonDemands = new Map();
  for (const allocation of addonAllocations) {
    const identity = String(allocation.addonId);
    addonDemands.set(identity, (addonDemands.get(identity) || 0) + allocation.qty);
  }
  for (const [identity, quantity] of addonDemands.entries()) {
    await debitMatchingBuckets({
      subscriptionId: subscription._id,
      businessDate,
      idempotencyKey,
      fingerprint,
      kind: "addon",
      identity,
      quantity,
      match: {
        $or: [
          { addonId: identity },
          { addonPlanId: identity },
        ],
      },
    });
  }
}

async function applyParentMirrorAndExtras({ subscription, batches, businessDate, idempotencyKey, premiumAllocations, addonAllocations }) {
  const mirror = buildContainerMirror({ container: subscription, batches, businessDate });
  const filter = {
    _id: subscription._id,
    status: "active",
    [PARENT_OPERATION_FIELD]: { $ne: parentOperationKey(idempotencyKey) },
  };
  const update = {
    $set: {
      ...mirror,
      entitlementVersion: 2,
    },
    $addToSet: { [PARENT_OPERATION_FIELD]: parentOperationKey(idempotencyKey) },
    $inc: { stackingRevision: 1 },
  };
  const arrayFilters = [];

  premiumAllocations.forEach((allocation, index) => {
    update.$inc[`premiumBalance.$[p${index}].remainingQty`] = -allocation.qty;
    update.$inc[`premiumBalance.$[p${index}].consumedQty`] = allocation.qty;
    arrayFilters.push({ [`p${index}._id`]: allocation.rowId, [`p${index}.remainingQty`]: { $gte: allocation.qty } });
  });
  addonAllocations.forEach((allocation, index) => {
    update.$inc[`addonBalance.$[a${index}].remainingQty`] = -allocation.qty;
    update.$inc[`addonBalance.$[a${index}].consumedQty`] = allocation.qty;
    arrayFilters.push({ [`a${index}._id`]: allocation.rowId, [`a${index}.remainingQty`]: { $gte: allocation.qty } });
  });

  const options = { new: true };
  if (arrayFilters.length) options.arrayFilters = arrayFilters;
  let updated = await Subscription.findOneAndUpdate(filter, update, options);
  if (updated) return { subscription: updated, idempotent: false };

  updated = await Subscription.findById(subscription._id);
  if (updated && Array.isArray(updated[PARENT_OPERATION_FIELD])
    && updated[PARENT_OPERATION_FIELD].includes(parentOperationKey(idempotencyKey))) {
    // Base counters are a projection and can always be repaired idempotently.
    updated = await Subscription.findOneAndUpdate(
      { _id: subscription._id, status: "active" },
      { $set: { ...mirror, entitlementVersion: 2 }, $inc: { stackingRevision: 1 } },
      { new: true }
    );
    return { subscription: updated, idempotent: true };
  }
  throw manualError("SUBSCRIPTION_BALANCE_CONFLICT", "Subscription balance changed during manual deduction", 409);
}

async function finalizeOperation({ operationId, subscription, counts, before, after, addonBalances, businessDate, actorId, actorRole, reason, notes, idempotencyKey, fingerprint }) {
  const response = buildDeductionResponse({
    subscription,
    counts,
    balances: after,
    addonBalances,
    businessDate,
  });
  const log = buildDeductionLog({
    subscription,
    counts,
    before,
    after,
    actorId,
    actorRole,
    reason,
    notes,
    businessDate,
  });
  await ActivityLog.updateOne(
    { _id: operationId },
    {
      $set: {
        byUserId: actorId,
        byRole: actorRole,
        meta: {
          ...log.meta,
          status: "committed",
          idempotencyKey,
          fingerprint,
          responseSnapshot: response,
        },
      },
    }
  );
  return response;
}

async function executeStackedManualDeduction({ subscriptionId, counts, body, actorId, actorRole, businessDate, idempotencyKey }) {
  const key = normalizeKey(idempotencyKey);
  const fingerprint = fingerprintRequest({
    subscriptionId,
    counts,
    reason: body && body.reason,
    notes: body && body.notes,
  });
  const operationId = operationObjectId(subscriptionId, key);

  const replay = await ActivityLog.findById(operationId).lean();
  if (replay) {
    const meta = replay.meta || {};
    if (String(meta.fingerprint || "") !== fingerprint) {
      throw manualError("IDEMPOTENCY_KEY_CONFLICT", "Idempotency key was already used for a different manual deduction", 409);
    }
    if (meta.status === "committed" && meta.responseSnapshot) {
      return meta.responseSnapshot;
    }
  }

  const lease = await acquireLease(subscriptionId, key);
  try {
    let subscription = await Subscription.findOne({ _id: subscriptionId, status: "active" });
    validateSubscriptionCanDeduct(subscription, businessDate);

    const existingOperation = await ActivityLog.findById(operationId).lean();
    let before;
    if (existingOperation) {
      const meta = existingOperation.meta || {};
      if (String(meta.fingerprint || "") !== fingerprint) {
        throw manualError("IDEMPOTENCY_KEY_CONFLICT", "Idempotency key was already used for a different manual deduction", 409);
      }
      if (meta.status === "committed" && meta.responseSnapshot) return meta.responseSnapshot;
      before = meta.beforeSnapshot || validateBalances(subscription, counts);
    } else {
      before = validateBalances(subscription, counts);
      await reserveOperation({
        subscription,
        counts,
        before,
        businessDate,
        idempotencyKey: key,
        fingerprint,
        actorId,
        actorRole,
        reason: body && body.reason,
        notes: body && body.notes,
      });
    }

    const parentAlreadyApplied = Array.isArray(subscription[PARENT_OPERATION_FIELD])
      && subscription[PARENT_OPERATION_FIELD].includes(parentOperationKey(key));

    let premiumAllocations = [];
    let addonAllocations = [];
    if (!parentAlreadyApplied) {
      premiumAllocations = buildPremiumAllocation(subscription, counts.premiumMeals);
      addonAllocations = buildAddonParentAllocations(subscription, counts.addons);

      await debitBaseMeals({
        subscriptionId,
        quantity: counts.total,
        businessDate,
        idempotencyKey: key,
        fingerprint,
        actorId,
        actorRole,
      });
      await debitExtraBuckets({
        subscription,
        businessDate,
        idempotencyKey: key,
        fingerprint,
        premiumAllocations,
        addonAllocations,
      });
    }

    const batches = await SubscriptionEntitlementBatch.find({
      containerSubscriptionId: subscriptionId,
    }).sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 }).lean();

    if (!parentAlreadyApplied) {
      const parentResult = await applyParentMirrorAndExtras({
        subscription,
        batches,
        businessDate,
        idempotencyKey: key,
        premiumAllocations,
        addonAllocations,
      });
      subscription = parentResult.subscription;
    } else {
      const mirror = buildContainerMirror({ container: subscription, batches, businessDate });
      subscription = await Subscription.findOneAndUpdate(
        { _id: subscriptionId, status: "active" },
        { $set: { ...mirror, entitlementVersion: 2 } },
        { new: true }
      );
    }

    const after = resolveBalances(subscription);
    const afterAddonBalances = resolveAddonBalances(subscription);
    return finalizeOperation({
      operationId,
      subscription,
      counts,
      before,
      after,
      addonBalances: afterAddonBalances,
      businessDate,
      actorId,
      actorRole,
      reason: body && body.reason,
      notes: body && body.notes,
      idempotencyKey: key,
      fingerprint,
    });
  } finally {
    await releaseLease(lease).catch(() => {});
  }
}

module.exports = {
  executeStackedManualDeduction,
  hasEntitlementBatches,
};
