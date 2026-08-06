"use strict";

const crypto = require("node:crypto");
const {
  validateSubscriptionStackingStagingEnv,
} = require("./validate-subscription-stacking-staging-env");
const {
  extractSubscriptionId,
} = require("./run-subscription-stacking-remote-certification");

function identityError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function maskIdentifier(value) {
  const text = String(value || "");
  return text.length > 6 ? `***${text.slice(-6)}` : "***";
}

async function assertRemoteParentIdentity(env = process.env, runtime = {}) {
  const safety = validateSubscriptionStackingStagingEnv(env);
  const token = String(env.STAGING_CLIENT_TOKEN || "").trim();
  const expectedSubscriptionId = String(env.STAGING_SUBSCRIPTION_ID || "").trim();
  if (!token) throw identityError("PARENT_IDENTITY_TOKEN_REQUIRED", "STAGING_CLIENT_TOKEN is required");
  if (!expectedSubscriptionId) {
    throw identityError("PARENT_IDENTITY_EXPECTED_ID_REQUIRED", "STAGING_SUBSCRIPTION_ID is required");
  }

  const fetchImpl = runtime.fetchImpl || global.fetch;
  if (typeof fetchImpl !== "function") throw identityError("PARENT_IDENTITY_FETCH_UNAVAILABLE", "fetch is unavailable");
  const timeoutMs = Number(env.STAGING_REQUEST_TIMEOUT_MS || 20000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20000);
  const requestId = crypto.randomUUID();

  try {
    const response = await fetchImpl(
      new URL("/api/subscriptions/current/overview", `${safety.baseUrl}/`).toString(),
      {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-Id": requestId,
        },
      }
    );
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_err) {
      throw identityError("PARENT_IDENTITY_RESPONSE_INVALID", "Current overview response is not JSON", {
        status: response.status,
      });
    }
    if (!response.ok) {
      const remoteError = payload && payload.error && typeof payload.error === "object"
        ? payload.error
        : {};
      throw identityError("PARENT_IDENTITY_REMOTE_ERROR", "Current overview request failed", {
        status: response.status,
        remoteCode: remoteError.code || null,
      });
    }

    const actualSubscriptionId = String(extractSubscriptionId(payload) || "").trim();
    if (!actualSubscriptionId) {
      throw identityError("PARENT_IDENTITY_MISSING", "Current overview did not return a subscription id");
    }
    if (actualSubscriptionId !== expectedSubscriptionId) {
      throw identityError("PARENT_IDENTITY_CHANGED", "Current parent subscription id changed", {
        expected: maskIdentifier(expectedSubscriptionId),
        actual: maskIdentifier(actualSubscriptionId),
      });
    }

    return {
      ok: true,
      origin: safety.baseUrl,
      subscriptionId: maskIdentifier(actualSubscriptionId),
      requestId: response.headers.get("x-request-id") || requestId,
    };
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw identityError("PARENT_IDENTITY_TIMEOUT", "Current overview request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function runCli() {
  try {
    const result = await assertRemoteParentIdentity(process.env);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: err && err.code || "PARENT_IDENTITY_ASSERTION_FAILED",
      message: err && err.message || "Parent identity assertion failed",
      details: err && err.details || {},
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  assertRemoteParentIdentity,
};
