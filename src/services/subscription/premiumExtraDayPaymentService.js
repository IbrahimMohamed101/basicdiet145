const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Payment = require("../../models/Payment");
const { logger } = require("../../utils/logger");
const { buildPaymentDescription } = require("../../utils/subscription/subscriptionWriteLocalization");
const {
  buildPaymentRedirectContext,
  normalizeProviderPaymentStatus,
  pickProviderInvoicePayment,
} = require("../paymentProviderMetadataService");
const {
  buildPaymentMetadataWithInitiationFields,
  buildPremiumExtraDayPaymentStatusPayload,
} = require("./subscriptionPaymentPayloadService");
const {
  buildErrorResult,
  buildSuccessResult,
  isReusableInitiatedPayment,
  buildNonCheckoutInitiationPayload,
  resolveNonCheckoutIdempotency,
} = require("./subscriptionNonCheckoutPaymentService");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");
const {
  recomputePlannerMetaFromSlots,
  projectMaterializedAndLegacyForExistingSlots,
} = require("./mealSlotPlannerService");
const { getPaymentMetadata } = require("./subscriptionCheckoutHelpers");
const { applyCommercialStateToDay } = require("./subscriptionDayCommercialStateService");
const {
  assertSubscriptionDayModifiable,
  localizePolicyErrorMessage,
} = require("./subscriptionDayModificationPolicyService");

const SYSTEM_CURRENCY = "SAR";
const PREMIUM_EXTRA_DAY_PAYMENT_TYPE = "premium_extra_day";

function toPlainObject(doc) {
  return doc && typeof doc.toObject === "function" ? doc.toObject() : { ...(doc || {}) };
}

function buildCanonicalPlannerRevisionHashForPayment(dayLike = {}) {
  return applyCommercialStateToDay(toPlainObject(dayLike)).plannerRevisionHash;
}

function normalizeCurrencyValue(value) {
  return String(value || SYSTEM_CURRENCY).trim().toUpperCase();
}

function assertSystemCurrencyOrThrow(value, fieldName) {
  const currency = normalizeCurrencyValue(value);
  if (currency !== SYSTEM_CURRENCY) {
    const err = new Error(`${fieldName} must use ${SYSTEM_CURRENCY}`);
    err.code = "CONFIG";
    err.status = 500;
    throw err;
  }
  return currency;
}

function getUpdateMatchedCount(result) {
  if (!result) return 0;
  if (typeof result.matchedCount === "number") return result.matchedCount;
  if (typeof result.n === "number") return result.n;
  if (typeof result.modifiedCount === "number" && result.modifiedCount > 0) return result.modifiedCount;
  if (typeof result.nModified === "number" && result.nModified > 0) return result.nModified;
  return 0;
}

function getUpdateModifiedCount(result) {
  if (!result) return 0;
  if (typeof result.modifiedCount === "number") return result.modifiedCount;
  if (typeof result.nModified === "number") return result.nModified;
  return 0;
}

function isPremiumExtraDayLinkedToPayment(day, payment, expectedRevisionHash) {
  const premiumExtraPayment = day && day.premiumExtraPayment ? day.premiumExtraPayment : {};
  return Boolean(
    premiumExtraPayment.status === "pending"
    && String(premiumExtraPayment.paymentId || "") === String(payment && payment._id ? payment._id : "")
    && String(premiumExtraPayment.providerInvoiceId || "") === String(payment && payment.providerInvoiceId ? payment.providerInvoiceId : "")
    && String(premiumExtraPayment.revisionHash || "") === String(expectedRevisionHash || "")
  );
}

async function markPremiumExtraInitiationFailed(payment, reason) {
  if (!payment || !payment._id) return;
  await Payment.updateOne(
    { _id: payment._id },
    {
      $set: {
        status: "failed",
        applied: false,
        metadata: Object.assign({}, payment.metadata || {}, {
          initiationFailureReason: reason,
        }),
      },
    }
  );
}


function buildPremiumExtraRequestPayload({ sub, day, revisionHash, extraPremiumCount, amountHalala }) {
  return {
    subscriptionId: String(sub._id),
    dayId: String(day._id),
    date: String(day.date),
    revisionHash: String(revisionHash || ""),
    extraPremiumCount: Number(extraPremiumCount || 0),
    amountHalala: Number(amountHalala || 0),
  };
}

