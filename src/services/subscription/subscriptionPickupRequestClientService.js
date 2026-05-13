"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
require("../../models/Plan");
const dateUtils = require("../../utils/date");
const { validateDayBeforeLockOrPrepare } = require("./subscriptionDayExecutionValidationService");
const {
  reserveSubscriptionMealsForPickupRequest,
} = require("./subscriptionPickupRequestBalanceService");
const { assertRestaurantOpenForOrdering } = require("../restaurantHoursService");

const PICKUP_REQUEST_ALLOWED_DAY_STATUSES = [
  "open",
  "locked",
  "in_preparation",
  "out_for_delivery",
  "ready_for_pickup",
  "fulfilled",
  "consumed_without_preparation",
  "delivery_canceled",
  "canceled_at_branch",
  "no_show",
];
const ACTIVE_PICKUP_REQUEST_STATUSES = ["locked", "in_preparation", "ready_for_pickup"];
const TERMINAL_PICKUP_REQUEST_STATUSES = ["fulfilled", "no_show", "canceled"];

const PICKUP_REQUEST_STATUS_COPY = {
  locked: {
    currentStep: 2,
    statusLabel: "Your order is locked",
    message: "Modification period has ended. Waiting for kitchen.",
  },
  in_preparation: {
    currentStep: 3,
    statusLabel: "Kitchen is preparing your meals",
    message: "Chef is hand-picking ingredients for your order.",
  },
  ready_for_pickup: {
    currentStep: 4,
    statusLabel: "Your order is ready",
    message: "Use this pickup code at the branch.",
  },
  fulfilled: {
    currentStep: 4,
    statusLabel: "Completed",
    message: "Order picked up successfully.",
  },
  no_show: {
    currentStep: 4,
    statusLabel: "Pickup window ended without collection",
    message: "Your prepared pickup was not collected.",
  },
  canceled: {
    currentStep: 1,
    statusLabel: "Canceled",
    message: "Pickup request was canceled.",
  },
};

function createServiceError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function withOptionalSession(options, session) {
  return session ? { ...options, session } : options;
}

function assertValidMealCount(mealCount) {
  if (!Number.isInteger(mealCount) || mealCount <= 0) {
    throw createServiceError("INVALID_MEAL_COUNT", "mealCount must be a positive integer", 400);
  }
}

function buildPickupRequestSnapshot(day) {
  return {
    dayStatus: day && day.status ? day.status : "open",
    mealSelections: Array.isArray(day && day.selections) ? day.selections : [],
    mealSlots: Array.isArray(day && day.mealSlots) ? day.mealSlots : [],
    materializedMeals: Array.isArray(day && day.materializedMeals) ? day.materializedMeals : [],
    addons: Array.isArray(day && day.addonSelections) ? day.addonSelections : [],
    premium: Array.isArray(day && day.premiumUpgradeSelections) ? day.premiumUpgradeSelections : [],
    createdFrom: "client_pickup_request",
  };
}

function stringifyId(value) {
  return value ? String(value) : null;
}

function mapSubscriptionPickupRequestStatus(pickupRequest, { idempotent = false, includeNextAction = true } = {}) {
  const status = String(pickupRequest.status || "locked");
  const copy = PICKUP_REQUEST_STATUS_COPY[status] || PICKUP_REQUEST_STATUS_COPY.locked;
  const showCode = ["ready_for_pickup", "fulfilled"].includes(pickupRequest.status);
  const isReady = ["ready_for_pickup", "fulfilled"].includes(status);
  const isCompleted = TERMINAL_PICKUP_REQUEST_STATUSES.includes(status);

  const payload = {
    requestId: stringifyId(pickupRequest._id),
    subscriptionId: stringifyId(pickupRequest.subscriptionId),
    subscriptionDayId: stringifyId(pickupRequest.subscriptionDayId),
    date: pickupRequest.date,
    mealCount: Number(pickupRequest.mealCount || 0),
    currentStep: copy.currentStep,
    status,
    statusLabel: copy.statusLabel,
    message: copy.message,
    isReady,
    isCompleted,
    pickupCode: showCode ? pickupRequest.pickupCode || null : null,
    pickupCodeIssuedAt: showCode ? pickupRequest.pickupCodeIssuedAt || null : null,
    fulfilledAt: pickupRequest.status === "fulfilled" ? pickupRequest.fulfilledAt || null : null,
    createdAt: pickupRequest.createdAt || null,
    creditsReserved: Boolean(pickupRequest.creditsReserved),
    idempotent,
  };
  if (includeNextAction) {
    payload.nextAction = "poll_pickup_request_status";
  }
  return payload;
}

