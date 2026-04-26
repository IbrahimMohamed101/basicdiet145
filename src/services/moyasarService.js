const https = require("https");

const MOYASAR_HOST = "api.moyasar.com";
const DEFAULT_MOYASAR_TIMEOUT_MS = 15000;

function requestJson(path, method, body, apiKey) {
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

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      const err = new Error(`Moyasar request timed out after ${timeoutMs}ms`);
      err.code = "PAYMENT_PROVIDER_TIMEOUT";
      req.destroy(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function createInvoice({ amount, currency = "SAR", description, callbackUrl, successUrl, backUrl, metadata }) {
  const apiKey = process.env.MOYASAR_SECRET_KEY;
  if (!apiKey) {
    const err = new Error("Missing MOYASAR_SECRET_KEY");
    err.code = "CONFIG";
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

  return requestJson("/v1/invoices", "POST", body, apiKey);
}

async function getInvoice(invoiceId) {
  const apiKey = process.env.MOYASAR_SECRET_KEY;
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

module.exports = { createInvoice, getInvoice };
