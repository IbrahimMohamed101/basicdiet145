const https = require("https");
const { isPosStagingRuntime } = require("../utils/posStagingRuntime");

const MOYASAR_HOST = "api.moyasar.com";
const DEFAULT_MOYASAR_TIMEOUT_MS = 15000;
const DEFAULT_MOYASAR_GET_RETRY_ATTEMPTS = 3;
const MOYASAR_GET_RETRY_BACKOFF_MS = [150, 300];

/** Names of env vars required for Moyasar to function — never log values. */
const REQUIRED_ENV_VARS = ["MOYASAR_SECRET_KEY"];

function getMoyasarGetRetryAttempts() {
  const parsed = Number(process.env.MOYASAR_GET_RETRY_ATTEMPTS || DEFAULT_MOYASAR_GET_RETRY_ATTEMPTS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_MOYASAR_GET_RETRY_ATTEMPTS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableGetError(err) {
  if (!err) return false;
  if (err.code === "PAYMENT_PROVIDER_TIMEOUT" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
    return true;
  }
  return [500, 502, 503, 504].includes(Number(err.status));
}

function requestJsonOnce(path, method, body, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const auth = Buffer.from(`${apiKey}:`).toString("base64");
    const timeoutMsRaw = Number(process.env.MOYASAR_REQUEST_TIMEOUT_MS || DEFAULT_MOYASAR_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? timeoutMsRaw
      : DEFAULT_MOYASAR_TIMEOUT_MS;

    const req = https.request(
      {
        hostname: MOYASAR_HOST,
        path,
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          "Content-Length": payload ? Buffer.byteLength(payload) : 0,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const status = res.statusCode || 500;
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (status >= 400) {
              const err = new Error(parsed && parsed.message ? parsed.message : "Moyasar request failed");
              err.status = status;
              err.payload = parsed;
              err.moyasarCode = parsed && parsed.type;
              return reject(err);
            }
            return resolve(parsed);
          } catch (err) {
            err.status = status;
            return reject(err);
          }
        });
      }
    );

    req.on("error", (err) => {
      reject(err);
    });

    req.setTimeout(timeoutMs, () => {
      const err = new Error(`Moyasar request timed out after ${timeoutMs}ms`);
      err.code = "PAYMENT_PROVIDER_TIMEOUT";
      req.destroy(err);
    });

    if (payload) req.write(payload);
    req.end();
  });
}

async function requestJson(path, method, body, apiKey) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (normalizedMethod !== "GET") {
    return requestJsonOnce(path, normalizedMethod, body, apiKey);
  }

  const attempts = getMoyasarGetRetryAttempts();
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestJsonOnce(path, normalizedMethod, body, apiKey);
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !isRetriableGetError(err)) throw err;
      await sleep(MOYASAR_GET_RETRY_BACKOFF_MS[attempt - 1] || MOYASAR_GET_RETRY_BACKOFF_MS[MOYASAR_GET_RETRY_BACKOFF_MS.length - 1]);
    }
  }
  throw lastError;
}

function getUrlSafeSummary(url) {
  if (!url) return "none";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch (e) {
    return "invalid_url";
  }
}

/**
 * Returns names of any required env vars that are not set.
 * Safe to log: only names are returned, never values.
 */
function getMoyasarEnvStatus() {
  if (isPosStagingRuntime()) return { configured: false, missingVars: REQUIRED_ENV_VARS };
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  return {
    configured: missing.length === 0,
    missingVars: missing,
  };
}

function getMoyasarApiKey() {
  if (isPosStagingRuntime()) {
    const error = new Error("Moyasar is disabled in isolated POS Staging");
    error.code = "STAGING_GATEWAY_DISABLED";
    error.status = 503;
    throw error;
  }
  return process.env.MOYASAR_SECRET_KEY;
}

/**
 * Creates a Moyasar invoice (hosted-payment link).
 *
 * @param {object} opts
 * @param {number}  opts.amount        - Amount in halala (smallest unit)
 * @param {string}  [opts.currency]    - ISO currency code, default SAR
 * @param {string}  [opts.description]
 * @param {string}  [opts.callbackUrl] - Webhook callback URL
 * @param {string}  [opts.successUrl]  - Client success deep-link
 * @param {string}  [opts.backUrl]     - Client cancel deep-link
 * @param {object}  [opts.metadata]    - Forwarded to Moyasar as-is
 * @param {string}  [opts._orderId]    - Internal orderId for error context only
 * @param {string}  [opts._paymentId]  - Internal paymentId for error context only
 */
async function createInvoice({
  amount,
  currency = "SAR",
  description,
  callbackUrl,
  successUrl,
  backUrl,
  metadata,
  _orderId,
  _paymentId,
}) {
  const apiKey = getMoyasarApiKey();
  if (!apiKey) {
    const err = new Error("MOYASAR_SECRET_KEY is not configured");
    err.code = "CONFIG";
    err.missingEnv = "MOYASAR_SECRET_KEY";
    err.context = {
      provider: "moyasar",
      missingEnvVars: ["MOYASAR_SECRET_KEY"],
      amountHalala: amount,
      currency,
      orderId: _orderId || undefined,
      paymentId: _paymentId || undefined,
    };
    throw err;
  }

  const body = {
    amount,
    currency,
    description,
    callback_url: callbackUrl,
    success_url: successUrl,
    back_url: backUrl,
    metadata,
  };

  try {
    return await requestJson("/v1/invoices", "POST", body, apiKey);
  } catch (err) {
    // Attach structured diagnostic context — never include secret values.
    err.context = {
      provider: "moyasar",
      amountHalala: amount,
      currency,
      successUrlDomain: getUrlSafeSummary(successUrl),
      backUrlDomain: getUrlSafeSummary(backUrl),
      callbackUrlDomain: getUrlSafeSummary(callbackUrl),
      providerHttpStatus: err.status,
      providerErrorCode: err.moyasarCode,
      providerErrorMessage: err.message,
      orderId: _orderId || undefined,
      paymentId: _paymentId || undefined,
    };
    throw err;
  }
}

async function getInvoice(invoiceId) {
  const apiKey = getMoyasarApiKey();
  if (!apiKey) {
    const err = new Error("Missing MOYASAR_SECRET_KEY");
    err.code = "CONFIG";
    throw err;
  }

  const id = String(invoiceId || "").trim();
  if (!id) {
    const err = new Error("invoiceId is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const query = new URLSearchParams({ id }).toString();
  const response = await requestJson(`/v1/invoices?${query}`, "GET", undefined, apiKey);
  const invoices = Array.isArray(response && response.invoices) ? response.invoices : [];
  const invoice = invoices.find((item) => item && String(item.id) === id);
  if (!invoice) {
    const err = new Error("Invoice not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  return invoice;
}

module.exports = { createInvoice, getInvoice, getMoyasarEnvStatus };
