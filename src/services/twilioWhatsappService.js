const https = require("https");
const { URLSearchParams } = require("url");
const { ApiError } = require("../utils/apiError");

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !from) {
    throw new ApiError({
      status: 500,
      code: "TWILIO_CONFIG_MISSING",
      message: "Twilio WhatsApp configuration is missing",
    });
  }

  return { accountSid, authToken, from };
}

function toWhatsappAddress(phoneE164) {
  return phoneE164.startsWith("whatsapp:") ? phoneE164 : `whatsapp:${phoneE164}`;
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

async function sendWhatsappMessage({ toPhoneE164, body }) {
  const { accountSid, authToken, from } = getTwilioConfig();
  const payload = new URLSearchParams({
    From: toWhatsappAddress(from),
    To: toWhatsappAddress(toPhoneE164),
    Body: body,
  }).toString();

  const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const response = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.twilio.com",
        path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
        method: "POST",
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 500,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });

  const parsed = parseJsonSafely(response.body);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new ApiError({
      status: 502,
      code: "TWILIO_SEND_FAILED",
      message: parsed && parsed.message ? parsed.message : "Failed to send WhatsApp OTP",
    });
  }

  return parsed;
}

module.exports = { sendWhatsappMessage };
