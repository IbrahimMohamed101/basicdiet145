"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { logger } = require("../../utils/logger");
const { buildSubscriptionDayFulfillmentState } = require("./subscriptionDayFulfillmentStateService");
const { buildPickupPreparationPolicy } = require("./subscriptionPickupPreparationPolicyService");
const {
  buildPickupBlockReasonMessage,
  buildPickupPrepareLockedCopy,
  buildPickupStatusLabel,
  buildPickupStatusMessage,
} = require("./pickupLocalizationService");
const {
  buildPickupLocationSummary,
  getPickupLocationsSetting,
} = require("./subscriptionFulfillmentSummaryService");

const PICKUP_STEP_MAP = {
  open: 1,
  locked: 2,
  in_preparation: 3,
  ready_for_pickup: 4,
  fulfilled: 4,
  no_show: 4,
  consumed_without_preparation: 1,
};

function buildErrorResult(status, code, message, details) {
  return {
    ok: false,
    status,
    code,
    message,
    details,
  };
}

function buildSuccessResult(status, data) {
  return {
    ok: true,
    status,
    data,
  };
}

function resolvePickupPrepareBlockReason({
  subscription,
  day,
  restaurantHours,
  lang = "en",
}) {
  const policy = buildPickupPreparationPolicy({
    subscription,
    day,
    today: day && day.date ? day.date : undefined,
    restaurantHours,
  });
  if (!policy.blockReason) return null;

  const localizedMessage = buildPickupBlockReasonMessage(
    policy.blockReason.code || "DEFAULT",
    lang
  );

  return {
    ...policy.blockReason,
    message: policy.blockReason.message || localizedMessage.message,
    messageAr: localizedMessage.messageAr,
    messageEn: localizedMessage.messageEn,
  };
}

async function preparePickupForClient({
  subscriptionId,
  date,
  userId,
  lang,
  ensureActiveFn,
  getRestaurantHoursSettingsFn,
  validateDayBeforeLockOrPrepareFn,
  resolveDayExecutionValidationErrorStatusFn,
  lockDaySnapshotFn,
  writeLogSafelyFn,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const sub = await Subscription.findById(subscriptionId).populate("planId").session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
    }
    if (String(sub.userId) !== String(userId)) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(403, "FORBIDDEN", "Forbidden");
    }

    try {
      ensureActiveFn(sub, date);
      const restaurantHours = await getRestaurantHoursSettingsFn();
      if (date !== restaurantHours.businessDate) {
        throw {
          code: "INVALID_DATE",
          message: {
            messageKey: "errors.subscription.pickupCurrentBusinessDayOnly",
            fallbackMessage: "Pickup can only be prepared for the current business day",
          },
        };
      }
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return buildErrorResult(status, err.code || "INVALID_DATE", err.message);
    }

    if (sub.deliveryMode !== "pickup") {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(400, "INVALID", {
        messageKey: "errors.subscription.pickupModeRequired",
        fallbackMessage: "Delivery mode is not pickup",
      });
    }

    const day = await SubscriptionDay.findOne({ subscriptionId, date }).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(404, "NOT_FOUND", "Day not found");
    }

    const restaurantHours = await getRestaurantHoursSettingsFn();
    const blockReason = resolvePickupPrepareBlockReason({
      subscription: sub,
      day,
      restaurantHours,
      lang,
    });
    if (blockReason) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(blockReason.status, blockReason.code, blockReason.message);
    }

    try {
      validateDayBeforeLockOrPrepareFn({ subscription: sub, day });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(
        resolveDayExecutionValidationErrorStatusFn(err),
        err.code || "INVALID",
        err.message
      );
    }

    const updatedDay = await SubscriptionDay.findOneAndUpdate(
      { _id: day._id, status: { $in: ["open", null] } },
      {
        $set: {
          pickupRequested: true,
          pickupRequestedAt: new Date(),
          status: "locked",
          dayEndConsumptionReason: null,
        },
      },
      { new: true, session }
    );
    if (!updatedDay) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(409, "LOCKED", {
        messageKey: "errors.subscription.pickupDayAlreadyLocked",
        fallbackMessage: "Day already locked",
      });
    }

    await lockDaySnapshotFn(sub, updatedDay, session);

    await session.commitTransaction();
    session.endSession();

    await writeLogSafelyFn(
      {
        entityType: "subscription_day",
        entityId: updatedDay._id,
        action: "pickup_prepare",
        byUserId: userId,
        byRole: "client",
        meta: { date: updatedDay.date, deductedCredits: 0, consumptionTiming: "day_of_finalization" },
      },
      { subscriptionId, date: updatedDay.date }
    );

    const lockedCopy = buildPickupPrepareLockedCopy(lang);
    return buildSuccessResult(200, {
      subscriptionId: sub._id,
      date: updatedDay.date,
      currentStep: 2,
      status: "locked",
      statusLabel: lockedCopy.statusLabel,
      statusLabelAr: lockedCopy.statusLabelAr,
      statusLabelEn: lockedCopy.statusLabelEn,
      message: lockedCopy.message,
      messageAr: lockedCopy.messageAr,
      messageEn: lockedCopy.messageEn,
      pickupRequested: true,
      nextAction: "poll_pickup_status",
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("Pickup prepare failed", { error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", {
      messageKey: "errors.subscription.pickupPrepareFailed",
      fallbackMessage: "Pickup prepare failed",
    });
  }
}

