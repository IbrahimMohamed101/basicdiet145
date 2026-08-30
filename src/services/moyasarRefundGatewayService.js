"use strict";

const https = require("https");

const MOYASAR_HOST = "api.moyasar.com";
const DEFAULT_TIMEOUT_MS = 15000;

function makeError(status, payload, fallback) {
  const error = new Error(payload && payload.message ? payload.message : fallback);
  error.status = status;
  error.code = status >= 500 ? "PAYMENT_PROVIDER_ERROR" : "PAYMENT_PROVIDER_REJECTED";
  error.providerPayload = payload;
  return error;
}

function requestJson(path, method, body) {
  const apiKey = process.env.MOYASAR_SECRET_KEY;
  if (!apiKey) {
    const error = new Error("MOYASAR_SECRET_KEY is not configured");
    error.status = 503;
    error.code = "PAYMENT_PROVIDER_NOT_CONFIGURED";
    throw error;
  }

  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = https.request({
      hostname: MOYASAR_HOST,
      path,
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (response) => {
      let raw = "";
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
        const status = Number(response.statusCode || 500);
        if (status >= 400) return reject(makeError(status, parsed, "Moyasar request failed"));
        return resolve(parsed);
      });
    });

    request.on("error", (error) => {
      error.code = error.code || "PAYMENT_PROVIDER_NETWORK_ERROR";
      reject(error);
    });
    const configuredTimeout = Number(process.env.MOYASAR_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    request.setTimeout(Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_TIMEOUT_MS, () => {
      const error = new Error("Moyasar request timed out");
      error.code = "PAYMENT_PROVIDER_TIMEOUT";
      request.destroy(error);
    });
    if (payload) request.write(payload);
    request.end();
  });
}

function normalizePaymentId(value) {
  const id = String(value || "").trim();
  if (!id) {
    const error = new Error("Moyasar payment id is required");
    error.status = 400;
    error.code = "PAYMENT_PROVIDER_ID_REQUIRED";
    throw error;
  }
  return encodeURIComponent(id);
}

function extractRefundedHalala(snapshot) {
  const raw = snapshot && (
    snapshot.refunded !== undefined ? snapshot.refunded
      : snapshot.refunded_amount !== undefined ? snapshot.refunded_amount
        : snapshot.refund_amount
  );
  const value = Number(raw || 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function getMoyasarPayment(paymentId) {
  return requestJson(`/v1/payments/${normalizePaymentId(paymentId)}`, "GET");
}

async function refundMoyasarPayment({ paymentId, amountHalala }) {
  const amount = Number(amountHalala);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    const error = new Error("Refund amount must be a positive integer in halala");
    error.status = 400;
    error.code = "INVALID_REFUND_AMOUNT";
    throw error;
  }
  return requestJson(
    `/v1/payments/${normalizePaymentId(paymentId)}/refund`,
    "POST",
    { amount }
  );
}

module.exports = {
  extractRefundedHalala,
  getMoyasarPayment,
  refundMoyasarPayment,
};
