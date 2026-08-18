const nodemailer = require("nodemailer");
const dns = require("dns");
const net = require("net");
const crypto = require("crypto");
const { ApiError } = require("../utils/apiError");
const { logger } = require("../utils/logger");

const GMAIL_SMTP_HOST = "smtp.gmail.com";
const GMAIL_SMTP_PORT = 465;
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

let cachedTransporter = null;
let cachedTransporterKey = null;
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;
let pendingAccessTokenPromise = null;

function normalizeDeliveryProvider(value) {
  const provider = String(value || "smtp").trim().toLowerCase();
  if (provider === "smtp" || provider === "gmail_api") return provider;
  throw new ApiError({
    status: 503,
    code: "EMAIL_PROVIDER_NOT_CONFIGURED",
    message: "Email delivery provider is not configured correctly",
  });
}

function getGmailConfig() {
  const provider = normalizeDeliveryProvider(process.env.EMAIL_DELIVERY_PROVIDER);
  const user = String(process.env.GMAIL_USER || "").trim().toLowerCase();
  const appPassword = String(process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  const clientId = String(process.env.GMAIL_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GMAIL_OAUTH_CLIENT_SECRET || "").trim();
  const refreshToken = String(process.env.GMAIL_OAUTH_REFRESH_TOKEN || "").trim();
  const fromName = String(process.env.EMAIL_FROM_NAME || "Basic Diet")
    .replace(/[\r\n"<>]/g, "")
    .trim() || "Basic Diet";

  const gmailUserIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user);
  const smtpIsConfigured = provider === "smtp" && appPassword.length >= 16;
  const apiIsConfigured = provider === "gmail_api"
    && clientId.length > 0
    && clientSecret.length > 0
    && refreshToken.length > 0;

  if (!gmailUserIsValid || (!smtpIsConfigured && !apiIsConfigured)) {
    throw new ApiError({
      status: 503,
      code: "EMAIL_PROVIDER_NOT_CONFIGURED",
      message: "Email delivery is not configured",
    });
  }

  return {
    provider,
    user,
    appPassword,
    clientId,
    clientSecret,
    refreshToken,
    fromName,
  };
}

async function resolveGmailIpv4(resolve4 = dns.promises.resolve4.bind(dns.promises)) {
  const addresses = await resolve4(GMAIL_SMTP_HOST);
  const ipv4Addresses = (Array.isArray(addresses) ? addresses : [])
    .filter((address) => net.isIPv4(address));

  if (!ipv4Addresses.length) {
    const err = new Error("Gmail SMTP did not resolve to an IPv4 address");
    err.code = "EDNS";
    throw err;
  }

  return ipv4Addresses[0];
}

function buildGmailTransportOptions(config, ipv4Address) {
  if (!net.isIPv4(ipv4Address)) {
    throw new TypeError("Gmail SMTP transport requires an IPv4 address");
  }

  return {
    // Railway containers may expose an IPv6 interface without an outbound
    // IPv6 route. Nodemailer otherwise resolves both families and may select
    // Gmail's AAAA record, which fails with ENETUNREACH. Resolve A records
    // explicitly while keeping smtp.gmail.com as the TLS/SNI identity.
    host: ipv4Address,
    port: GMAIL_SMTP_PORT,
    secure: true,
    servername: GMAIL_SMTP_HOST,
    auth: {
      user: config.user,
      pass: config.appPassword,
    },
    connectionTimeout: Number(process.env.EMAIL_SMTP_CONNECTION_TIMEOUT_MS) || 10000,
    greetingTimeout: Number(process.env.EMAIL_SMTP_GREETING_TIMEOUT_MS) || 10000,
    socketTimeout: Number(process.env.EMAIL_SMTP_SOCKET_TIMEOUT_MS) || 15000,
    tls: {
      rejectUnauthorized: true,
      servername: GMAIL_SMTP_HOST,
    },
  };
}

async function getTransporter(config = getGmailConfig()) {
  const key = `${config.user}:${config.appPassword}`;
  if (cachedTransporter && cachedTransporterKey === key) {
    return { transporter: cachedTransporter, config };
  }

  const ipv4Address = await resolveGmailIpv4();
  cachedTransporter = nodemailer.createTransport(
    buildGmailTransportOptions(config, ipv4Address)
  );
  cachedTransporterKey = key;
  return { transporter: cachedTransporter, config };
}

function getGmailApiTimeoutMs() {
  const configured = Number(process.env.EMAIL_GMAIL_API_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1000 ? configured : 10000;
}

function createTimeoutSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function clearCachedAccessToken() {
  cachedAccessToken = null;
  cachedAccessTokenExpiresAt = 0;
}

async function requestGmailApiAccessToken(config, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== "function") {
    const err = new Error("HTTPS client is unavailable");
    err.code = "GMAIL_API_HTTP_CLIENT_UNAVAILABLE";
    throw err;
  }

  const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
    signal: createTimeoutSignal(getGmailApiTimeoutMs()),
  });
  const body = await readJsonResponse(response);
  if (!response.ok || typeof body.access_token !== "string" || !body.access_token) {
    const err = new Error("Google OAuth token request failed");
    err.code = "GMAIL_OAUTH_TOKEN_FAILED";
    err.status = response.status;
    throw err;
  }

  const expiresInSeconds = Math.max(60, Number(body.expires_in) || 3600);
  cachedAccessToken = body.access_token;
  cachedAccessTokenExpiresAt = Date.now() + (expiresInSeconds * 1000);
  return cachedAccessToken;
}

