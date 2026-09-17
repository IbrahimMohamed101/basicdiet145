"use strict";

const mongoose = require("mongoose");
const AccountDeletionRequest = require("../../models/AccountDeletionRequest");
const ActivityLog = require("../../models/ActivityLog");
const AppUser = require("../../models/AppUser");
const CheckoutDraft = require("../../models/CheckoutDraft");
const CustomerAccountMerge = require("../../models/CustomerAccountMerge");
const EmailOtpChallenge = require("../../models/EmailOtpChallenge");
const NotificationLog = require("../../models/NotificationLog");
const Order = require("../../models/Order");
const Otp = require("../../models/Otp");
const Payment = require("../../models/Payment");
const PromoCode = require("../../models/PromoCode");
const PromoUsage = require("../../models/PromoUsage");
const RefreshSession = require("../../models/RefreshSession");
const Subscription = require("../../models/Subscription");
const SubscriptionDayAppendOperation = require("../../models/SubscriptionDayAppendOperation");
const SubscriptionEntitlementAllocation = require("../../models/SubscriptionEntitlementAllocation");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementCompensation = require("../../models/SubscriptionEntitlementCompensation");
const SubscriptionEntitlementDayBlueprint = require("../../models/SubscriptionEntitlementDayBlueprint");
const SubscriptionExtraEntitlementAllocation = require("../../models/SubscriptionExtraEntitlementAllocation");
const SubscriptionExtraEntitlementBucket = require("../../models/SubscriptionExtraEntitlementBucket");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const User = require("../../models/User");
const { logger } = require("../../utils/logger");
const { assertValidPhoneE164 } = require("../otpService");

const OWNERSHIP_MODELS = [
  ["subscriptions", Subscription],
  ["orders", Order],
  ["payments", Payment],
  ["checkoutDrafts", CheckoutDraft],
  ["promoUsages", PromoUsage],
  ["notifications", NotificationLog],
  ["accountDeletionRequests", AccountDeletionRequest],
  ["pickupRequests", SubscriptionPickupRequest],
  ["entitlementBatches", SubscriptionEntitlementBatch],
  ["entitlementDayBlueprints", SubscriptionEntitlementDayBlueprint],
  ["entitlementCompensations", SubscriptionEntitlementCompensation],
  ["entitlementAllocations", SubscriptionEntitlementAllocation],
  ["extraEntitlementBuckets", SubscriptionExtraEntitlementBucket],
  ["extraEntitlementAllocations", SubscriptionExtraEntitlementAllocation],
  ["dayAppendOperations", SubscriptionDayAppendOperation],
];

function mergeError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function serializeUser(user) {
  return {
    id: String(user._id),
    fullName: user.name || null,
    phone: user.phoneE164 || user.phone || null,
    email: user.email || null,
    isActive: user.isActive !== false,
    createdAt: user.createdAt || null,
  };
}

async function resolveAccounts(sourceId, targetPhone) {
  if (!mongoose.isValidObjectId(sourceId)) {
    throw mergeError(400, "INVALID_ID", "Customer id is invalid");
  }
  const rawTargetPhone = String(targetPhone || "").trim().replace(/[\s().-]/g, "");
  const phone = assertValidPhoneE164(/^5\d{8}$/.test(rawTargetPhone) ? `+966${rawTargetPhone}` : rawTargetPhone);
  const [source, target] = await Promise.all([
    User.findOne({ _id: sourceId, role: "client" }).lean(),
    User.findOne({ role: "client", $or: [{ phone }, { phoneE164: phone }] }).lean(),
  ]);
  if (!source) throw mergeError(404, "SOURCE_NOT_FOUND", "Source customer account was not found");
  if (!target) throw mergeError(404, "TARGET_NOT_FOUND", "Target customer account was not found");
  if (String(source._id) === String(target._id)) {
    throw mergeError(400, "SAME_ACCOUNT", "Source and target accounts must be different");
  }
  if (source.mergedIntoUserId && String(source.mergedIntoUserId) !== String(target._id)) {
    throw mergeError(409, "SOURCE_ALREADY_MERGED", "Source account was already merged into another account");
  }
  return { source, target, phone };
}

async function countOwnership(userId) {
  const entries = await Promise.all(
    OWNERSHIP_MODELS.map(async ([key, Model]) => [key, await Model.countDocuments({ userId })])
  );
  return Object.fromEntries(entries);
}

function intersect(left, right) {
  const rightSet = new Set(right.filter(Boolean).map(String));
  return [...new Set(left.filter(Boolean).map(String).filter((value) => rightSet.has(value)))];
}

async function findIdempotencyConflicts(Model, sourceId, targetId, { pendingStatus = "pending_payment" } = {}) {
  const [sourceRows, targetRows] = await Promise.all([
    Model.find({ userId: sourceId }).select("idempotencyKey requestHash status").lean(),
    Model.find({ userId: targetId }).select("idempotencyKey requestHash status").lean(),
  ]);
  const idempotencyKeys = intersect(
    sourceRows.map((row) => row.idempotencyKey),
    targetRows.map((row) => row.idempotencyKey)
  );
  const requestHashes = intersect(
    sourceRows.filter((row) => row.status === pendingStatus).map((row) => row.requestHash),
    targetRows.filter((row) => row.status === pendingStatus).map((row) => row.requestHash)
  );
  return { idempotencyKeys, requestHashes };
}