function buildPremiumExtraInitiationSuccessPayload({
  payment,
  amountHalala,
  currency = SYSTEM_CURRENCY,
  paymentUrl,
  providerInvoiceId,
  reused = false,
}) {
  const basePayload = buildNonCheckoutInitiationPayload(payment, PREMIUM_EXTRA_DAY_PAYMENT_TYPE);
  const resolvedAmount = Number(
    amountHalala !== undefined && amountHalala !== null
      ? amountHalala
      : basePayload.totalHalala
  );
  const invoiceId = providerInvoiceId
    ? String(providerInvoiceId)
    : payment && payment.providerInvoiceId
      ? String(payment.providerInvoiceId)
      : (basePayload.invoice_id || null);
  const paymentId = payment && payment.id
    ? String(payment.id)
    : (payment && payment._id ? String(payment._id) : (basePayload.payment_id || null));

  return {
    paymentId,
    payment_id: paymentId,
    payment_url: paymentUrl || basePayload.payment_url || "",
    providerInvoiceId: invoiceId,
    invoice_id: invoiceId,
    amountHalala: resolvedAmount,
    totalHalala: resolvedAmount,
    currency: normalizeCurrencyValue(currency || (payment && payment.currency) || SYSTEM_CURRENCY),
    reused: Boolean(reused),
  };
}

function classifyPremiumExtraExistingPayment({
  payment,
  expectedRequestHash,
  subscriptionId,
  dayId,
}) {
  if (!payment) {
    return { kind: "missing" };
  }

  if (String(payment.type || "") !== PREMIUM_EXTRA_DAY_PAYMENT_TYPE) {
    return { kind: "invalid", reason: "wrong_type" };
  }

  const metadata = getPaymentMetadata(payment);
  if (metadata.subscriptionId && String(metadata.subscriptionId) !== String(subscriptionId)) {
    return { kind: "invalid", reason: "subscription_mismatch" };
  }
  if (metadata.dayId && String(metadata.dayId) !== String(dayId)) {
    return { kind: "invalid", reason: "day_mismatch" };
  }

  if (
    payment.operationRequestHash
    && expectedRequestHash
    && String(payment.operationRequestHash) !== String(expectedRequestHash)
  ) {
    return { kind: "invalid", reason: "request_hash_mismatch" };
  }

  if (payment.applied === true || String(payment.status || "") === "paid") {
    return { kind: "already_paid" };
  }

  if (isReusableInitiatedPayment(payment)) {
    return { kind: "reusable" };
  }

  if (["failed", "canceled", "expired"].includes(String(payment.status || ""))) {
    return { kind: "replaceable_terminal" };
  }

  return { kind: "invalid", reason: `unsupported_status:${String(payment.status || "unknown")}` };
}

