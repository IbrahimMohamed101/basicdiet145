"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const dateUtils = require("../../utils/date");
const {
  assertTransactionalSession,
} = require("./subscriptionEntitlementLedgerService");

const MAX_STACKING_DAY_MATERIALIZATION = 730;

function dayMaterializationError(code, message, status = 422, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function normalizeDateString(value, fieldName) {
  if (typeof value === "string" && dateUtils.isValidKSADateString(value.trim())) {
    return value.trim();
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw dayMaterializationError(
      "INVALID_STACKING_DAY_DATE",
      `${fieldName} must be a valid date`,
      422,
      { fieldName, value }
    );
  }
  return dateUtils.toKSADateString(parsed);
}

function normalizeDeliverySnapshot(batch = {}) {
  const delivery = batch.deliverySnapshot && typeof batch.deliverySnapshot === "object"
    ? batch.deliverySnapshot
    : {};
  const mode = String(delivery.mode || delivery.type || "delivery").trim().toLowerCase() === "pickup"
    ? "pickup"
    : "delivery";
  const slot = delivery.slot && typeof delivery.slot === "object" ? delivery.slot : {};
  return {
    mode,
    pickupLocationId: String(delivery.pickupLocationId || "").trim() || null,
    address: delivery.address && typeof delivery.address === "object"
      ? delivery.address
      : undefined,
    window: String(
      delivery.window
      || slot.window
      || delivery.deliveryWindow
      || ""
    ).trim() || undefined,
  };
}

function buildDayFulfillmentFields({ container = {}, batch = {} } = {}) {
  const batchDelivery = normalizeDeliverySnapshot(batch);
  const containerMode = String(container.deliveryMode || "delivery") === "pickup"
    ? "pickup"
    : "delivery";

  return {
    fulfillmentModeOverride: batchDelivery.mode !== containerMode
      ? batchDelivery.mode
      : null,
    pickupLocationIdOverride: batchDelivery.mode === "pickup"
      ? batchDelivery.pickupLocationId
      : null,
    deliveryAddressOverride: batchDelivery.mode === "delivery"
      ? batchDelivery.address
      : undefined,
    deliveryWindowOverride: batchDelivery.mode === "delivery"
      ? batchDelivery.window
      : undefined,
  };
}

function buildStackingSubscriptionDayEntries({
  container,
  batch,
} = {}) {
  if (!container || !container._id) {
    throw dayMaterializationError(
      "STACKING_DAY_CONTAINER_REQUIRED",
      "Subscription container is required"
    );
  }
  if (!batch || !batch._id) {
    throw dayMaterializationError(
      "STACKING_DAY_BATCH_REQUIRED",
      "Entitlement batch is required"
    );
  }

  const startDate = normalizeDateString(
    batch.effectiveStartDate,
    "effectiveStartDate"
  );
  const endDate = normalizeDateString(batch.endDate, "endDate");
  if (endDate < startDate) {
    throw dayMaterializationError(
      "STACKING_DAY_RANGE_INVALID",
      "Entitlement batch endDate cannot be before effectiveStartDate",
      422,
      { startDate, endDate }
    );
  }

  const fulfillmentFields = buildDayFulfillmentFields({ container, batch });
  const entries = [];
  let date = startDate;
  while (date <= endDate) {
    if (entries.length >= MAX_STACKING_DAY_MATERIALIZATION) {
      throw dayMaterializationError(
        "STACKING_DAY_RANGE_TOO_LARGE",
        "Entitlement batch day range exceeds the safety limit",
        422,
        {
          startDate,
          endDate,
          maxDays: MAX_STACKING_DAY_MATERIALIZATION,
        }
      );
    }
    entries.push({
      subscriptionId: container._id,
      date,
      status: "open",
      fulfillmentModeOverride: fulfillmentFields.fulfillmentModeOverride,
      pickupLocationIdOverride: fulfillmentFields.pickupLocationIdOverride,
      ...(fulfillmentFields.deliveryAddressOverride !== undefined
        ? { deliveryAddressOverride: fulfillmentFields.deliveryAddressOverride }
        : {}),
      ...(fulfillmentFields.deliveryWindowOverride !== undefined
        ? { deliveryWindowOverride: fulfillmentFields.deliveryWindowOverride }
        : {}),
    });
    date = dateUtils.addDaysToKSADateString(date, 1);
  }

  return entries;
}

function defaultRuntime() {
  return {
    upsertDays(entries, session) {
      if (!entries.length) {
        return Promise.resolve({
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 0,
        });
      }
      return SubscriptionDay.bulkWrite(
        entries.map((entry) => ({
          updateOne: {
            filter: {
              subscriptionId: entry.subscriptionId,
              date: entry.date,
            },
            update: { $setOnInsert: entry },
            upsert: true,
          },
        })),
        { ordered: false, session }
      );
    },
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function materializeStackingSubscriptionDaysTransactional({
  container,
  batch,
  session,
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  const entries = buildStackingSubscriptionDayEntries({ container, batch });
  const runtime = resolveRuntime(runtimeOverrides);
  const result = await runtime.upsertDays(entries, session);

  return {
    entries,
    requestedCount: entries.length,
    matchedCount: Number(result && result.matchedCount || 0),
    modifiedCount: Number(result && result.modifiedCount || 0),
    upsertedCount: Number(result && result.upsertedCount || 0),
    // Because updates use only $setOnInsert, an existing day is intentionally
    // left byte-for-byte unchanged. Repeated calls are therefore idempotent.
    idempotent: Number(result && result.upsertedCount || 0) === 0,
  };
}

module.exports = {
  MAX_STACKING_DAY_MATERIALIZATION,
  buildDayFulfillmentFields,
  buildStackingSubscriptionDayEntries,
  materializeStackingSubscriptionDaysTransactional,
  normalizeDeliverySnapshot,
};
