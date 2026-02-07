const https = require("https");

const MOYASAR_HOST = "api.moyasar.com";

function requestJson(path, method, body, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const auth = Buffer.from(`${apiKey}:`).toString("base64");
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

module.exports = { createInvoice };
