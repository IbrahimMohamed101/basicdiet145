"use strict";

const crypto = require("node:crypto");
const {
  validateSubscriptionStackingStagingEnv,
} = require("./validate-subscription-stacking-staging-env");

const WRITE_PHASES = new Set(["initiate", "verify"]);

function readinessError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function maskCommit(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 8)}…${text.slice(-4)}`;
}

async function assertRemoteDeploymentReadiness(env = process.env, runtime = {}) {
  const safety = validateSubscriptionStackingStagingEnv(env);
  const token = String(env.STAGING_CLIENT_TOKEN || "").trim();
  const expectedCommit = String(env.STAGING_EXPECTED_DEPLOYMENT_COMMIT_SHA || "").trim();
  const phase = String(env.STAGING_CERTIFICATION_PHASE || "read").trim().toLowerCase();

  if (!token) {
    throw readinessError("DEPLOYMENT_READINESS_TOKEN_REQUIRED", "STAGING_CLIENT_TOKEN is required");
  }
  if (!expectedCommit) {
    throw readinessError(
      "DEPLOYMENT_READINESS_EXPECTED_COMMIT_REQUIRED",
      "STAGING_EXPECTED_DEPLOYMENT_COMMIT_SHA is required"
    );
  }
  if (!["read", "initiate", "verify"].includes(phase)) {
    throw readinessError("DEPLOYMENT_READINESS_PHASE_INVALID", "Certification phase is invalid");
  }

  const fetchImpl = runtime.fetchImpl || global.fetch;
  if (typeof fetchImpl !== "function") {
    throw readinessError("DEPLOYMENT_READINESS_FETCH_UNAVAILABLE", "fetch is unavailable");
  }

  const timeoutRaw = Number(env.STAGING_REQUEST_TIMEOUT_MS || 20000);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestId = crypto.randomUUID();

  try {
    const response = await fetchImpl(
      new URL("/api/subscriptions/stacking/readiness", `${safety.baseUrl}/`).toString(),
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
      throw readinessError(
        "DEPLOYMENT_READINESS_RESPONSE_INVALID",
        "Remote readiness response is not valid JSON",
        { status: response.status }
      );
    }

    if (!response.ok) {
      const remoteError = payload && payload.error && typeof payload.error === "object"
        ? payload.error
        : {};
      throw readinessError("DEPLOYMENT_READINESS_REMOTE_ERROR", "Remote readiness request failed", {
        status: response.status,
        remoteCode: remoteError.code || null,
        requestId: response.headers.get("x-request-id") || requestId,
      });
    }

    const data = payload && payload.data && typeof payload.data === "object"
      ? payload.data
      : payload;
    if (!data || data.contractVersion !== "subscription_stacking_remote_readiness.v1") {
      throw readinessError(
        "DEPLOYMENT_READINESS_CONTRACT_MISMATCH",
        "Unexpected remote readiness contract"
      );
    }
    if (data.environment && data.environment.production === true) {
      throw readinessError(
        "DEPLOYMENT_READINESS_PRODUCTION_BLOCKED",
        "Remote readiness target reports a production environment"
      );
    }

    const actualCommit = String(data.deployment && data.deployment.commitSha || "").trim();
    if (!actualCommit) {
      throw readinessError(
        "DEPLOYMENT_READINESS_COMMIT_NOT_EXPOSED",
        "Deployed service did not expose its commit SHA"
      );
    }
    if (actualCommit !== expectedCommit) {
      throw readinessError("DEPLOYMENT_READINESS_COMMIT_MISMATCH", "Deployed commit does not match certification ref", {
        expected: maskCommit(expectedCommit),
        actual: maskCommit(actualCommit),
      });
    }

    const attestation = data.deployment && data.deployment.safetyAttestation || {};
    if (attestation.databaseIsolationConfirmed !== true || attestation.readSafe !== true) {
      throw readinessError(
        "DEPLOYMENT_READINESS_DATABASE_NOT_ISOLATED",
        "Deployed service did not attest to an isolated staging database"
      );
    }

    const certification = data.certification || {};
    if (phase === "read" && certification.readProbeReady !== true) {
      throw readinessError("DEPLOYMENT_READINESS_READ_NOT_READY", "Remote read probe is not ready", {
        blockedReasons: certification.blockedReasons || [],
      });
    }

    if (WRITE_PHASES.has(phase)) {
      if (
        attestation.paymentSandboxConfirmed !== true
        || attestation.safePaymentMode !== true
        || attestation.writeSafe !== true
      ) {
        throw readinessError(
          "DEPLOYMENT_READINESS_PAYMENT_NOT_SANDBOXED",
          "Deployed service did not attest to sandbox/mock payment mode"
        );
      }
      if (certification.baseMealCanaryReady !== true) {
        throw readinessError("DEPLOYMENT_READINESS_WRITE_NOT_READY", "Remote write canary is not ready", {
          blockedReasons: certification.blockedReasons || [],
        });
      }
    }

    return {
      ok: true,
      phase,
      origin: safety.baseUrl,
      deploymentCommit: maskCommit(actualCommit),
      databaseIsolationConfirmed: true,
      paymentSandboxConfirmed: WRITE_PHASES.has(phase)
        ? attestation.paymentSandboxConfirmed === true
        : null,
      requestId: response.headers.get("x-request-id") || requestId,
    };
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw readinessError("DEPLOYMENT_READINESS_TIMEOUT", "Remote readiness request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function runCli() {
  try {
    const result = await assertRemoteDeploymentReadiness(process.env);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: err && err.code || "DEPLOYMENT_READINESS_FAILED",
      message: err && err.message || "Deployment readiness assertion failed",
      details: err && err.details || {},
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  assertRemoteDeploymentReadiness,
  maskCommit,
};