async function buildConflicts(sourceId, targetId) {
  const [sourceActive, targetActive, orderConflicts, checkoutConflicts] = await Promise.all([
    Subscription.findOne({ userId: sourceId, status: "active" }).select("_id").lean(),
    Subscription.findOne({ userId: targetId, status: "active" }).select("_id").lean(),
    findIdempotencyConflicts(Order, sourceId, targetId),
    findIdempotencyConflicts(CheckoutDraft, sourceId, targetId),
  ]);
  const conflicts = [];
  if (sourceActive && targetActive) {
    conflicts.push({
      code: "MULTIPLE_ACTIVE_SUBSCRIPTIONS",
      message: "Both accounts have an active subscription; choose which subscription remains active before merging",
      sourceSubscriptionId: String(sourceActive._id),
      targetSubscriptionId: String(targetActive._id),
    });
  }
  if (orderConflicts.idempotencyKeys.length || orderConflicts.requestHashes.length) {
    conflicts.push({ code: "ORDER_KEY_CONFLICT", ...orderConflicts });
  }
  if (checkoutConflicts.idempotencyKeys.length || checkoutConflicts.requestHashes.length) {
    conflicts.push({ code: "CHECKOUT_KEY_CONFLICT", ...checkoutConflicts });
  }
  return conflicts;
}

async function previewCustomerAccountMerge({ sourceId, targetPhone, actorRole }) {
  if (actorRole !== "superadmin") {
    throw mergeError(403, "FORBIDDEN", "Only superadmin may merge customer accounts");
  }
  const { source, target } = await resolveAccounts(sourceId, targetPhone);
  const [sourceCounts, targetCounts, conflicts] = await Promise.all([
    countOwnership(source._id),
    countOwnership(target._id),
    buildConflicts(source._id, target._id),
  ]);
  return {
    source: serializeUser(source),
    target: serializeUser(target),
    sourceCounts,
    targetCounts,
    conflicts,
    canMerge: conflicts.length === 0,
    identityPolicy: "target_credentials_and_profile_are_preserved",
  };
}

function normalizeExecutionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw mergeError(400, "INVALID", "Request body must be an object");
  }
  const reason = String(payload.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw mergeError(400, "REASON_REQUIRED", "A reason between 3 and 500 characters is required");
  }
  const idempotencyKey = String(payload.idempotencyKey || "").trim();
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(idempotencyKey)) {
    throw mergeError(400, "INVALID_IDEMPOTENCY_KEY", "A valid idempotencyKey is required");
  }
  const activeSubscriptionResolution = payload.activeSubscriptionResolution === undefined
    ? null
    : String(payload.activeSubscriptionResolution || "").trim();
  if (activeSubscriptionResolution && !["keep_source", "keep_target"].includes(activeSubscriptionResolution)) {
    throw mergeError(
      400,
      "INVALID_ACTIVE_SUBSCRIPTION_RESOLUTION",
      "activeSubscriptionResolution must be keep_source or keep_target"
    );
  }
  return { targetPhone: payload.targetPhone, reason, idempotencyKey, activeSubscriptionResolution };
}

async function markStepCompleted(operationId, step) {
  await CustomerAccountMerge.updateOne(
    { _id: operationId },
    { $addToSet: { completedSteps: step }, $set: { state: "in_progress", lastError: null } }
  );
}