const mapPickupRequestForClient = mapSubscriptionPickupRequestStatus;

async function findExistingByIdempotencyKey({
  subscriptionId,
  userId,
  idempotencyKey,
  session = null,
}) {
  if (!idempotencyKey) return null;
  const query = SubscriptionPickupRequest.findOne({
    subscriptionId,
    userId,
    idempotencyKey,
  });
  if (session) query.session(session);
  return query;
}

async function createPickupRequestDocument({
  subscription,
  day,
  date,
  mealCount,
  idempotencyKey,
  session = null,
}) {
  const createPayload = {
    subscriptionId: subscription._id,
    subscriptionDayId: day._id,
    userId: subscription.userId,
    date,
    mealCount,
    status: "locked",
    idempotencyKey: idempotencyKey || null,
    snapshot: buildPickupRequestSnapshot(day),
  };

  const created = await SubscriptionPickupRequest.create(
    [createPayload],
    withOptionalSession({}, session)
  );
  return created[0];
}

async function createSubscriptionPickupRequestForClient({
  userId,
  subscriptionId,
  date,
  mealCount,
  idempotencyKey = null,
  lang = "en",
  session = null,
} = {}) {
  const normalizedMealCount = Number(mealCount);
  assertValidMealCount(normalizedMealCount);

  const normalizedIdempotencyKey = idempotencyKey ? String(idempotencyKey).trim() : null;

  const subscriptionQuery = Subscription.findById(subscriptionId).populate("planId");
  if (session) subscriptionQuery.session(session);
  const subscription = await subscriptionQuery;
  if (!subscription) {
    throw createServiceError("NOT_FOUND", "Subscription not found", 404);
  }
  if (String(subscription.userId) !== String(userId)) {
    throw createServiceError("FORBIDDEN", "Forbidden", 403);
  }
  if (subscription.status !== "active") {
    throw createServiceError("SUB_INACTIVE", "Subscription is not active", 422);
  }
  if (subscription.deliveryMode !== "pickup") {
    throw createServiceError("INVALID_DELIVERY_MODE", "Delivery mode is not pickup", 400);
  }

  await assertRestaurantOpenForOrdering({
    pickupLocationId: subscription.pickupLocationId,
    deliveryMode: subscription.deliveryMode,
  });

  const today = dateUtils.getTodayKSADate();
  if (date !== today) {
    throw createServiceError("INVALID_DATE", "Pickup request can only be created for the current day", 400);
  }

  const existing = await findExistingByIdempotencyKey({
    subscriptionId: subscription._id,
    userId,
    idempotencyKey: normalizedIdempotencyKey,
    session,
  });
  if (existing) {
    return {
      pickupRequest: existing,
      data: mapPickupRequestForClient(existing, { lang, idempotent: true }),
      idempotent: true,
    };
  }

  const dayQuery = SubscriptionDay.findOne({ subscriptionId: subscription._id, date });
  if (session) dayQuery.session(session);
  const day = await dayQuery;
  if (!day) {
    throw createServiceError("NOT_FOUND", "Day not found", 404);
  }
  if (["skipped", "frozen"].includes(String(day.status || "open"))) {
    throw createServiceError("DAY_SKIPPED", "This day is skipped or frozen", 409);
  }

  validateDayBeforeLockOrPrepare({
    subscription,
    day,
    allowedStatuses: PICKUP_REQUEST_ALLOWED_DAY_STATUSES,
  });

  if (Number(subscription.remainingMeals || 0) < normalizedMealCount) {
    throw createServiceError("INSUFFICIENT_CREDITS", "رصيد وجباتك غير كافٍ", 422);
  }

  let pickupRequest;
  try {
    pickupRequest = await createPickupRequestDocument({
      subscription,
      day,
      date,
      mealCount: normalizedMealCount,
      idempotencyKey: normalizedIdempotencyKey,
      session,
    });
  } catch (err) {
    if (err && err.code === 11000 && normalizedIdempotencyKey) {
      const racedExisting = await findExistingByIdempotencyKey({
        subscriptionId: subscription._id,
        userId,
        idempotencyKey: normalizedIdempotencyKey,
        session,
      });
      if (racedExisting) {
        return {
          pickupRequest: racedExisting,
          data: mapPickupRequestForClient(racedExisting, { lang, idempotent: true }),
          idempotent: true,
        };
      }
    }
    throw err;
  }

  try {
    const reservation = await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: normalizedMealCount,
      session,
    });
    pickupRequest = reservation.pickupRequest;
  } catch (err) {
    await SubscriptionPickupRequest.deleteOne(
      { _id: pickupRequest._id, creditsReserved: { $ne: true } },
      withOptionalSession({}, session)
    );
    throw err;
  }

  return {
    pickupRequest,
    data: mapPickupRequestForClient(pickupRequest, { lang, idempotent: false }),
    idempotent: false,
  };
}

