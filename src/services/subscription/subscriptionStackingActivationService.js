"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const CheckoutDraft = require("../../models/CheckoutDraft");
const Payment = require("../../models/Payment");
const {
  consumePromoCodeUsageReservation,
} = require("../promoCodeService");
const {
  assertTransactionalSession,
} = require("./subscriptionEntitlementLedgerService");
const {
  buildLegacyEntitlementBatchPayload,
  buildPurchaseEntitlementBatchPayload,
} = require("./subscriptionEntitlementBatchFactory");
const {
  ensureBatchByPayload,
} = require("./subscriptionEntitlementBatchPersistenceService");
const {
  projectSubscriptionEntitlements,
} = require("./subscriptionEntitlementProjectionService");
const {
  applyResolvedScheduleToBatchPayload,
  resolveStackingPurchaseSchedule,
} = require("./subscriptionStackingSchedulePolicyService");

function activationError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function stringId(value) {
  if (!value) return "";
  return String(value && value._id ? value._id : value);
}

function normalizeDate(value, fieldName) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw activationError(
      "INVALID_STACKING_ACTIVATION_DATE",
      `${fieldName} must be a valid date`,
      422,
      { fieldName, value }
    );
  }
  return date;
}

function maxDate(values, fieldName) {
  const dates = (Array.isArray(values) ? values : [])
    .filter(Boolean)
    .map((value) => normalizeDate(value, fieldName));
  if (dates.length === 0) {
    throw activationError(
      "STACKING_ACTIVATION_DATE_REQUIRED",
      `${fieldName} requires at least one date`,
      422
    );
  }
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function hasPaidPurchaseExtras(subscriptionPayload = {}) {
  const premiumRows = Array.isArray(subscriptionPayload.premiumBalance)
    ? subscriptionPayload.premiumBalance
    : [];
  const addonRows = Array.isArray(subscriptionPayload.addonSubscriptions)
    ? subscriptionPayload.addonSubscriptions
    : [];
  const addonBalanceRows = Array.isArray(subscriptionPayload.addonBalance)
    ? subscriptionPayload.addonBalance
    : [];
  return premiumRows.length > 0 || addonRows.length > 0 || addonBalanceRows.length > 0;
}

function buildContainerMirror({ container, batches, businessDate, now = new Date() } = {}) {
  if (!container) {
    throw activationError(
      "STACKING_CONTAINER_REQUIRED",
      "An active subscription container is required",
      422
    );
  }
  const projection = projectSubscriptionEntitlements({ batches, businessDate });
  const allBatches = Array.isArray(batches) ? batches : [];
  const endDate = maxDate(
    [container.endDate, ...allBatches.map((batch) => batch.endDate)],
    "endDate"
  );
  const validityEndDate = maxDate(
    [
      container.validityEndDate || container.endDate,
      ...allBatches.map((batch) => batch.validityEndDate || batch.endDate),
    ],
    "validityEndDate"
  );

  return {
    endDate,
    validityEndDate,
    totalMeals: Number(projection.mealBalance.totalMeals || 0),
    remainingMeals: Number(projection.mealBalance.remainingMeals || 0),
    reservedMeals: Number(projection.mealBalance.reservedMeals || 0),
    consumedMeals: Number(projection.mealBalance.consumedMeals || 0),
    forfeitedMeals: Number(projection.mealBalance.forfeitedMeals || 0),
    selectedMealsPerDay: Math.max(
      1,
      Number(projection.requiredMealsPerDay || container.selectedMealsPerDay || 1)
    ),
    stackingMirror: {
      version: 1,
      updatedAt: now,
      businessDate: String(businessDate || ""),
      batchCount: allBatches.length,
      activeBatchCount: Number(projection.batchCount || 0),
    },
  };
}

function buildDayFulfillmentOverrides({ container, batch } = {}) {
  const containerMode = container && container.deliveryMode === "pickup"
    ? "pickup"
    : "delivery";
  const delivery = batch && batch.deliverySnapshot && typeof batch.deliverySnapshot === "object"
    ? batch.deliverySnapshot
    : {};
  const batchMode = String(delivery.mode || delivery.type || "delivery") === "pickup"
    ? "pickup"
    : "delivery";

  return {
    fulfillmentModeOverride: batchMode !== containerMode ? batchMode : null,
    pickupLocationIdOverride:
      batchMode === "pickup" && delivery.pickupLocationId
        ? String(delivery.pickupLocationId)
        : null,
    deliveryAddressOverride:
      batchMode === "delivery" && delivery.address
        ? delivery.address
        : undefined,
    deliveryWindowOverride:
      batchMode === "delivery"
        ? String(
          delivery.window
          || (delivery.slot && delivery.slot.window)
          || delivery.deliveryWindow
          || ""
        ) || undefined
        : undefined,
  };
}

function defaultRuntime() {
  return {
    async findActiveContainer({ userId, session }) {
      return Subscription.findOne({
        userId,
        status: "active",
      }).sort({ createdAt: -1 }).session(session);
    },
    async findBatches({ containerSubscriptionId, session }) {
      return SubscriptionEntitlementBatch.find({
        containerSubscriptionId,
      }).sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 }).session(session).lean();
    },
    async findStartDay({ containerSubscriptionId, date, session }) {
      return SubscriptionDay.findOne({
        subscriptionId: containerSubscriptionId,
        date,
      }).session(session).lean();
    },
    ensureBatchByPayload: (args) => ensureBatchByPayload(args),
    async updateContainer({ containerId, update, session }) {
      return Subscription.findOneAndUpdate(
        { _id: containerId, status: "active" },
        { $set: update },
        { new: true, session }
      );
    },
    async updateDraftCompleted({ draftId, containerId, now, session }) {
      return CheckoutDraft.findOneAndUpdate(
        { _id: draftId, status: { $in: ["pending_payment", "completed"] } },
        {
          $set: {
            status: "completed",
            subscriptionId: containerId,
            activationSubscriptionId: containerId,
            completedAt: now,
            failedAt: null,
            failureReason: "",
          },
        },
        { new: true, session }
      );
    },
    async linkPayment({ paymentId, containerId, draftId, session }) {
      if (!paymentId) return null;
      return Payment.findOneAndUpdate(
        { _id: paymentId, status: "paid" },
        {
          $set: {
            subscriptionId: containerId,
            checkoutDraftId: draftId,
            applied: true,
          },
        },
        { new: true, session }
      );
    },
    consumePromoReservation: (draftId, subscriptionId, options) => (
      consumePromoCodeUsageReservation(draftId, subscriptionId, options)
    ),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function activatePaidDraftIntoExistingContainerTransactional({
  draft,
  payment,
  subscriptionPayload,
  businessDate,
  session,
  now = new Date(),
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  const runtime = resolveRuntime(runtimeOverrides);

  if (!draft || !draft._id || !draft.userId) {
    throw activationError(
      "INVALID_STACKING_DRAFT",
      "A paid checkout draft is required",
      422
    );
  }
  if (String(payment && payment.status || "").toLowerCase() !== "paid") {
    throw activationError(
      "STACKING_PAYMENT_NOT_PAID",
      "Stacking activation requires a paid payment",
      422
    );
  }
  if (!subscriptionPayload) {
    throw activationError(
      "INVALID_STACKING_ACTIVATION_PAYLOAD",
      "subscriptionPayload is required",
      422
    );
  }
  if (hasPaidPurchaseExtras(subscriptionPayload)) {
    throw activationError(
      "STACKING_PREMIUM_ADDON_WRITE_NOT_READY",
      "Premium and add-on stacking writes are not enabled yet",
      503
    );
  }

  const container = await runtime.findActiveContainer({
    userId: draft.userId,
    session,
  });
  if (!container) {
    return {
      outcome: "delegate_to_standard_activation",
      container: null,
      legacyBatch: null,
      purchaseBatch: null,
    };
  }

  const legacyPayload = buildLegacyEntitlementBatchPayload({
    subscription: container,
    businessDate,
    now,
  });
  const legacyResult = await runtime.ensureBatchByPayload({
    payload: legacyPayload,
    session,
  });

  let existingBatches = await runtime.findBatches({
    containerSubscriptionId: container._id,
    session,
  });
  if (!existingBatches.some((batch) => batch.sourceKey === legacyPayload.sourceKey)) {
    existingBatches = [
      ...existingBatches,
      legacyResult.batch && typeof legacyResult.batch.toObject === "function"
        ? legacyResult.batch.toObject()
        : legacyResult.batch,
    ];
  }

  const purchasePayload = buildPurchaseEntitlementBatchPayload({
    draft,
    payment,
    subscriptionPayload,
    containerSubscriptionId: container._id,
    businessDate,
    now,
  });
  const requestedDate = normalizeDate(
    purchasePayload.effectiveStartDate,
    "purchase.effectiveStartDate"
  ).toISOString().slice(0, 10);
  const requestedStartDay = await runtime.findStartDay({
    containerSubscriptionId: container._id,
    date: requestedDate,
    session,
  });
  const schedule = resolveStackingPurchaseSchedule({
    purchase: purchasePayload,
    existingBatches,
    businessDate,
    requestedStartDay,
  });
  const scheduledPurchasePayload = applyResolvedScheduleToBatchPayload(
    purchasePayload,
    schedule
  );
  const purchaseResult = await runtime.ensureBatchByPayload({
    payload: scheduledPurchasePayload,
    session,
  });
  const purchaseBatch = purchaseResult.batch && typeof purchaseResult.batch.toObject === "function"
    ? purchaseResult.batch.toObject()
    : purchaseResult.batch;

  const allBatches = existingBatches
    .filter((batch) => String(batch.sourceKey || "") !== String(purchaseBatch.sourceKey || ""))
    .concat(purchaseBatch);
  const containerMirror = buildContainerMirror({
    container,
    batches: allBatches,
    businessDate,
    now,
  });
  const updatedContainer = await runtime.updateContainer({
    containerId: container._id,
    update: containerMirror,
    session,
  });
  if (!updatedContainer) {
    throw activationError(
      "STACKING_CONTAINER_UPDATE_CONFLICT",
      "The active subscription container changed during stacking activation",
      409,
      { containerSubscriptionId: stringId(container._id) }
    );
  }

  const updatedDraft = await runtime.updateDraftCompleted({
    draftId: draft._id,
    containerId: container._id,
    now,
    session,
  });
  if (!updatedDraft) {
    throw activationError(
      "STACKING_DRAFT_COMPLETION_CONFLICT",
      "Checkout draft could not be marked completed",
      409,
      { draftId: stringId(draft._id) }
    );
  }

  const linkedPayment = await runtime.linkPayment({
    paymentId: payment._id,
    containerId: container._id,
    draftId: draft._id,
    session,
  });
  if (!linkedPayment) {
    throw activationError(
      "STACKING_PAYMENT_LINK_CONFLICT",
      "Paid payment could not be linked to the subscription container",
      409,
      { paymentId: stringId(payment._id) }
    );
  }

  if (draft.promo && draft.promo.usageId) {
    await runtime.consumePromoReservation(
      draft._id,
      container._id,
      { session }
    );
  }

  return {
    outcome: "stacked_into_existing_container",
    container: updatedContainer,
    legacyBatch: legacyResult.batch,
    purchaseBatch: purchaseResult.batch,
    schedule,
    idempotent: Boolean(
      legacyResult.idempotent
      && purchaseResult.idempotent
      && String(draft.status || "") === "completed"
    ),
    fulfillmentOverrides: buildDayFulfillmentOverrides({
      container,
      batch: purchaseBatch,
    }),
  };
}

module.exports = {
  activatePaidDraftIntoExistingContainerTransactional,
  buildContainerMirror,
  buildDayFulfillmentOverrides,
  hasPaidPurchaseExtras,
};