async function executeCustomerAccountMerge({ sourceId, payload, actorId, actorRole }) {
  if (actorRole !== "superadmin") {
    throw mergeError(403, "FORBIDDEN", "Only superadmin may merge customer accounts");
  }
  const input = normalizeExecutionPayload(payload);
  const preview = await previewCustomerAccountMerge({ sourceId, targetPhone: input.targetPhone, actorRole });
  const unresolvedConflicts = preview.conflicts.filter(
    (conflict) => conflict.code !== "MULTIPLE_ACTIVE_SUBSCRIPTIONS" || !input.activeSubscriptionResolution
  );
  if (unresolvedConflicts.length) {
    throw mergeError(409, "ACCOUNT_MERGE_CONFLICT", "Account merge requires conflict resolution", unresolvedConflicts);
  }
  const { source, target } = await resolveAccounts(sourceId, input.targetPhone);

  let operation = await CustomerAccountMerge.findOne({ idempotencyKey: input.idempotencyKey });
  if (operation) {
    if (String(operation.sourceUserId) !== String(source._id) || String(operation.targetUserId) !== String(target._id)) {
      throw mergeError(409, "IDEMPOTENCY_KEY_CONFLICT", "idempotencyKey belongs to another account merge");
    }
    if (operation.state === "completed") {
      return { operation: operation.toObject(), preview, replayed: true };
    }
  } else {
    const existing = await CustomerAccountMerge.findOne({ sourceUserId: source._id });
    if (existing) {
      throw mergeError(409, "MERGE_ALREADY_STARTED", "A merge operation already exists for this source account");
    }
    operation = await CustomerAccountMerge.create({
      idempotencyKey: input.idempotencyKey,
      sourceUserId: source._id,
      targetUserId: target._id,
      sourcePhone: source.phoneE164 || source.phone,
      targetPhone: target.phoneE164 || target.phone,
      reason: input.reason,
      state: "pending",
      previewCounts: preview.sourceCounts,
      conflicts: [],
      actorId,
      actorRole,
    });
  }

  try {
    await CustomerAccountMerge.updateOne(
      { _id: operation._id },
      { $set: { state: "in_progress", startedAt: operation.startedAt || new Date(), lastError: null } }
    );

    await User.updateOne(
      {
        _id: source._id,
        role: "client",
        $or: [{ mergedIntoUserId: null }, { mergedIntoUserId: target._id }],
      },
      {
        $set: {
          isActive: false,
          mergedIntoUserId: target._id,
          mergedAt: new Date(),
          mergedByDashboardUserId: actorId,
          accountMergeState: "in_progress",
          accountMergeReason: input.reason,
          fcmTokens: [],
        },
        $inc: { authVersion: 1 },
      }
    );
    await AppUser.updateMany(
      { coreUserId: source._id },
      { $set: { mergedIntoUserId: target._id, mergedAt: new Date(), fcmTokens: [] } }
    );
    await markStepCompleted(operation._id, "source_disabled");

    const refreshedOperation = await CustomerAccountMerge.findById(operation._id).lean();
    const completedSteps = new Set(refreshedOperation.completedSteps || []);
    if (input.activeSubscriptionResolution && !completedSteps.has("active_subscription_resolution")) {
      const losingUserId = input.activeSubscriptionResolution === "keep_source" ? target._id : source._id;
      await Subscription.updateMany(
        { userId: losingUserId, status: "active" },
        { $set: { status: "frozen" } }
      );
      await markStepCompleted(operation._id, "active_subscription_resolution");
    }
    for (const [key, Model] of OWNERSHIP_MODELS) {
      const step = `owner:${key}`;
      if (completedSteps.has(step)) continue;
      await Model.collection.updateMany({ userId: source._id }, { $set: { userId: target._id } });
      await markStepCompleted(operation._id, step);
    }

    if (!completedSteps.has("promo_allowlist")) {
      await PromoCode.updateMany(
        { allowedUserIds: source._id },
        { $addToSet: { allowedUserIds: target._id } }
      );
      await PromoCode.updateMany(
        { allowedUserIds: source._id },
        { $pull: { allowedUserIds: source._id } }
      );
      await markStepCompleted(operation._id, "promo_allowlist");
    }

    const now = new Date();
    await Promise.all([
      RefreshSession.updateMany(
        { userId: source._id, revokedAt: null },
        { $set: { revokedAt: now, revokedReason: "security" } }
      ),
      EmailOtpChallenge.deleteMany({ userId: source._id }),
      Otp.deleteMany({ phone: source.phoneE164 || source.phone }),
    ]);
    await markStepCompleted(operation._id, "security_cleanup");

    await User.updateOne(
      { _id: source._id, mergedIntoUserId: target._id },
      { $set: { accountMergeState: "completed", mergedAt: now } }
    );
    await ActivityLog.create({
      entityType: "user",
      entityId: target._id,
      action: "customer_accounts_merged_by_superadmin",
      byUserId: actorId,
      byRole: actorRole,
      meta: {
        sourceUserId: String(source._id),
        targetUserId: String(target._id),
        sourcePhone: source.phoneE164 || source.phone,
        targetPhone: target.phoneE164 || target.phone,
        reason: input.reason,
        movedCounts: preview.sourceCounts,
        identityPolicy: preview.identityPolicy,
        activeSubscriptionResolution: input.activeSubscriptionResolution,
        persistenceMode: "standalone_forward_only_saga",
      },
    });
    operation = await CustomerAccountMerge.findOneAndUpdate(
      { _id: operation._id },
      {
        $set: { state: "completed", completedAt: now, lastError: null },
        $addToSet: { completedSteps: "completed" },
      },
      { new: true }
    );
    return { operation: operation.toObject(), preview, replayed: false };
  } catch (error) {
    await CustomerAccountMerge.updateOne(
      { _id: operation._id },
      { $set: { state: "failed", lastError: { code: error.code || "INTERNAL", message: error.message } } }
    ).catch(() => {});
    logger.error("customer account merge failed", {
      operationId: String(operation._id),
      sourceUserId: String(source._id),
      targetUserId: String(target._id),
      error: error.message,
    });
    if (error && error.code === 11000) {
      throw mergeError(409, "ACCOUNT_MERGE_CONFLICT", "Account merge encountered a unique data conflict");
    }
    throw error;
  }
}

module.exports = { executeCustomerAccountMerge, previewCustomerAccountMerge };
