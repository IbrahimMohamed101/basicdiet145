"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const SubscriptionDayAppendOperation = require("../../models/SubscriptionDayAppendOperation");
const Payment = require("../../models/Payment");
const { normalizePhoneE164 } = require("../otpService");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const dateUtils = require("../../utils/date");
const { logger } = require("../../utils/logger");

const E164_REGEX = /^\+[1-9]\d{7,14}$/;
const ACTIVE_PICKUP_QUERY = Object.freeze({
  status: "active",
  deliveryMode: "pickup",
});

function serviceError(code, message, status = 409, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_error) {
    return "";
  }
}

function attachSession(query, session) {
  return session && query && typeof query.session === "function" ? query.session(session) : query;
}

function normalizedIdentityPhone(user = {}) {
  for (const raw of [user.phoneE164, user.phone]) {
    const normalized = normalizePhoneE164(raw);
    if (E164_REGEX.test(normalized)) return normalized;
  }
  return "";
}

function subscriptionDateWindow(subscription = {}) {
  const startDate = subscription.startDate ? dateUtils.toKSADateString(subscription.startDate) : "";
  const endValue = subscription.validityEndDate || subscription.endDate;
  const endDate = endValue ? dateUtils.toKSADateString(endValue) : "";
  return { startDate, endDate };
}