async function getPickupStatusForClient({
  subscriptionId,
  date,
  userId,
  lang,
  ensureActiveFn,
  getRestaurantHoursSettingsFn,
}) {
  try {
    const subscription = await Subscription.findById(subscriptionId).lean();
    if (!subscription) {
      return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
    }

    if (String(subscription.userId) !== String(userId)) {
      return buildErrorResult(403, "FORBIDDEN", "Forbidden");
    }

    ensureActiveFn(subscription, date);

    const day = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
    if (!day) {
      return buildErrorResult(404, "NOT_FOUND", "Day not found");
    }

    const restaurantHours = await getRestaurantHoursSettingsFn();
    const pickupLocations = await getPickupLocationsSetting();
    const pickupLocation = buildPickupLocationSummary(subscription, pickupLocations, lang);
    const blockReason = resolvePickupPrepareBlockReason({
      subscription,
      day,
      restaurantHours,
      lang,
    });

    const fulfillmentState = buildSubscriptionDayFulfillmentState({
      subscription,
      day,
      today: date,
    });
    const statusLabelBundle = buildPickupStatusLabel(day.status, lang);
    const statusMessageBundle = buildPickupStatusMessage(day.status, lang);
    const isReady = ["ready_for_pickup", "fulfilled"].includes(day.status);
    const isCompleted = ["fulfilled", "no_show", "consumed_without_preparation"].includes(day.status);
    const showCode = isReady;

    return buildSuccessResult(200, {
      subscriptionId: subscription._id,
      date: day.date,
      currentStep: PICKUP_STEP_MAP[day.status] ?? 1,
      status: day.status,
      statusLabel: statusLabelBundle.label || "",
      statusLabelAr: statusLabelBundle.messageAr || "",
      statusLabelEn: statusLabelBundle.messageEn || "",
      message: statusMessageBundle.message || "",
      messageAr: statusMessageBundle.messageAr || "",
      messageEn: statusMessageBundle.messageEn || "",
      canModify: day.status === "open" && !day.pickupRequested,
      isReady,
      isCompleted,
      pickupRequested: Boolean(day.pickupRequested),
      pickupPrepared: Boolean(fulfillmentState.pickupPrepared),
      pickupPreparationFlowStatus: fulfillmentState.pickupPreparationFlowStatus,
      consumptionState: fulfillmentState.consumptionState,
      fulfillmentMode: fulfillmentState.fulfillmentMode,
      dayEndConsumptionReason: fulfillmentState.dayEndConsumptionReason,
      canRequestPrepare: !blockReason,
      requestBlockedReason: blockReason ? blockReason.code : null,
      requestBlockedMessage: blockReason ? blockReason.message : null,
      requestBlockedMessageAr: blockReason ? blockReason.messageAr : null,
      requestBlockedMessageEn: blockReason ? blockReason.messageEn : null,
      pickupLocation,
      restaurantHours: {
        openTime: restaurantHours.openTime,
        closeTime: restaurantHours.closeTime,
        isOpenNow: restaurantHours.isOpenNow,
      },
      pickupCode: showCode ? day.pickupCode ?? null : null,
      pickupCodeIssuedAt: showCode ? day.pickupCodeIssuedAt ?? null : null,
      fulfilledAt: day.status === "fulfilled" ? day.fulfilledAt ?? null : null,
    });
  } catch (err) {
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message);
    }
    logger.error("getPickupStatus failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId,
      date,
    });
    return buildErrorResult(500, "INTERNAL", {
      messageKey: "errors.subscription.pickupStatusFailed",
      fallbackMessage: "Failed to get pickup status",
    });
  }
}

module.exports = {
  getPickupStatusForClient,
  preparePickupForClient,
  resolvePickupPrepareBlockReason,
};
