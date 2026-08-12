"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  validateSubscriptionStackingStagingEnv,
} = require("./validate-subscription-stacking-staging-env");

const PHASES = new Set(["read", "initiate", "verify", "extras"]);

function certificationError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function parseJson(value, name, required = false) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (required) throw certificationError("CERTIFICATION_INPUT_REQUIRED", `${name} is required`, { field: name });
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (_err) {
    throw certificationError("CERTIFICATION_JSON_INVALID", `${name} must be valid JSON`, { field: name });
  }
}

function parseOptionalInteger(value, name) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw certificationError("CERTIFICATION_INTEGER_INVALID", `${name} must be a non-negative integer`, { field: name });
  }
  return parsed;
}

function maskIdentifier(value) {
  const text = String(value || "");
  if (!text) return null;
  return text.length <= 8 ? "***" : `***${text.slice(-6)}`;
}

function unwrapData(payload) {
  if (payload && payload.data && typeof payload.data === "object") return payload.data;
  return payload && typeof payload === "object" ? payload : {};
}

function extractSubscriptionId(payload) {
  const data = unwrapData(payload);
  return data.subscriptionId
    || (data.subscription && (data.subscription._id || data.subscription.id))
    || data._id
    || data.id
    || null;
}

function extractRemainingMeals(payload) {
  const data = unwrapData(payload);
  const candidates = [
    data.mealBalance && data.mealBalance.remainingMeals,
    data.subscription && data.subscription.mealBalance && data.subscription.mealBalance.remainingMeals,
    data.remainingMeals,
    data.subscription && data.subscription.remainingMeals,
  ];
  const value = candidates.find((item) => Number.isFinite(Number(item)));
  return value === undefined ? null : Number(value);
}

function extractDraftId(payload) {
  const data = unwrapData(payload);
  return data.checkoutDraftId
    || data.draftId
    || (data.checkoutDraft && (data.checkoutDraft._id || data.checkoutDraft.id))
    || (data.draft && (data.draft._id || data.draft.id))
    || null;
}

function extractPaymentUrl(payload) {
  const data = unwrapData(payload);
  return data.payment_url
    || data.paymentUrl
    || (data.payment && (data.payment.payment_url || data.payment.paymentUrl || data.payment.url))
    || null;
}

function extractCheckoutStatus(payload) {
  const data = unwrapData(payload);
  const value = data.draftStatus || data.checkoutStatus || data.status || "";
  return String(value || "").trim().toLowerCase();
}

function findTimelineDay(payload, date) {
  const data = unwrapData(payload);
  const days = Array.isArray(data.days) ? data.days : [];
  if (!date) return null;
  return days.find((day) => String(day && day.date || "") === String(date)) || null;
}

function extractRequiredMeals(day) {
  if (!day || typeof day !== "object") return null;
  const candidates = [day.requiredMeals, day.requiredMealCount, day.dailyMealsRequired];
  const value = candidates.find((item) => Number.isFinite(Number(item)));
  return value === undefined ? null : Number(value);
}

function assertBaseMealOnly(payload) {
  const premiumItems = Array.isArray(payload && payload.premiumItems) ? payload.premiumItems : [];
  const addons = Array.isArray(payload && payload.addons) ? payload.addons : [];
  const addonSubscriptions = Array.isArray(payload && payload.addonSubscriptions)
    ? payload.addonSubscriptions
    : [];
  if (premiumItems.length || addons.length || addonSubscriptions.length) {
    throw certificationError(
      "CERTIFICATION_BASE_MEAL_ONLY_REQUIRED",
      "Remote certification supports base meals only until premium/add-on stacking is complete"
    );
  }
}

function hasExtraCheckoutPayload(payload) {
  return Boolean(
    (Array.isArray(payload && payload.premiumItems) && payload.premiumItems.length)
    || (Array.isArray(payload && payload.addons) && payload.addons.length)
    || (
      Array.isArray(payload && payload.addonSubscriptions)
      && payload.addonSubscriptions.length
    )
  );
}

function assertExtraCertificationReady(readiness) {
  if (
    !readiness
    || !readiness.certification
    || readiness.certification.extraEntitlementCanaryReady !== true
    || !readiness.runtime
    || readiness.runtime.premiumStackingSupported !== true
    || readiness.runtime.addonStackingSupported !== true
  ) {
    throw certificationError(
      "CERTIFICATION_EXTRA_CANARY_NOT_READY",
      "Authenticated staging user is not ready for Premium/Add-on runtime certification",
      {
        blockedReasons: readiness
          && readiness.certification
          && readiness.certification.extraEntitlementBlockedReasons
          || [],
      }
    );
  }
}

function buildUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

async function requestJson({ fetchImpl, baseUrl, token, method = "GET", pathname, body, headers = {}, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestId = crypto.randomUUID();
  try {
    const response = await fetchImpl(buildUrl(baseUrl, pathname), {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Accept-Language": "ar",
        "X-Request-Id": requestId,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_err) {
      throw certificationError("CERTIFICATION_RESPONSE_INVALID", "Remote response is not valid JSON", {
        pathname,
        status: response.status,
      });
    }
    if (!response.ok) {
      const errorBlock = payload && payload.error && typeof payload.error === "object" ? payload.error : {};
      throw certificationError("CERTIFICATION_REMOTE_HTTP_ERROR", "Remote certification request failed", {
        pathname,
        status: response.status,
        remoteCode: errorBlock.code || null,
        remoteMessage: errorBlock.message || payload.message || null,
        requestId: response.headers.get("x-request-id") || requestId,
      });
    }
    return {
      status: response.status,
      requestId: response.headers.get("x-request-id") || requestId,
      payload,
    };
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw certificationError("CERTIFICATION_REMOTE_TIMEOUT", "Remote certification request timed out", { pathname, timeoutMs });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function assertReadiness(readinessPayload, phase) {
  const readiness = unwrapData(readinessPayload);
  if (readiness.contractVersion !== "subscription_stacking_remote_readiness.v1") {
    throw certificationError("CERTIFICATION_READINESS_CONTRACT_MISMATCH", "Unexpected readiness contract version");
  }
  if (readiness.environment && readiness.environment.production === true) {
    throw certificationError("CERTIFICATION_PRODUCTION_TARGET_BLOCKED", "Remote certification cannot target production");
  }
  const certification = readiness.certification || {};
  if (phase === "read" && certification.readProbeReady !== true) {
    throw certificationError("CERTIFICATION_READ_PROBE_NOT_READY", "Staging read probe is not enabled", {
      blockedReasons: certification.blockedReasons || [],
    });
  }
  if (phase !== "read" && certification.baseMealCanaryReady !== true) {
    throw certificationError("CERTIFICATION_WRITE_CANARY_NOT_READY", "Staging base-meal write canary is not ready", {
      blockedReasons: certification.blockedReasons || [],
    });
  }
  if (phase === "extras") assertExtraCertificationReady(readiness);
  return readiness;
}

function extractPickupRequestId(payload) {
  const data = unwrapData(payload);
  return data.requestId
    || data.pickupRequestId
    || data.id
    || data._id
    || (data.pickupRequest && (data.pickupRequest.id || data.pickupRequest._id))
    || null;
}

async function exerciseExtraRuntime(context, {
  subscriptionId,
  config,
  dashboardToken,
} = {}) {
  if (!subscriptionId) {
    throw certificationError(
      "CERTIFICATION_SUBSCRIPTION_ID_REQUIRED",
      "An operational subscription id is required for extra runtime certification"
    );
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw certificationError(
      "CERTIFICATION_EXTRA_EXERCISE_CONFIG_REQUIRED",
      "STAGING_EXTRA_E2E_PAYLOAD_JSON is required for extras phase"
    );
  }
  const date = String(config.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw certificationError(
      "CERTIFICATION_EXTRA_DATE_INVALID",
      "Extra runtime certification date must use YYYY-MM-DD"
    );
  }
  if (!config.selectionBody || typeof config.selectionBody !== "object") {
    throw certificationError(
      "CERTIFICATION_EXTRA_SELECTION_REQUIRED",
      "Extra runtime certification requires a canonical selectionBody"
    );
  }
  if (!config.pickupBody || typeof config.pickupBody !== "object") {
    throw certificationError(
      "CERTIFICATION_EXTRA_PICKUP_REQUIRED",
      "Extra runtime certification requires a pickupBody"
    );
  }
  if (!dashboardToken) {
    throw certificationError(
      "CERTIFICATION_DASHBOARD_TOKEN_REQUIRED",
      "STAGING_DASHBOARD_TOKEN is required for real fulfillment"
    );
  }

  const selectionPath = `/api/subscriptions/${encodeURIComponent(subscriptionId)}/days/${encodeURIComponent(date)}/selection`;
  const selection = await requestJson({
    ...context,
    method: "PUT",
    pathname: selectionPath,
    body: config.selectionBody,
  });
  const selectionReplay = await requestJson({
    ...context,
    method: "PUT",
    pathname: selectionPath,
    body: config.selectionBody,
  });
  const confirmation = await requestJson({
    ...context,
    method: "POST",
    pathname: `/api/subscriptions/${encodeURIComponent(subscriptionId)}/days/${encodeURIComponent(date)}/confirm`,
    body: {},
  });
  const availability = await requestJson({
    ...context,
    pathname: `/api/subscriptions/${encodeURIComponent(subscriptionId)}/pickup-availability?date=${encodeURIComponent(date)}`,
  });
  const pickupBody = {
    ...config.pickupBody,
    date,
    idempotencyKey: String(
      config.pickupBody.idempotencyKey
      || `stacking-extra-cert-${crypto.randomUUID()}`
    ),
  };
  const pickup = await requestJson({
    ...context,
    method: "POST",
    pathname: `/api/subscriptions/${encodeURIComponent(subscriptionId)}/pickup-requests`,
    body: pickupBody,
  });
  const pickupReplay = await requestJson({
    ...context,
    method: "POST",
    pathname: `/api/subscriptions/${encodeURIComponent(subscriptionId)}/pickup-requests`,
    body: pickupBody,
  });
  const fulfillmentContext = { ...context, token: dashboardToken };
  const fulfillmentPath = `/api/kitchen/subscriptions/${encodeURIComponent(subscriptionId)}/days/${encodeURIComponent(date)}/fulfill-pickup`;
  const fulfillment = await requestJson({
    ...fulfillmentContext,
    method: "POST",
    pathname: fulfillmentPath,
    body: config.fulfillmentBody || {},
  });
  const fulfillmentReplay = await requestJson({
    ...fulfillmentContext,
    method: "POST",
    pathname: fulfillmentPath,
    body: config.fulfillmentBody || {},
  });

  return {
    date,
    selectionRequestId: selection.requestId,
    selectionReplayRequestId: selectionReplay.requestId,
    confirmationRequestId: confirmation.requestId,
    availabilityRequestId: availability.requestId,
    pickupRequestId: maskIdentifier(extractPickupRequestId(pickup.payload)),
    pickupCreateRequestId: pickup.requestId,
    pickupReplayRequestId: pickupReplay.requestId,
    fulfillmentRequestId: fulfillment.requestId,
    fulfillmentReplayRequestId: fulfillmentReplay.requestId,
  };
}

async function readClientState(context) {
  const overviewResponse = await requestJson({
    ...context,
    pathname: "/api/subscriptions/current/overview",
  });
  const subscriptionId = context.subscriptionId || extractSubscriptionId(overviewResponse.payload);
  let timelineResponse = null;
  if (subscriptionId) {
    timelineResponse = await requestJson({
      ...context,
      pathname: `/api/subscriptions/${encodeURIComponent(subscriptionId)}/timeline`,
    });
  }
  return {
    subscriptionId,
    remainingMeals: extractRemainingMeals(overviewResponse.payload),
    overviewRequestId: overviewResponse.requestId,
    timelineRequestId: timelineResponse && timelineResponse.requestId,
    timelinePayload: timelineResponse && timelineResponse.payload,
  };
}

async function runRemoteCertification(env = process.env, runtime = {}) {
  const safety = validateSubscriptionStackingStagingEnv(env);
  const phase = String(env.STAGING_CERTIFICATION_PHASE || "read").trim().toLowerCase();
  if (!PHASES.has(phase)) {
    throw certificationError("CERTIFICATION_PHASE_INVALID", "STAGING_CERTIFICATION_PHASE must be read, initiate, verify, or extras");
  }
  const token = String(env.STAGING_CLIENT_TOKEN || "").trim();
  if (!token) throw certificationError("CERTIFICATION_TOKEN_REQUIRED", "STAGING_CLIENT_TOKEN is required");

  const fetchImpl = runtime.fetchImpl || global.fetch;
  if (typeof fetchImpl !== "function") throw certificationError("CERTIFICATION_FETCH_UNAVAILABLE", "fetch is unavailable");
  const timeoutMs = parseOptionalInteger(env.STAGING_REQUEST_TIMEOUT_MS || 20000, "STAGING_REQUEST_TIMEOUT_MS") || 20000;
  const context = {
    fetchImpl,
    baseUrl: safety.baseUrl,
    token,
    timeoutMs,
    subscriptionId: String(env.STAGING_SUBSCRIPTION_ID || "").trim() || null,
  };

  const health = await requestJson({ ...context, token: "", pathname: "/health", headers: { Authorization: "" } });
  const readinessResponse = await requestJson({
    ...context,
    pathname: "/api/subscriptions/stacking/readiness",
  });
  const readiness = assertReadiness(readinessResponse.payload, phase);
  const before = await readClientState(context);

  const evidence = {
    contractVersion: "subscription_stacking_remote_certification.v1",
    phase,
    generatedAt: new Date().toISOString(),
    target: {
      origin: safety.baseUrl,
      databaseFingerprint: safety.database && safety.database.fingerprint,
      paymentMode: safety.paymentMode,
      deploymentCommitSha: readiness.deployment && readiness.deployment.commitSha || null,
    },
    probes: {
      healthStatus: health.status,
      healthRequestId: health.requestId,
      readinessRequestId: readinessResponse.requestId,
    },
    before: {
      subscriptionId: maskIdentifier(before.subscriptionId),
      remainingMeals: before.remainingMeals,
      overviewRequestId: before.overviewRequestId,
      timelineRequestId: before.timelineRequestId,
    },
    mutation: null,
    after: null,
    passed: false,
  };

  if (phase === "read") {
    evidence.passed = true;
    return evidence;
  }

  if (phase === "initiate") {
    const checkoutPayload = parseJson(env.STAGING_CHECKOUT_PAYLOAD_JSON, "STAGING_CHECKOUT_PAYLOAD_JSON", true);
    const extraCheckout = hasExtraCheckoutPayload(checkoutPayload);
    if (extraCheckout) assertExtraCertificationReady(readiness);
    const idempotencyKey = String(env.STAGING_CHECKOUT_IDEMPOTENCY_KEY || `stacking-cert-${crypto.randomUUID()}`).trim();

    const quote = await requestJson({
      ...context,
      method: "POST",
      pathname: "/api/subscriptions/quote",
      body: checkoutPayload,
    });
    const first = await requestJson({
      ...context,
      method: "POST",
      pathname: "/api/subscriptions/checkout",
      body: checkoutPayload,
      headers: { "Idempotency-Key": idempotencyKey },
    });
    const second = await requestJson({
      ...context,
      method: "POST",
      pathname: "/api/subscriptions/checkout",
      body: checkoutPayload,
      headers: { "Idempotency-Key": idempotencyKey },
    });
    const firstDraftId = extractDraftId(first.payload);
    const secondDraftId = extractDraftId(second.payload);
    if (!firstDraftId || firstDraftId !== secondDraftId) {
      throw certificationError("CERTIFICATION_CHECKOUT_NOT_IDEMPOTENT", "Repeated checkout did not return the same draft");
    }
    const firstPaymentUrl = extractPaymentUrl(first.payload);
    const secondPaymentUrl = extractPaymentUrl(second.payload);
    if (!firstPaymentUrl || firstPaymentUrl !== secondPaymentUrl) {
      throw certificationError("CERTIFICATION_PAYMENT_URL_NOT_IDEMPOTENT", "Repeated checkout did not return the same payment URL");
    }
    evidence.mutation = {
      quoteRequestId: quote.requestId,
      firstCheckoutRequestId: first.requestId,
      secondCheckoutRequestId: second.requestId,
      checkoutDraftId: firstDraftId,
      maskedCheckoutDraftId: maskIdentifier(firstDraftId),
      paymentUrlOrigin: new URL(firstPaymentUrl).origin,
      idempotencyVerified: true,
      extraEntitlements: extraCheckout,
    };
    evidence.passed = true;
    return evidence;
  }

  const draftId = String(env.STAGING_CHECKOUT_DRAFT_ID || "").trim();
  if (!draftId) throw certificationError("CERTIFICATION_DRAFT_ID_REQUIRED", "STAGING_CHECKOUT_DRAFT_ID is required for verify phase");
  const firstVerify = await requestJson({
    ...context,
    method: "POST",
    pathname: `/api/subscriptions/checkout-drafts/${encodeURIComponent(draftId)}/verify-payment`,
    body: {},
  });
  const secondVerify = await requestJson({
    ...context,
    method: "POST",
    pathname: `/api/subscriptions/checkout-drafts/${encodeURIComponent(draftId)}/verify-payment`,
    body: {},
  });
  const firstStatus = extractCheckoutStatus(firstVerify.payload);
  const secondStatus = extractCheckoutStatus(secondVerify.payload);
  if (firstStatus !== "completed" || secondStatus !== "completed") {
    throw certificationError("CERTIFICATION_PAYMENT_NOT_COMPLETED", "Sandbox payment is not completed", {
      firstStatus,
      secondStatus,
    });
  }

  const after = await readClientState(context);
  const expectedRemaining = parseOptionalInteger(env.STAGING_EXPECTED_REMAINING_MEALS, "STAGING_EXPECTED_REMAINING_MEALS");
  if (expectedRemaining !== null && after.remainingMeals !== expectedRemaining) {
    throw certificationError("CERTIFICATION_REMAINING_BALANCE_MISMATCH", "Unexpected stacked remaining balance", {
      expected: expectedRemaining,
      actual: after.remainingMeals,
    });
  }
  const targetDate = String(env.STAGING_TARGET_DATE || "").trim();
  const expectedRequiredMeals = parseOptionalInteger(env.STAGING_EXPECTED_REQUIRED_MEALS, "STAGING_EXPECTED_REQUIRED_MEALS");
  let targetDay = null;
  let actualRequiredMeals = null;
  if (expectedRequiredMeals !== null) {
    if (!targetDate) throw certificationError("CERTIFICATION_TARGET_DATE_REQUIRED", "STAGING_TARGET_DATE is required with STAGING_EXPECTED_REQUIRED_MEALS");
    targetDay = findTimelineDay(after.timelinePayload, targetDate);
    actualRequiredMeals = extractRequiredMeals(targetDay);
    if (!targetDay || actualRequiredMeals !== expectedRequiredMeals) {
      throw certificationError("CERTIFICATION_REQUIRED_MEALS_MISMATCH", "Unexpected required meal count for target day", {
        targetDate,
        expected: expectedRequiredMeals,
        actual: actualRequiredMeals,
      });
    }
  }

  evidence.mutation = {
    checkoutDraftId: maskIdentifier(draftId),
    firstVerifyRequestId: firstVerify.requestId,
    secondVerifyRequestId: secondVerify.requestId,
    firstStatus,
    secondStatus,
    verifyIdempotencyVerified: true,
  };
  evidence.after = {
    subscriptionId: maskIdentifier(after.subscriptionId),
    remainingMeals: after.remainingMeals,
    overviewRequestId: after.overviewRequestId,
    timelineRequestId: after.timelineRequestId,
    targetDate: targetDate || null,
    requiredMeals: actualRequiredMeals,
  };
  if (phase === "extras") {
    evidence.extraRuntime = await exerciseExtraRuntime(context, {
      subscriptionId: after.subscriptionId,
      config: parseJson(
        env.STAGING_EXTRA_E2E_PAYLOAD_JSON,
        "STAGING_EXTRA_E2E_PAYLOAD_JSON",
        true
      ),
      dashboardToken: String(env.STAGING_DASHBOARD_TOKEN || "").trim(),
    });
  }
  evidence.passed = true;
  return evidence;
}

function writeEvidence(evidence, env = process.env) {
  const outputPath = path.resolve(
    String(env.STAGING_CERTIFICATION_OUTPUT || "artifacts/subscription-stacking-remote-certification.json")
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return outputPath;
}

async function runCli() {
  try {
    const evidence = await runRemoteCertification(process.env);
    const outputPath = writeEvidence(evidence, process.env);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      phase: evidence.phase,
      passed: evidence.passed,
      outputPath,
      checkoutDraftId: evidence.mutation && evidence.mutation.checkoutDraftId || null,
    }, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: err && err.code || "CERTIFICATION_FAILED",
      message: err && err.message || "Remote certification failed",
      details: err && err.details || {},
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  assertBaseMealOnly,
  assertExtraCertificationReady,
  exerciseExtraRuntime,
  extractCheckoutStatus,
  extractDraftId,
  extractRemainingMeals,
  extractRequiredMeals,
  extractSubscriptionId,
  findTimelineDay,
  hasExtraCheckoutPayload,
  runRemoteCertification,
  writeEvidence,
};