function subscriptionIncludesDate(subscription, date) {
  if (!date) return true;
  if (!dateUtils.isValidKSADateString(date)) return false;
  const { startDate, endDate } = subscriptionDateWindow(subscription);
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function validObjectId(value) {
  return mongoose.Types.ObjectId.isValid(clean(value));
}

async function findCurrentPickupSubscription({
  userId,
  date = null,
  excludeSubscriptionId = null,
  session = null,
  SubscriptionModel = Subscription,
} = {}) {
  const query = {
    userId,
    ...ACTIVE_PICKUP_QUERY,
  };
  if (excludeSubscriptionId && validObjectId(excludeSubscriptionId)) {
    query._id = { $ne: excludeSubscriptionId };
  }

  const rows = await attachSession(
    SubscriptionModel.find(query).sort({ createdAt: -1, _id: -1 }),
    session
  ).lean();
  const eligible = rows.filter((row) => subscriptionIncludesDate(row, date));

  if (eligible.length > 1) {
    throw serviceError(
      "PICKUP_SUBSCRIPTION_AMBIGUOUS",
      "More than one active pickup subscription is available for this account",
      409,
      {
        messageAr: "يوجد أكثر من اشتراك استلام نشط على الحساب. يرجى التواصل مع الدعم.",
        messageEn: "More than one active pickup subscription is linked to this account. Please contact support.",
      }
    );
  }
  return eligible[0] || null;
}

async function collectDependentIds({
  subscriptionId,
  previousUserId,
  session = null,
  models = {},
} = {}) {
  const PickupRequestModel = models.SubscriptionPickupRequestModel || SubscriptionPickupRequest;
  const AppendOperationModel = models.SubscriptionDayAppendOperationModel || SubscriptionDayAppendOperation;
  const PaymentModel = models.PaymentModel || Payment;
  const filter = { subscriptionId, userId: previousUserId };

  const [pickupRows, appendRows, paymentRows] = await Promise.all([
    attachSession(PickupRequestModel.find(filter).select("_id").lean(), session),
    attachSession(AppendOperationModel.find(filter).select("_id").lean(), session),
    attachSession(PaymentModel.find(filter).select("_id").lean(), session),
  ]);

  return {
    pickupRequestIds: pickupRows.map((row) => row._id),
    appendOperationIds: appendRows.map((row) => row._id),
    paymentIds: paymentRows.map((row) => row._id),
  };
}

async function updateDependentOwnership({
  ids,
  previousUserId,
  nextUserId,
  session = null,
  models = {},
} = {}) {
  const PickupRequestModel = models.SubscriptionPickupRequestModel || SubscriptionPickupRequest;
  const AppendOperationModel = models.SubscriptionDayAppendOperationModel || SubscriptionDayAppendOperation;
  const PaymentModel = models.PaymentModel || Payment;
  const options = session ? { session } : {};

  const updates = [];
  if (ids.pickupRequestIds.length) {
    updates.push(PickupRequestModel.updateMany(
      { _id: { $in: ids.pickupRequestIds }, userId: previousUserId },
      { $set: { userId: nextUserId } },
      options
    ));
  }
  if (ids.appendOperationIds.length) {
    updates.push(AppendOperationModel.updateMany(
      { _id: { $in: ids.appendOperationIds }, userId: previousUserId },
      { $set: { userId: nextUserId } },
      options
    ));
  }
  if (ids.paymentIds.length) {
    updates.push(PaymentModel.updateMany(
      { _id: { $in: ids.paymentIds }, userId: previousUserId },
      { $set: { userId: nextUserId } },
      options
    ));
  }
  await Promise.all(updates);
}

async function transferSamePhoneSubscriptionOwnership({
  subscription,
  userId,
  date = null,
  session = null,
  models = {},
} = {}) {
  const SubscriptionModel = models.SubscriptionModel || Subscription;
  const UserModel = models.UserModel || User;
  const previousUserId = subscription && subscription.userId;
  if (!previousUserId || clean(previousUserId) === clean(userId)) return subscription;
  if (subscription.status !== "active" || subscription.deliveryMode !== "pickup") return null;
  if (!subscriptionIncludesDate(subscription, date)) return null;

  const [currentUser, previousUser] = await Promise.all([
    attachSession(UserModel.findById(userId).select("_id role phone phoneE164 isActive").lean(), session),
    attachSession(UserModel.findById(previousUserId).select("_id role phone phoneE164 isActive").lean(), session),
  ]);
  const currentPhone = normalizedIdentityPhone(currentUser || {});
  const previousPhone = normalizedIdentityPhone(previousUser || {});
  if (
    !currentUser
    || currentUser.role !== "client"
    || currentUser.isActive === false
    || !previousUser
    || previousUser.role !== "client"
    || !currentPhone
    || currentPhone !== previousPhone
  ) {
    return null;
  }

  const activeConflict = await attachSession(
    SubscriptionModel.findOne({
      _id: { $ne: subscription._id },
      userId,
      status: "active",
    }).select("_id deliveryMode startDate endDate validityEndDate").lean(),
    session
  );
  if (activeConflict) {
    throw serviceError(
      "SUBSCRIPTION_OWNERSHIP_RECOVERY_CONFLICT",
      "The account already has another active subscription",
      409,
      {
        messageAr: "الحساب مرتبط بالفعل باشتراك نشط آخر. لم يتم نقل أي بيانات.",
        messageEn: "This account is already linked to another active subscription. No data was transferred.",
      }
    );
  }

  const localSession = session ? null : await startSafeSession();
  const useSession = session || localSession;
  if (localSession) localSession.startTransaction();
  let dependentIds = null;
  let transferred = null;

  try {
    dependentIds = await collectDependentIds({
      subscriptionId: subscription._id,
      previousUserId,
      session: useSession,
      models,
    });

    transferred = await SubscriptionModel.findOneAndUpdate(
      { _id: subscription._id, userId: previousUserId, status: "active" },
      { $set: { userId } },
      { new: true, session: useSession }
    );

    if (!transferred) {
      const latest = await attachSession(SubscriptionModel.findById(subscription._id), useSession);
      if (latest && clean(latest.userId) === clean(userId)) {
        transferred = latest;
      } else {
        throw serviceError(
          "SUBSCRIPTION_OWNERSHIP_RECOVERY_CONFLICT",
          "Subscription ownership changed during recovery",
          409
        );
      }
    }

    await updateDependentOwnership({
      ids: dependentIds,
      previousUserId,
      nextUserId: userId,
      session: useSession,
      models,
    });

    if (localSession) await localSession.commitTransaction();

    logger.warn("subscription ownership recovered for authenticated phone identity", {
      subscriptionId: clean(subscription._id),
      previousUserId: clean(previousUserId),
      userId: clean(userId),
      reason: "same_normalized_phone",
      pickupRequestCount: dependentIds.pickupRequestIds.length,
      appendOperationCount: dependentIds.appendOperationIds.length,
      paymentCount: dependentIds.paymentIds.length,
    });

    return transferred;
  } catch (error) {
    if (localSession) {
      try {
        await localSession.abortTransaction();
      } catch (_abortError) {
        // Preserve the original recovery error.
      }
    }

    // Standalone MongoDB cannot roll back a cross-collection update. Compensate
    // only the exact documents captured before the ownership compare-and-set.
    if (localSession && localSession.supportsTransactions === false && transferred && dependentIds) {
      try {
        await updateDependentOwnership({
          ids: dependentIds,
          previousUserId: userId,
          nextUserId: previousUserId,
          models,
        });
        await SubscriptionModel.updateOne(
          { _id: subscription._id, userId },
          { $set: { userId: previousUserId } }
        );
      } catch (compensationError) {
        logger.error("subscription ownership recovery compensation failed", {
          subscriptionId: clean(subscription._id),
          previousUserId: clean(previousUserId),
          userId: clean(userId),
          error: compensationError.message,
        });
      }
    }
    throw error;
  } finally {
    if (localSession) localSession.endSession();
  }
}

async function resolvePickupSubscriptionContext({
  requestedSubscriptionId,
  userId,
  date = null,
  session = null,
  models = {},
} = {}) {
  const SubscriptionModel = models.SubscriptionModel || Subscription;
  if (!validObjectId(requestedSubscriptionId)) {
    throw serviceError("INVALID_SUBSCRIPTION_ID", "Invalid subscription id", 400);
  }
  if (!validObjectId(userId)) {
    throw serviceError("FORBIDDEN", "Authenticated client identity is invalid", 403);
  }

  const requested = await attachSession(
    SubscriptionModel.findById(requestedSubscriptionId),
    session
  );
  if (!requested) {
    throw serviceError("NOT_FOUND", "Subscription not found", 404);
  }

  if (clean(requested.userId) === clean(userId)) {
    return {
      subscription: requested,
      subscriptionId: clean(requested._id),
      requestedSubscriptionId: clean(requestedSubscriptionId),
      resolution: "exact_owner",
      ownershipRecovered: false,
    };
  }

  // A stale Flutter state from a previous account must never expose the
  // requested subscription. Resolve only the authenticated user's own single
  // active pickup subscription.
  const current = await findCurrentPickupSubscription({
    userId,
    date,
    excludeSubscriptionId: requested._id,
    session,
    SubscriptionModel,
  });
  if (current) {
    logger.warn("stale pickup subscription id resolved to authenticated user's current subscription", {
      requestedSubscriptionId: clean(requested._id),
      resolvedSubscriptionId: clean(current._id),
      userId: clean(userId),
    });
    return {
      subscription: current,
      subscriptionId: clean(current._id),
      requestedSubscriptionId: clean(requestedSubscriptionId),
      resolution: "authenticated_current_subscription",
      ownershipRecovered: false,
    };
  }

  const recovered = await transferSamePhoneSubscriptionOwnership({
    subscription: requested,
    userId,
    date,
    session,
    models,
  });
  if (recovered) {
    return {
      subscription: recovered,
      subscriptionId: clean(recovered._id),
      requestedSubscriptionId: clean(requestedSubscriptionId),
      resolution: "same_phone_ownership_recovered",
      ownershipRecovered: true,
    };
  }

  throw serviceError(
    "FORBIDDEN",
    "Subscription does not belong to the authenticated account",
    403,
    {
      messageAr: "هذا الاشتراك غير مرتبط بالحساب الحالي. سجّل الدخول برقم الهاتف المرتبط بالاشتراك.",
      messageEn: "This subscription is not linked to the current account. Sign in with the phone number linked to the subscription.",
    }
  );
}

module.exports = {
  findCurrentPickupSubscription,
  normalizedIdentityPhone,
  resolvePickupSubscriptionContext,
  subscriptionIncludesDate,
  transferSamePhoneSubscriptionOwnership,
};