async function assertSubscriptionOwnership({ subscriptionId, userId, session = null }) {
  const query = Subscription.findById(subscriptionId).select("_id userId");
  if (session) query.session(session);
  const subscription = await query.lean();
  if (!subscription) {
    throw createServiceError("NOT_FOUND", "Subscription not found", 404);
  }
  if (String(subscription.userId) !== String(userId)) {
    throw createServiceError("FORBIDDEN", "Forbidden", 403);
  }
  return subscription;
}

async function listSubscriptionPickupRequestsForClient({
  userId,
  subscriptionId,
  date = null,
  status = "all",
  session = null,
} = {}) {
  await assertSubscriptionOwnership({ subscriptionId, userId, session });

  const query = { subscriptionId };
  if (date) query.date = String(date);
  if (status === "active") {
    query.status = { $in: ACTIVE_PICKUP_REQUEST_STATUSES };
  }

  const findQuery = SubscriptionPickupRequest.find(query).sort({ createdAt: -1 });
  if (session) findQuery.session(session);
  const requests = await findQuery.lean();
  return {
    requests: requests.map((request) => mapSubscriptionPickupRequestStatus(request, { includeNextAction: false })),
  };
}

async function getSubscriptionPickupRequestStatusForClient({
  userId,
  subscriptionId,
  requestId,
  session = null,
} = {}) {
  await assertSubscriptionOwnership({ subscriptionId, userId, session });

  const query = SubscriptionPickupRequest.findOne({ _id: requestId, subscriptionId });
  if (session) query.session(session);
  const pickupRequest = await query.lean();
  if (!pickupRequest) {
    throw createServiceError("NOT_FOUND", "Pickup request not found", 404);
  }
  if (String(pickupRequest.userId) !== String(userId)) {
    throw createServiceError("FORBIDDEN", "Forbidden", 403);
  }
  return mapSubscriptionPickupRequestStatus(pickupRequest, { includeNextAction: true });
}

module.exports = {
  createSubscriptionPickupRequestForClient,
  getSubscriptionPickupRequestStatusForClient,
  listSubscriptionPickupRequestsForClient,
  mapPickupRequestForClient,
  mapSubscriptionPickupRequestStatus,
};