async function settlePaidPremiumExtraDayPayment({
  subscription,
  day,
  payment,
  session,
  userId = null,
  logDate = null,
  writeLogFn = null,
}) {
  const paymentMetadata = getPaymentMetadata(payment);
  const currentMealSlots = Array.isArray(day.mealSlots) ? day.mealSlots : [];
  const currentRevisionHash = buildCanonicalPlannerRevisionHashForPayment(day);
  const hasPendingPremiumSlots = currentMealSlots.some(
    (slot) => slot && slot.isPremium && slot.premiumSource === "pending_payment"
  );
  const existingPremiumExtraPayment = day && day.premiumExtraPayment
    ? (day.premiumExtraPayment.toObject ? day.premiumExtraPayment.toObject() : { ...day.premiumExtraPayment })
    : {};

  if (String(paymentMetadata.revisionHash || "") !== String(currentRevisionHash)) {
    day.plannerRevisionHash = currentRevisionHash;
    day.premiumExtraPayment = {
      ...existingPremiumExtraPayment,
      status: "revision_mismatch",
      revisionHash: currentRevisionHash,
    };
    await day.save({ session });
    return { applied: false, reason: "revision_mismatch" };
  }

  if (!hasPendingPremiumSlots && existingPremiumExtraPayment.status === "paid") {
    if (
      String(day.plannerRevisionHash || "") !== String(currentRevisionHash)
      || String(existingPremiumExtraPayment.revisionHash || "") !== String(currentRevisionHash)
    ) {
      day.plannerRevisionHash = currentRevisionHash;
      day.premiumExtraPayment = {
        ...existingPremiumExtraPayment,
        status: "paid",
        revisionHash: currentRevisionHash,
      };
      await day.save({ session });
    }
    return { applied: true, alreadySettled: true };
  }

  const settledMealSlots = currentMealSlots.map((slot) => {
    if (slot && slot.isPremium && slot.premiumSource === "pending_payment") {
      return { ...(slot.toObject ? slot.toObject() : slot), premiumSource: "paid_extra" };
    }
    return slot;
  });
  const requiredSlotCount = resolveMealsPerDay(subscription);
  const { plannerMeta } = recomputePlannerMetaFromSlots({
    mealSlots: settledMealSlots,
    requiredSlotCount,
  });
  const settledRevisionHash = buildCanonicalPlannerRevisionHashForPayment({
    ...toPlainObject(day),
    mealSlots: settledMealSlots,
    plannerMeta,
  });
  const projection = await projectMaterializedAndLegacyForExistingSlots({
    mealSlots: settledMealSlots,
    session,
  });

  day.mealSlots = settledMealSlots;
  day.materializedMeals = projection.materializedMeals;
  day.selections = projection.selections;
  day.premiumUpgradeSelections = projection.premiumSelections;
  day.baseMealSlots = projection.baseMealSlots;
  day.plannerMeta = plannerMeta;
  day.plannerRevisionHash = settledRevisionHash;
  day.premiumExtraPayment = {
    ...existingPremiumExtraPayment,
    status: "paid",
    paidAt: payment.paidAt || existingPremiumExtraPayment.paidAt || new Date(),
    paymentId: payment._id,
    providerInvoiceId: payment.providerInvoiceId || existingPremiumExtraPayment.providerInvoiceId || null,
    amountHalala: Number(existingPremiumExtraPayment.amountHalala || payment.amount || 0),
    currency: existingPremiumExtraPayment.currency || payment.currency || SYSTEM_CURRENCY,
    revisionHash: settledRevisionHash,
    extraPremiumCount: Number(
      existingPremiumExtraPayment.extraPremiumCount
      || plannerMeta.premiumPaidExtraCount
      || 0
    ),
  };
  await day.save({ session });

  if (typeof writeLogFn === "function") {
    await writeLogFn({
      entityType: "subscription_day",
      entityId: day._id,
      action: "premium_extra_payment_verified",
      byUserId: userId,
      byRole: "client",
      meta: {
        paymentId: payment._id,
        date: day.date,
        amountHalala: payment.amount,
      },
    }, { subscriptionId: String(subscription._id), date: logDate || day.date });
  }

  return { applied: true, alreadySettled: false };
}