async function getGmailApiAccessToken(config, fetchImpl = global.fetch) {
  if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now() + 60000) {
    return cachedAccessToken;
  }
  if (!pendingAccessTokenPromise) {
    pendingAccessTokenPromise = requestGmailApiAccessToken(config, fetchImpl)
      .finally(() => {
        pendingAccessTokenPromise = null;
      });
  }
  return pendingAccessTokenPromise;
}

function sanitizeEmailHeaderAddress(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email)) {
    throw new TypeError("Invalid email header address");
  }
  return email;
}

function encodeMimeHeader(value) {
  const clean = String(value || "").replace(/[\r\n]+/g, " ").trim();
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function encodeMimeBody(value) {
  return Buffer.from(String(value || ""), "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n")
    .trimEnd();
}

function buildGmailApiRawMessage({ fromEmail, fromName, toEmail, subject, textBody, htmlBody }) {
  const sender = sanitizeEmailHeaderAddress(fromEmail);
  const recipient = sanitizeEmailHeaderAddress(toEmail);
  const boundary = `basicdiet_${crypto.randomBytes(18).toString("hex")}`;
  const lines = [
    `From: ${encodeMimeHeader(fromName)} <${sender}>`,
    `To: ${recipient}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(textBody),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(htmlBody),
    `--${boundary}--`,
    "",
  ];
  return Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function postGmailApiMessage({ config, raw, fetchImpl = global.fetch, retryAuth = true }) {
  const accessToken = await getGmailApiAccessToken(config, fetchImpl);
  const response = await fetchImpl(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ raw }),
    signal: createTimeoutSignal(getGmailApiTimeoutMs()),
  });
  const body = await readJsonResponse(response);
  if (response.status === 401 && retryAuth) {
    clearCachedAccessToken();
    return postGmailApiMessage({ config, raw, fetchImpl, retryAuth: false });
  }
  if (!response.ok || typeof body.id !== "string" || !body.id) {
    const err = new Error("Gmail API send request failed");
    err.code = "GMAIL_API_SEND_FAILED";
    err.status = response.status;
    throw err;
  }
  return { messageId: body.id };
}

async function sendEmailOtpWithGmailApi({ config, toEmail, copy, otp, safeOtp, minutes }) {
  const textBody = `${copy.titleEn}: ${otp}. This code expires in ${minutes} minutes. Do not share it with anyone.`;
  const htmlBody = `
        <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7;color:#17211b">
          <h2>${copy.titleAr}</h2>
          <p>استخدم الرمز التالي لإكمال العملية في تطبيق Basic Diet:</p>
          <div dir="ltr" style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${safeOtp}</div>
          <p>صلاحية الرمز ${minutes} دقائق. لا تشارك الرمز مع أي شخص.</p>
          <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0" />
          <div dir="ltr">
            <h3>${copy.titleEn}</h3>
            <p>This code expires in ${minutes} minutes. Do not share it with anyone.</p>
          </div>
        </div>
      `;
  const raw = buildGmailApiRawMessage({
    fromEmail: config.user,
    fromName: config.fromName,
    toEmail,
    subject: copy.subject,
    textBody,
    htmlBody,
  });
  return postGmailApiMessage({ config, raw });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getPurposeCopy(purpose) {
  if (purpose === "password_reset") {
    return {
      subject: "Basic Diet password reset code",
      titleAr: "رمز إعادة تعيين كلمة المرور",
      titleEn: "Password reset code",
    };
  }
  return {
    subject: "Basic Diet email verification code",
    titleAr: "رمز توثيق البريد الإلكتروني",
    titleEn: "Email verification code",
  };
}

async function sendEmailOtp({ toEmail, otp, purpose, expiresInMinutes }) {
  const config = getGmailConfig();
  const copy = getPurposeCopy(purpose);
  const safeOtp = escapeHtml(otp);
  const minutes = Number(expiresInMinutes) || 5;

  try {
    if (config.provider === "gmail_api") {
      const info = await sendEmailOtpWithGmailApi({
        config,
        toEmail,
        copy,
        otp,
        safeOtp,
        minutes,
      });
      logger.info("Email OTP accepted by Gmail API", {
        email: toEmail,
        purpose,
        messageId: info.messageId,
      });
      return info;
    }

    const { transporter } = await getTransporter(config);
    const info = await transporter.sendMail({
      disableFileAccess: true,
      disableUrlAccess: true,
      from: `"${config.fromName}" <${config.user}>`,
      to: toEmail,
      subject: copy.subject,
      text: `${copy.titleEn}: ${otp}. This code expires in ${minutes} minutes. Do not share it with anyone.`,
      html: `
        <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7;color:#17211b">
          <h2>${copy.titleAr}</h2>
          <p>استخدم الرمز التالي لإكمال العملية في تطبيق Basic Diet:</p>
          <div dir="ltr" style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${safeOtp}</div>
          <p>صلاحية الرمز ${minutes} دقائق. لا تشارك الرمز مع أي شخص.</p>
          <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0" />
          <div dir="ltr">
            <h3>${copy.titleEn}</h3>
            <p>This code expires in ${minutes} minutes. Do not share it with anyone.</p>
          </div>
        </div>
      `,
    });
    logger.info("Email OTP accepted by Gmail", {
      email: toEmail,
      purpose,
      messageId: info.messageId,
    });
    return { messageId: info.messageId || null };
  } catch (err) {
    // Re-resolve Gmail's A records on the next request after any connection
    // failure instead of pinning a failed address in the cached transporter.
    cachedTransporter = null;
    cachedTransporterKey = null;
    clearCachedAccessToken();
    logger.error("Gmail OTP delivery failed", {
      email: toEmail,
      purpose,
      provider: config.provider,
      error: {
        code: err && err.code,
        message: err && err.message,
        status: err && err.status,
      },
    });
    throw new ApiError({
      status: 502,
      code: "EMAIL_SEND_FAILED",
      message: "Failed to send verification email",
    });
  }
}

function resetGmailTransporterForTests() {
  cachedTransporter = null;
  cachedTransporterKey = null;
  clearCachedAccessToken();
  pendingAccessTokenPromise = null;
}

module.exports = {
  buildGmailApiRawMessage,
  buildGmailTransportOptions,
  getGmailApiAccessToken,
  getGmailConfig,
  normalizeDeliveryProvider,
  postGmailApiMessage,
  resolveGmailIpv4,
  sendEmailOtp,
  resetGmailTransporterForTests,
};
