const https = require("https");
const { URLSearchParams } = require("url");
const { ApiError } = require("../utils/apiError");
const { logger } = require("../utils/logger");

const VERIFY_HOSTNAME = "verify.twilio.com";
const VERIFY_API_PREFIX = "/v2/Services";

function getTwilioVerifyConfig() {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const serviceSid = String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim();

  if (!accountSid || !authToken || !serviceSid) {
    throw new ApiError({
      status: 500,
      code: "TWILIO_CONFIG_MISSING",
      message: "Twilio Verify configuration is missing",
    });
  }

  if (!/^VA[a-f0-9]{32}$/i.test(serviceSid)) {
    throw new ApiError({
      status: 500,
      code: "TWILIO_VERIFY_SERVICE_INVALID",
      message: "Twilio Verify service SID is invalid",
    });
  }

  return { accountSid, authToken, serviceSid };
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function buildAuthHeader(accountSid, authToken) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

async function postTwilioVerifyForm({ path, payload }) {
  const { accountSid, authToken } = getTwilioVerifyConfig();
  const body = new URLSearchParams(payload).toString();

  const response = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: VERIFY_HOSTNAME,
        path,
        method: "POST",
        headers: {
          Authorization: buildAuthHeader(accountSid, authToken),
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
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
    req.write(body);
    req.end();
  });

  return {
    statusCode: response.statusCode,
    parsed: parseJsonSafely(response.body),
  };
}

function normalizeTwilioErrorPayload(response, fallbackError) {
  const parsed = response && response.parsed ? response.parsed : {};
  return {
    code: parsed.code || (fallbackError && fallbackError.code),
    status: parsed.status || (response && response.statusCode),
    message: parsed.message || (fallbackError && fallbackError.message),
    moreInfo: parsed.more_info || parsed.moreInfo,
    details: parsed.details,
  };
}

function logTwilioFailure(action, { response, error, toPhoneE164, serviceSid }) {
  const twilioError = normalizeTwilioErrorPayload(response, error);
  logger.error("Twilio Verify request failed", {
    action,
    toPhoneE164,
    serviceSid,
    error: twilioError,
  });
}

function buildVerifyPath(serviceSid, resource) {
  return `${VERIFY_API_PREFIX}/${encodeURIComponent(serviceSid)}/${resource}`;
}

async function sendOtpVerification({ toPhoneE164 }) {
  const { serviceSid } = getTwilioVerifyConfig();
  let response;
  try {
    response = await postTwilioVerifyForm({
      path: buildVerifyPath(serviceSid, "Verifications"),
      payload: {
        To: toPhoneE164,
        Channel: "sms",
      },
    });
  } catch (err) {
    logTwilioFailure("verifications.create", {
      toPhoneE164,
      serviceSid,
      error: err,
    });
    throw new ApiError({
      status: 502,
      code: "TWILIO_VERIFY_SEND_FAILED",
      message: "Failed to send OTP",
    });
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    logTwilioFailure("verifications.create", {
      response,
      toPhoneE164,
      serviceSid,
    });
    throw new ApiError({
      status: 502,
      code: "TWILIO_VERIFY_SEND_FAILED",
      message: "Failed to send OTP",
    });
  }

  const parsed = response.parsed || {};
  logger.info("Twilio Verify OTP requested", {
    action: "verifications.create",
    toPhoneE164,
    channel: parsed.channel || "sms",
    serviceSid,
    verificationSid: parsed.sid,
    twilioStatus: parsed.status,
  });

  return {
    sid: parsed.sid,
    status: parsed.status,
    channel: parsed.channel || "sms",
  };
}

async function createVerificationCheck({ toPhoneE164, code }) {
  const { serviceSid } = getTwilioVerifyConfig();
  let response;
  try {
    response = await postTwilioVerifyForm({
      path: buildVerifyPath(serviceSid, "VerificationCheck"),
      payload: {
        To: toPhoneE164,
        Code: code,
      },
    });
  } catch (err) {
    logTwilioFailure("verificationChecks.create", {
      toPhoneE164,
      serviceSid,
      error: err,
    });
    throw new ApiError({
      status: 502,
      code: "TWILIO_VERIFY_CHECK_FAILED",
      message: "Failed to verify OTP",
    });
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    logTwilioFailure("verificationChecks.create", {
      response,
      toPhoneE164,
      serviceSid,
    });
    throw new ApiError({
      status: 502,
      code: "TWILIO_VERIFY_CHECK_FAILED",
      message: "Failed to verify OTP",
    });
  }

  const parsed = response.parsed || {};
  logger.info("Twilio Verify OTP check completed", {
    action: "verificationChecks.create",
    toPhoneE164,
    serviceSid,
    verificationCheckSid: parsed.sid,
    twilioStatus: parsed.status,
  });

  return {
    sid: parsed.sid,
    status: parsed.status,
    approved: parsed.status === "approved",
  };
}

module.exports = {
  createVerificationCheck,
  sendOtpVerification,
};