async function createPremiumExtraDayPaymentFlow({
  subscriptionId,
  date,
  userId,
  lang,
  headers = {},
  body = {},
  runtime,
  ensureActiveFn,
}) {
  try {
    const sub = await Subscription.findById(subscriptionId);
    if (!sub) {
      return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
    }
    if (String(sub.userId) !== String(userId)) {
      return buildErrorResult(403, "FORBIDDEN", "Forbidden");
    }

    ensureActiveFn(sub, date);

    const day = await SubscriptionDay.findOne({ subscriptionId, date });
    if (!day) {
      return buildErrorResult(404, "NOT_FOUND", "Day not found");
    }
    try {
      await assertSubscriptionDayModifiable({
        subscription: sub,
        day,
        date,
      });
    } catch (err) {
      return buildErrorResult(err.status || 400, err.code || "INVALID_DATE", localizePolicyErrorMessage(err, lang), err.details);
    }
    if (day.status !== "open") {
      return buildErrorResult(409, "LOCKED", "Day is locked");
    }

    const derivedDay = applyCommercialStateToDay(typeof day.toObject === "function" ? day.toObject() : day);
    const notRequiredDetails = {
      requiresPayment: derivedDay.paymentRequirement.requiresPayment,
      premiumPendingPaymentCount: Number(derivedDay.premiumSummary.pendingPaymentCount || 0),
      commercialState: derivedDay.commercialState,
    };
    if (!derivedDay.paymentRequirement.requiresPayment) {
      return buildErrorResult(409, "PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED", "This day requires no premium extra payment", notRequiredDetails);
    }
    if (derivedDay.premiumExtraPayment.status === "paid") {
      return buildErrorResult(409, "PREMIUM_EXTRA_ALREADY_PAID", "Premium extra for this day is already paid");
    }
    if (!derivedDay.paymentRequirement.canCreatePayment) {
      return buildErrorResult(409, "PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED", "This day has no payable premium extra state", notRequiredDetails);
    }

    const currentRevisionHash = derivedDay.plannerRevisionHash;
    if (
      body
      && body.plannerRevisionHash !== undefined
      && String(body.plannerRevisionHash || "") !== String(derivedDay.plannerRevisionHash)
    ) {
      return buildErrorResult(
        409,
        "PREMIUM_EXTRA_REVISION_MISMATCH",
        "Planner changed since payment creation",
        {
          expectedPlannerRevisionHash: derivedDay.plannerRevisionHash,
          receivedPlannerRevisionHash: String(body.plannerRevisionHash || ""),
        }
      );
    }
    const extraPremiumCount = Number(derivedDay.premiumExtraPayment.extraPremiumCount || 0);
    const amountHalala = Number(derivedDay.premiumExtraPayment.amountHalala || 0);
    if (extraPremiumCount <= 0 || amountHalala <= 0) {
      return buildErrorResult(
        409,
        "PREMIUM_EXTRA_PAYMENT_NOT_REQUIRED",
        "This day has no pending premium extra payment amount",
        notRequiredDetails
      );
    }

    const effectivePayload = buildPremiumExtraRequestPayload({
      sub,
      day,
      revisionHash: currentRevisionHash,
      extraPremiumCount,
      amountHalala,
    });
    const operationRequestHash = runtime.buildOperationRequestHash({
      scope: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
      userId,
      effectivePayload,
    });

    if (derivedDay.premiumExtraPayment.paymentId && derivedDay.premiumExtraPayment.status === "pending") {
      const existingPayment = await Payment.findById(derivedDay.premiumExtraPayment.paymentId).lean();
      const classification = classifyPremiumExtraExistingPayment({
        payment: existingPayment,
        expectedRequestHash: operationRequestHash,
        subscriptionId: sub._id,
        dayId: day._id,
      });

      if (classification.kind === "reusable") {
        return buildSuccessResult(200, {
          ...buildPremiumExtraInitiationSuccessPayload({
            payment: existingPayment,
            amountHalala,
            currency: existingPayment.currency || derivedDay.premiumExtraPayment.currency || SYSTEM_CURRENCY,
            reused: true,
          }),
          plannerRevisionHash: derivedDay.plannerRevisionHash,
          premiumExtraPayment: derivedDay.premiumExtraPayment,
          premiumSummary: derivedDay.premiumSummary,
          paymentRequirement: derivedDay.paymentRequirement,
          commercialState: derivedDay.commercialState,
        });
      }

      if (classification.kind === "already_paid") {
        return buildErrorResult(409, "PREMIUM_EXTRA_ALREADY_PAID", "Premium extra for this day is already paid");
      }

      if (classification.kind === "invalid") {
        logger.warn("Premium extra payment initiation: invalid stored payment reference", {
          subscriptionId,
          date,
          paymentId: String(derivedDay.premiumExtraPayment.paymentId),
          reason: classification.reason,
        });
        return buildErrorResult(409, "PREMIUM_EXTRA_PAYMENT_REUSE_INVALID", "Stored premium extra payment reference is invalid");
      }
    }

    const idempotency = await resolveNonCheckoutIdempotency({
      headers,
      body,
      userId,
      operationScope: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
      effectivePayload,
      fallbackResponseShape: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
      runtime,
    });
    if (!idempotency.ok) {
      return idempotency;
    }
    let operationIdempotencyKey = idempotency.idempotencyKey || "";

    if (!idempotency.shouldContinue) {
      const reusedPaymentId = idempotency.data && idempotency.data.payment_id ? idempotency.data.payment_id : null;
      const existingReusablePayment = reusedPaymentId
        ? await Payment.findById(reusedPaymentId).lean()
        : null;
      const reusablePayment = existingReusablePayment
        || await runtime.findReusableInitiatedPaymentByHash({
          userId,
          operationScope: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
          operationRequestHash,
        });

      if (!reusablePayment) {
        return idempotency;
      }

      return buildSuccessResult(200, {
        ...buildPremiumExtraInitiationSuccessPayload({
          payment: reusablePayment,
          amountHalala,
          currency: reusablePayment.currency || derivedDay.premiumExtraPayment.currency || SYSTEM_CURRENCY,
          reused: true,
        }),
        plannerRevisionHash: derivedDay.plannerRevisionHash,
        premiumExtraPayment: derivedDay.premiumExtraPayment,
        premiumSummary: derivedDay.premiumSummary,
        paymentRequirement: derivedDay.paymentRequirement,
        commercialState: derivedDay.commercialState,
      });
    }

    const appUrl = process.env.APP_URL || "https://example.com";
    const redirectContext = buildPaymentRedirectContext({
      appUrl,
      paymentType: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
      subscriptionId: String(sub._id),
      dayId: String(day._id),
      date: String(day.date),
      successUrl: body && body.successUrl,
      backUrl: body && body.backUrl,
    });

    let invoice;
    try {
      invoice = await runtime.createInvoice({
        amount: amountHalala,
        description: buildPaymentDescription("premiumExtraSettlement", lang, {
          count: extraPremiumCount,
        }),
        callbackUrl: `${appUrl}/api/webhooks/moyasar`,
        successUrl: redirectContext.providerSuccessUrl,
        backUrl: redirectContext.providerCancelUrl,
        metadata: {
          type: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
          subscriptionId: String(sub._id),
          userId: String(userId),
          dayId: String(day._id),
          date: String(day.date),
          extraPremiumCount,
          revisionHash: currentRevisionHash,
          currency: SYSTEM_CURRENCY,
          redirectToken: redirectContext.token,
        },
      });
    } catch (err) {
      logger.error("Premium extra payment initiation: createInvoice failed", { error: err.message, subscriptionId, date });
      return buildErrorResult(err.status || 502, "PAYMENT_PROVIDER_ERROR", "Failed to create payment provider invoice");
    }

    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

    let payment;
    try {
      payment = await runtime.createPayment({
        provider: "moyasar",
        type: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
        status: "initiated",
        amount: amountHalala,
        currency: invoiceCurrency,
        userId,
        subscriptionId: sub._id,
        providerInvoiceId: invoice.id,
        metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
          paymentUrl: invoice.url,
          responseShape: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
          totalHalala: amountHalala,
          redirectContext,
        }),
        ...(operationIdempotencyKey
          ? {
            operationScope: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
            operationIdempotencyKey,
            operationRequestHash,
          }
          : {}),
      });
    } catch (err) {
      logger.error("Premium extra payment initiation: createPayment failed", {
        error: err.message,
        code: err.code,
        type: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
        operationScope: operationIdempotencyKey ? PREMIUM_EXTRA_DAY_PAYMENT_TYPE : undefined,
        subscriptionId,
        date,
      });
      return buildErrorResult(500, "PAYMENT_PERSISTENCE_ERROR", "Failed to record payment initiation");
    }

    const persistedPaymentId = payment && payment._id ? payment._id : payment && payment.id ? payment.id : null;
    if (!persistedPaymentId) {
      logger.error("Premium extra payment initiation: createPayment returned no identifier", {
        subscriptionId,
        date,
      });
      return buildErrorResult(500, "PAYMENT_PERSISTENCE_ERROR", "Failed to record payment initiation");
    }

    try {
      const persistedPremiumExtraPayment = day && day.premiumExtraPayment && typeof day.premiumExtraPayment === "object"
        ? day.premiumExtraPayment
        : {};
      const currentPaymentId = persistedPremiumExtraPayment.paymentId || null;
      const persistedPlannerRevisionHash = day && day.plannerRevisionHash !== undefined
        ? day.plannerRevisionHash
        : null;
      const persistedPaymentRevisionHash = persistedPremiumExtraPayment.revisionHash !== undefined
        ? persistedPremiumExtraPayment.revisionHash
        : null;
      const updateResult = await SubscriptionDay.updateOne(
        {
          _id: day._id,
          status: "open",
          plannerRevisionHash: persistedPlannerRevisionHash,
          "premiumExtraPayment.revisionHash": persistedPaymentRevisionHash,
          "premiumExtraPayment.paymentId": currentPaymentId,
        },
        {
          $set: {
            "premiumExtraPayment.status": "pending",
            plannerRevisionHash: currentRevisionHash,
            "premiumExtraPayment.revisionHash": currentRevisionHash,
            "premiumExtraPayment.paymentId": persistedPaymentId,
            "premiumExtraPayment.providerInvoiceId": invoice.id,
            "premiumExtraPayment.createdAt": derivedDay.premiumExtraPayment.createdAt || new Date(),
            "premiumExtraPayment.amountHalala": amountHalala,
            "premiumExtraPayment.extraPremiumCount": extraPremiumCount,
            "premiumExtraPayment.currency": invoiceCurrency,
            "premiumExtraPayment.reused": false,
          },
        }
      );

      const matchedCount = getUpdateMatchedCount(updateResult);
      const modifiedCount = getUpdateModifiedCount(updateResult);

      if (matchedCount === 0) {
        await markPremiumExtraInitiationFailed(payment, "premium_extra_day_not_open");
        return buildErrorResult(500, "PAYMENT_PERSISTENCE_ERROR", "Failed to link payment to meal planner day");
      }

      if (modifiedCount === 0) {
        const latestDay = await SubscriptionDay.findById(day._id).lean();
        if (!isPremiumExtraDayLinkedToPayment(latestDay, payment, currentRevisionHash)) {
          await markPremiumExtraInitiationFailed(payment, "premium_extra_day_update_failed");
          return buildErrorResult(500, "PAYMENT_PERSISTENCE_ERROR", "Failed to link payment to meal planner day");
        }
      }
    } catch (err) {
      logger.error("Premium extra payment initiation: day save failed", { error: err.message, subscriptionId, date });
      await markPremiumExtraInitiationFailed(payment, "premium_extra_day_update_failed");
      return buildErrorResult(500, "PAYMENT_PERSISTENCE_ERROR", "Failed to link payment to meal planner day");
    }

    const responseDay = applyCommercialStateToDay({
      ...(typeof day.toObject === "function" ? day.toObject() : day),
      plannerRevisionHash: currentRevisionHash,
      premiumExtraPayment: {
        ...derivedDay.premiumExtraPayment,
        status: "pending",
        paymentId: persistedPaymentId,
        providerInvoiceId: invoice.id,
        createdAt: derivedDay.premiumExtraPayment.createdAt || new Date(),
        amountHalala,
        extraPremiumCount,
        currency: invoiceCurrency,
        reused: false,
        revisionHash: currentRevisionHash,
      },
    });
    return buildSuccessResult(201, {
      ...buildPremiumExtraInitiationSuccessPayload({
        payment,
        amountHalala,
        currency: invoiceCurrency,
        paymentUrl: invoice.url,
        providerInvoiceId: invoice.id,
        reused: false,
      }),
      plannerRevisionHash: responseDay.plannerRevisionHash,
      premiumExtraPayment: responseDay.premiumExtraPayment,
      premiumSummary: responseDay.premiumSummary,
      paymentRequirement: responseDay.paymentRequirement,
      commercialState: responseDay.commercialState,
    });
  } catch (err) {
    logger.error("Premium extra payment initiation: unexpected error", {
      error: err.message,
      stack: err.stack,
      subscriptionId,
      date,
    });
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message);
    }
    return buildErrorResult(500, "INTERNAL", "An unexpected error occurred during payment initiation");
  }
}

