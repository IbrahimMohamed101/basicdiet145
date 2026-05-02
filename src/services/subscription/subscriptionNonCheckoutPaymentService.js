const { isPhase1NonCheckoutPaidIdempotencyEnabled } = require("../../utils/featureFlags");
const { getPaymentMetadata } = require("./subscriptionCheckoutHelpers");

function buildErrorResult(status, code, message, details) {
  return {
    ok: false,
    status,
    code,
    message,
    ...(details !== undefined ? { details } : {}),
  };
}

function buildSuccessResult(status, data) {
  return {
    ok: true,
    status,
    data,
  };
}

function isReusableInitiatedPayment(payment) {
  const metadata = getPaymentMetadata(payment);
  return Boolean(
    payment
    && payment.status === "initiated"
    && payment.applied !== true
    && payment.providerInvoiceId
    && typeof metadata.paymentUrl === "string"
    && metadata.paymentUrl.trim()
  );
}

function buildNonCheckoutInitiationPayload(payment, fallbackResponseShape) {
  const metadata = getPaymentMetadata(payment);
  const responseShape = String(metadata.initiationResponseShape || fallbackResponseShape || "").trim();
  const redirectContext = metadata.redirectContext && typeof metadata.redirectContext === "object"
    ? metadata.redirectContext
    : null;
  const payload = {
    payment_url: metadata.paymentUrl || "",
    invoice_id: payment && payment.providerInvoiceId ? payment.providerInvoiceId : null,
    payment_id: payment && payment.id ? payment.id : (payment && payment._id ? String(payment._id) : null),
  };

  if (redirectContext && redirectContext.token && redirectContext.paymentType) {
    const verifyParams = new URLSearchParams({
      payment_type: String(redirectContext.paymentType || ""),
      token: String(redirectContext.token || ""),
    });
    if (redirectContext.draftId) verifyParams.set("draft_id", String(redirectContext.draftId));
    if (redirectContext.subscriptionId) verifyParams.set("subscription_id", String(redirectContext.subscriptionId));
    if (redirectContext.dayId) verifyParams.set("day_id", String(redirectContext.dayId));
    if (redirectContext.date) verifyParams.set("date", String(redirectContext.date));
    payload.verify_url = `/api/payments/verify?${verifyParams.toString()}`;
  }

  if (
    responseShape === "premium_overage_day"
    || responseShape === "premium_extra_day"
    || responseShape === "one_time_addon_day_planning"
  ) {
    payload.totalHalala = Number(
      metadata.totalHalala !== undefined && metadata.totalHalala !== null
        ? metadata.totalHalala
        : payment && payment.amount !== undefined
          ? payment.amount
          : 0
    );
  }

  return payload;
}

async function resolveNonCheckoutIdempotency({
  headers = {},
  body = {},
  userId,
  operationScope,
  effectivePayload,
  fallbackResponseShape,
  runtime,
}) {
  // Early return moved after key computation to preserve them in the result payload.

  let operationIdempotencyKey = "";
  try {
    operationIdempotencyKey = runtime.parseOperationIdempotencyKey({ headers, body });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return buildErrorResult(400, "VALIDATION_ERROR", err.message);
    }
    throw err;
  }

  if (!operationIdempotencyKey) {
    return { ok: true, status: 200, shouldContinue: true, idempotencyKey: "", operationRequestHash: "" };
  }

  const operationRequestHash = runtime.buildOperationRequestHash({
    scope: operationScope,
    userId,
    effectivePayload,
  });

  if (!isPhase1NonCheckoutPaidIdempotencyEnabled()) {
    return {
      ok: true,
      status: 200,
      shouldContinue: true,
      idempotencyKey: operationIdempotencyKey,
      operationRequestHash,
    };
  }

  const existingByKey = await runtime.findPaymentByOperationKey({
    userId,
    operationScope,
    operationIdempotencyKey,
  });

  if (existingByKey) {
    if (!existingByKey.operationRequestHash) {
      return buildErrorResult(409, "IDEMPOTENCY_CONFLICT", "idempotencyKey is already used by an incompatible payment initiation");
    }

    const decision = runtime.compareIdempotentRequest({
      existingRequestHash: existingByKey.operationRequestHash,
      incomingRequestHash: operationRequestHash,
    });

    if (decision === "conflict") {
      return buildErrorResult(409, "IDEMPOTENCY_CONFLICT", "idempotencyKey is already used with a different payment payload");
    }

    if (decision === "reuse" && isReusableInitiatedPayment(existingByKey)) {
      return buildSuccessResult(200, buildNonCheckoutInitiationPayload(existingByKey, fallbackResponseShape));
    }

    return buildErrorResult(409, "IDEMPOTENCY_CONFLICT", "idempotencyKey is already used with a non-reusable payment initiation");
  }

  const existingByHash = await runtime.findReusableInitiatedPaymentByHash({
    userId,
    operationScope,
    operationRequestHash,
  });

  if (existingByHash && isReusableInitiatedPayment(existingByHash)) {
    return buildSuccessResult(200, buildNonCheckoutInitiationPayload(existingByHash, fallbackResponseShape));
  }

  return {
    ok: true,
    status: 200,
    shouldContinue: true,
    idempotencyKey: operationIdempotencyKey,
    operationRequestHash,
  };
}

module.exports = {
  buildErrorResult,
  buildSuccessResult,
  isReusableInitiatedPayment,
  buildNonCheckoutInitiationPayload,
  resolveNonCheckoutIdempotency,
};
