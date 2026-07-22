"use strict";

const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const pickupBalanceService = require("./subscriptionPickupRequestBalanceService");

const TERMINAL_STATUSES = new Set(["fulfilled", "no_show", "canceled"]);

function serviceError(code, message, status = 409, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function optionalSession(options, session) {
  return session ? { ...options, session } : options;
}

async function readPickupRequest(pickupRequestId, session = null) {
  const query = SubscriptionPickupRequest.findById(pickupRequestId);
  if (session) query.session(session);
  const request = await query;
  if (!request) throw serviceError("PICKUP_REQUEST_NOT_FOUND", "Pickup request not found", 404);
  return request;
}

async function updateRecoveryState(pickupRequestId, set, { incAttempt = false, session = null } = {}) {
  const update = { $set: set };
  if (incAttempt) update.$inc = { reservationAttemptCount: 1 };
  return SubscriptionPickupRequest.findByIdAndUpdate(
    pickupRequestId,
    update,
    optionalSession({ new: true }, session)
  );
}

async function synchronizeCompletedReservationState(request, session = null) {
  if (!request) return request;
  const mealCount = Math.max(0, Number(request.mealCount || 0));
  if (request.creditsConsumedAt) {
    return updateRecoveryState(request._id, {
      reservationState: "consumed",
      reservationCompletedAt: request.creditsConsumedAt,
      reservationErrorCode: null,
      reservationErrorMessage: null,
    }, { session });
  }
  if (request.creditsReleasedAt) {
    return updateRecoveryState(request._id, {
      reservationState: "released",
      reservationCompletedAt: request.creditsReleasedAt,
      reservationErrorCode: null,
      reservationErrorMessage: null,
    }, { session });
  }
  if (request.creditsReserved || mealCount === 0) {
    const completedAt = request.creditsReservedAt || request.reservationCompletedAt || new Date();
    return updateRecoveryState(request._id, {
      creditsReserved: true,
      creditsReservedAt: request.creditsReservedAt || completedAt,
      reservationState: "reserved",
      reservationCompletedAt: completedAt,
      reservationErrorCode: null,
      reservationErrorMessage: null,
    }, { session });
  }
  return request;
}

async function recoverIncompletePickupReservation({
  pickupRequestId,
  subscriptionId = null,
  session = null,
} = {}) {
  if (!pickupRequestId) {
    throw serviceError("INVALID_ARGUMENTS", "pickupRequestId is required", 400);
  }

  let request = await readPickupRequest(pickupRequestId, session);
  if (subscriptionId && clean(request.subscriptionId) !== clean(subscriptionId)) {
    throw serviceError("SUBSCRIPTION_MISMATCH", "Pickup request does not belong to subscription", 400);
  }

  const mealCount = Math.max(0, Number(request.mealCount || 0));
  if (request.creditsReserved || request.creditsConsumedAt || request.creditsReleasedAt || mealCount === 0) {
    const synchronized = await synchronizeCompletedReservationState(request, session);
    return {
      recovered: false,
      alreadyComplete: true,
      pickupRequest: synchronized || request,
      mealCount,
    };
  }

  if (TERMINAL_STATUSES.has(clean(request.status))) {
    throw serviceError(
      "INCOMPLETE_TERMINAL_PICKUP_RESERVATION",
      "A terminal pickup request cannot acquire missing meal credits",
      409,
      { status: request.status, pickupRequestId: clean(request._id) }
    );
  }

  const attemptAt = new Date();
  request = await updateRecoveryState(request._id, {
    reservationState: "reserving",
    lastReservationAttemptAt: attemptAt,
    reservationErrorCode: null,
    reservationErrorMessage: null,
  }, { incAttempt: true, session }) || request;

  try {
    const reservation = await pickupBalanceService.reserveSubscriptionMealsForPickupRequest({
      subscriptionId: request.subscriptionId,
      pickupRequestId: request._id,
      mealCount,
      session,
    });
    const reservedRequest = reservation.pickupRequest || await readPickupRequest(request._id, session);
    const completedAt = reservedRequest.creditsReservedAt || new Date();
    const completed = await updateRecoveryState(request._id, {
      reservationState: "reserved",
      reservationCompletedAt: completedAt,
      reservationErrorCode: null,
      reservationErrorMessage: null,
    }, { session });
    return {
      recovered: Boolean(reservation.reserved),
      alreadyComplete: Boolean(reservation.alreadyReserved),
      pickupRequest: completed || reservedRequest,
      mealCount,
      allocationMode: reservation.allocationMode || reservedRequest.baseAllocationMode || "none",
    };
  } catch (err) {
    await updateRecoveryState(request._id, {
      reservationState: "failed",
      reservationErrorCode: clean(err && err.code) || "PICKUP_RESERVATION_FAILED",
      reservationErrorMessage: clean(err && err.message).slice(0, 500),
    }, { session }).catch(() => {});
    throw err;
  }
}

module.exports = {
  recoverIncompletePickupReservation,
  synchronizeCompletedReservationState,
};