async function verifyPremiumExtraDayPaymentFlow({
  subscriptionId,
  date,
  paymentId,
  userId,
  getInvoiceFn,
  writeLogFn,
}) {
  const sub = await Subscription.findById(subscriptionId).lean();
  if (!sub) {
    return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(userId)) {
    return buildErrorResult(403, "FORBIDDEN", "Forbidden");
  }

  const payment = await Payment.findOne({
    _id: paymentId,
    subscriptionId,
    userId,
    type: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
  }).lean();
  if (!payment) {
    return buildErrorResult(404, "NOT_FOUND", "Premium extra payment not found");
  }
  const paymentMetadata = getPaymentMetadata(payment);
  if (String(paymentMetadata.date || "") !== String(date)) {
    return buildErrorResult(409, "MISMATCH", "Payment day mismatch");
  }
  if (!payment.providerInvoiceId) {
    return buildErrorResult(409, "CHECKOUT_IN_PROGRESS", "Premium extra invoice is not initialized yet");
  }

  const day = paymentMetadata.dayId && mongoose.Types.ObjectId.isValid(String(paymentMetadata.dayId))
    ? await SubscriptionDay.findById(paymentMetadata.dayId).lean()
    : await SubscriptionDay.findOne({ subscriptionId, date }).lean();
  if (!day) {
    return buildErrorResult(404, "NOT_FOUND", "Day not found");
  }

  if (payment.status === "paid" && payment.applied === true) {
    const session = await mongoose.startSession();
    let synchronized = false;
    try {
      session.startTransaction();

      const paymentInSession = await Payment.findOne({
        _id: paymentId,
        subscriptionId,
        userId,
        type: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
      }).session(session);
      if (!paymentInSession) {
        await session.abortTransaction();
        session.endSession();
        return buildErrorResult(404, "NOT_FOUND", "Premium extra payment not found");
      }

      const metadataInSession = getPaymentMetadata(paymentInSession);
      const dayInSession = metadataInSession.dayId && mongoose.Types.ObjectId.isValid(String(metadataInSession.dayId))
        ? await SubscriptionDay.findById(metadataInSession.dayId).session(session)
        : await SubscriptionDay.findOne({ subscriptionId, date }).session(session);
      if (!dayInSession) {
        await session.abortTransaction();
        session.endSession();
        return buildErrorResult(404, "NOT_FOUND", "Day not found");
      }

      const settlement = await settlePaidPremiumExtraDayPayment({
        subscription: sub,
        day: dayInSession,
        payment: paymentInSession,
        session,
        userId,
        logDate: date,
        writeLogFn,
      });
      if (settlement.applied) {
        paymentInSession.applied = true;
        paymentInSession.status = "paid";
      } else {
        paymentInSession.applied = false;
        paymentInSession.status = "paid";
        paymentInSession.metadata = Object.assign({}, paymentInSession.metadata || {}, {
          unappliedReason: settlement.reason || "premium_extra_settlement_unapplied",
        });
        paymentInSession.markModified("metadata");
      }
      if (!settlement.applied && settlement.reason === "revision_mismatch") {
        await paymentInSession.save({ session });
        await session.commitTransaction();
        session.endSession();
        return buildErrorResult(409, "PREMIUM_EXTRA_REVISION_MISMATCH", "Planner changed since payment creation");
      }

      await paymentInSession.save({ session });
      synchronized = Boolean(settlement.applied);
      await session.commitTransaction();
      session.endSession();

      const latestDay = await SubscriptionDay.findById(dayInSession._id).lean();
      const latestPayment = await Payment.findById(paymentInSession._id).lean();
      return buildSuccessResult(200, {
        ...buildPremiumExtraDayPaymentStatusPayload({ subscription: sub, day: latestDay, payment: latestPayment }),
        checkedProvider: false,
        synchronized,
      });
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
      logger.error("Premium extra verification failed during paid resynchronization", {
        subscriptionId,
        paymentId,
        date,
        error: err.message,
        stack: err.stack,
      });
      return buildErrorResult(500, "SERVER_ERROR", "Failed to verify premium extra payment");
    }
  }

  let providerInvoice;
  try {
    providerInvoice = await getInvoiceFn(payment.providerInvoiceId);
  } catch (err) {
    if (err.code === "CONFIG") return buildErrorResult(500, "CONFIG", err.message);
    if (err.code === "NOT_FOUND") return buildErrorResult(502, "PAYMENT_PROVIDER_ERROR", "Invoice not found at payment provider");
    return buildErrorResult(502, "PAYMENT_PROVIDER_ERROR", "Failed to fetch payment status from provider");
  }

  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const normalizedStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );
  if (!normalizedStatus) {
    return buildErrorResult(409, "PAYMENT_PROVIDER_ERROR", "Unsupported provider payment status");
  }

  const session = await mongoose.startSession();
  let synchronized = false;
  try {
    session.startTransaction();

    const paymentInSession = await Payment.findOne({
      _id: paymentId,
      subscriptionId,
      userId,
      type: PREMIUM_EXTRA_DAY_PAYMENT_TYPE,
    }).session(session);
    if (!paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(404, "NOT_FOUND", "Premium extra payment not found");
    }
    paymentInSession.status = normalizedStatus;
    if (normalizedStatus === "paid" && !paymentInSession.paidAt) {
      paymentInSession.paidAt = new Date();
    }
    await paymentInSession.save({ session });

    const metadataInSession = getPaymentMetadata(paymentInSession);
    const dayInSession = metadataInSession.dayId && mongoose.Types.ObjectId.isValid(String(metadataInSession.dayId))
      ? await SubscriptionDay.findById(metadataInSession.dayId).session(session)
      : await SubscriptionDay.findOne({ subscriptionId, date }).session(session);
    if (!dayInSession) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(404, "NOT_FOUND", "Day not found");
    }
    if (!dayInSession.premiumExtraPayment || !["pending", "paid"].includes(dayInSession.premiumExtraPayment.status)) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(409, "NO_PENDING_PREMIUM_EXTRA", "No pending premium extra payment found");
    }

    if (normalizedStatus === "paid") {
      const settlement = await settlePaidPremiumExtraDayPayment({
        subscription: sub,
        day: dayInSession,
        payment: paymentInSession,
        session,
        userId,
        logDate: date,
        writeLogFn,
      });
      if (!settlement.applied) {
        paymentInSession.applied = false;
        paymentInSession.status = "paid";
        paymentInSession.metadata = Object.assign({}, paymentInSession.metadata || {}, {
          unappliedReason: settlement.reason || "premium_extra_settlement_unapplied",
        });
        paymentInSession.markModified("metadata");
        await paymentInSession.save({ session });
      }
      if (!settlement.applied && settlement.reason === "revision_mismatch") {
        await session.commitTransaction();
        session.endSession();
        return buildErrorResult(409, "PREMIUM_EXTRA_REVISION_MISMATCH", "Planner changed since payment creation");
      }

      if (settlement.applied) {
        const claimed = await Payment.findOneAndUpdate(
          { _id: paymentInSession._id, applied: false },
          { $set: { applied: true, status: "paid" } },
          { new: true, session }
        );
        synchronized = Boolean(claimed || settlement.applied);
      }
    }

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("Premium extra verification failed", {
      subscriptionId,
      paymentId,
      date,
      error: err.message,
      stack: err.stack,
    });
    return buildErrorResult(500, "INTERNAL", "Premium extra verification failed");
  }

  const latestPayment = await Payment.findById(paymentId).lean();
  const latestMetadata = getPaymentMetadata(latestPayment);
  const latestDay = latestMetadata.dayId && mongoose.Types.ObjectId.isValid(String(latestMetadata.dayId))
    ? await SubscriptionDay.findById(latestMetadata.dayId).lean()
    : await SubscriptionDay.findOne({ subscriptionId, date }).lean();
  return buildSuccessResult(200, {
    ...buildPremiumExtraDayPaymentStatusPayload({
      subscription: sub,
      day: latestDay,
      payment: latestPayment,
      providerInvoice,
    }),
    checkedProvider: true,
    synchronized,
  });
}

module.exports = {
  createPremiumExtraDayPaymentFlow,
  verifyPremiumExtraDayPaymentFlow,
  settlePaidPremiumExtraDayPayment,
};
