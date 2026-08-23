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

function normalizeEnvironmentValue(value) {
  const raw = String(value || "").trim();
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1).trim();
    }
  }
  return raw;
}

function normalizeDeliveryProvider(value) {
  const provider = normalizeEnvironmentValue(value || "smtp").toLowerCase();
  if (provider === "smtp" || provider === "gmail_api") return provider;
  throw new ApiError({
    status: 503,
    code: "EMAIL_PROVIDER_NOT_CONFIGURED",
    message: "Email delivery provider is not configured correctly",
  });
}

function getGmailConfig() {
  const provider = normalizeDeliveryProvider(process.env.EMAIL_DELIVERY_PROVIDER);
  const user = normalizeEnvironmentValue(process.env.GMAIL_USER).toLowerCase();
  const appPassword = normalizeEnvironmentValue(process.env.GMAIL_APP_PASSWORD).replace(/\s+/g, "");
  const clientId = normalizeEnvironmentValue(process.env.GMAIL_OAUTH_CLIENT_ID);
  const clientSecret = normalizeEnvironmentValue(process.env.GMAIL_OAUTH_CLIENT_SECRET);
  const refreshToken = normalizeEnvironmentValue(process.env.GMAIL_OAUTH_REFRESH_TOKEN);
  const fromName = normalizeEnvironmentValue(process.env.EMAIL_FROM_NAME || "Basic Diet")
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

async function resolveGmailIpv4Addresses(resolve4 = dns.promises.resolve4.bind(dns.promises)) {
  const addresses = await resolve4(GMAIL_SMTP_HOST);
  const ipv4Addresses = (Array.isArray(addresses) ? addresses : [])
    .filter((address) => net.isIPv4(address));

  if (!ipv4Addresses.length) {
    const err = new Error("Gmail SMTP did not resolve to an IPv4 address");
    err.code = "EDNS";
    throw err;
  }

  return [...new Set(ipv4Addresses)];
}

async function resolveGmailIpv4(resolve4 = dns.promises.resolve4.bind(dns.promises)) {
  const addresses = await resolveGmailIpv4Addresses(resolve4);
  return addresses[0];
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

async function getTransporter(config = getGmailConfig(), ipv4Address = null) {
  const resolvedAddress = ipv4Address || await resolveGmailIpv4();
  const key = `${config.user}:${config.appPassword}:${resolvedAddress}`;
  if (cachedTransporter && cachedTransporterKey === key) {
    return { transporter: cachedTransporter, config };
  }

  cachedTransporter = nodemailer.createTransport(
    buildGmailTransportOptions(config, resolvedAddress)
  );
  cachedTransporterKey = key;
  return { transporter: cachedTransporter, config };
}

async function sendEmailOtpWithSmtp({ config, toEmail, copy, content }) {
  const addresses = await resolveGmailIpv4Addresses();
  let lastError = null;
  for (const address of addresses) {
    try {
      const { transporter } = await getTransporter(config, address);
      return await transporter.sendMail({
        disableFileAccess: true,
        disableUrlAccess: true,
        from: `"${config.fromName}" <${config.user}>`,
        to: toEmail,
        subject: copy.subject,
        text: content.text,
        html: content.html,
      });
    } catch (err) {
      lastError = err;
      cachedTransporter = null;
      cachedTransporterKey = null;
      if (err && ["EAUTH", "EENVELOPE", "EMESSAGE"].includes(err.code)) break;
    }
  }
  throw lastError || new Error("Gmail SMTP delivery failed");
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

async function sendEmailOtpWithGmailApi({ config, toEmail, copy, content }) {
  const raw = buildGmailApiRawMessage({
    fromEmail: config.user,
    fromName: config.fromName,
    toEmail,
    subject: copy.subject,
    textBody: content.text,
    htmlBody: content.html,
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
      subject: "Basic Diet | رمز إعادة تعيين كلمة المرور",
      titleAr: "رمز إعادة تعيين كلمة المرور",
      titleEn: "Password reset code",
      introAr: "استخدم الرمز التالي لإعادة تعيين كلمة مرور حسابك.",
      introEn: "Use the following code to reset your account password.",
    };
  }
  return {
    subject: "Basic Diet | رمز توثيق البريد الإلكتروني",
    titleAr: "رمز توثيق البريد الإلكتروني",
    titleEn: "Email verification code",
    introAr: "استخدم الرمز التالي لتوثيق بريدك وإكمال إنشاء حسابك.",
    introEn: "Use the following code to verify your email and finish creating your account.",
  };
}

function buildOtpEmailContent({ copy, otp, safeOtp, minutes }) {
  const text = [
    "Basic Diet",
    "",
    copy.titleAr,
    copy.introAr,
    `رمز التحقق: ${otp}`,
    `تنتهي صلاحية هذا الرمز خلال ${minutes} دقائق. لا تشارك الرمز مع أي شخص.`,
    "إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.",
    "",
    copy.titleEn,
    copy.introEn,
    `Verification code: ${otp}`,
    `This code expires in ${minutes} minutes. Never share it with anyone.`,
    "If you did not request this code, you can safely ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${copy.titleAr}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f6f4;color:#18332a;font-family:Tahoma,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${copy.titleAr} — الرمز صالح لمدة ${minutes} دقائق.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f3f6f4;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dfe8e3;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(20,63,50,0.08);">
            <tr>
              <td align="center" style="padding:28px 24px;background-color:#174f3f;color:#ffffff;">
                <div dir="ltr" style="font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:3px;color:#bfe6d5;">BASIC DIET</div>
                <div style="margin-top:8px;font-size:22px;font-weight:700;line-height:1.5;">${copy.titleAr}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px 18px;text-align:right;">
                <p style="margin:0 0 20px;font-size:16px;line-height:1.9;color:#29493e;">مرحبًا،</p>
                <p style="margin:0;font-size:16px;line-height:1.9;color:#29493e;">${copy.introAr}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 28px 24px;">
                <div style="font-size:13px;font-weight:700;color:#5c776d;margin-bottom:10px;">رمز التحقق</div>
                <div dir="ltr" style="display:inline-block;min-width:250px;padding:18px 24px;border:1px solid #b9d8ca;border-radius:14px;background-color:#edf8f3;color:#123f32;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:9px;line-height:1;box-sizing:border-box;">${safeOtp}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#fff8e8;border:1px solid #f2dca6;border-radius:12px;">
                  <tr>
                    <td style="padding:14px 16px;font-size:14px;line-height:1.8;color:#6b5421;text-align:right;">
                      تنتهي صلاحية الرمز خلال <strong>${minutes} دقائق</strong>. لا تشارك هذا الرمز مع أي شخص، بما في ذلك فريق Basic Diet.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td dir="ltr" style="padding:26px 28px;border-top:1px solid #e8eeeb;text-align:left;">
                <div style="font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:1.5;color:#183f33;">${copy.titleEn}</div>
                <p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#667b73;">${copy.introEn} This code expires in ${minutes} minutes.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;background-color:#f8faf9;text-align:center;font-size:12px;line-height:1.8;color:#74877f;">
                إذا لم تطلب هذا الرمز، تجاهل الرسالة ولن يتم إجراء أي تغيير على حسابك.<br>
                <span dir="ltr">If you did not request this code, you can safely ignore this email.</span>
              </td>
            </tr>
          </table>
          <div style="padding:18px 12px 0;font-size:11px;color:#8a9a94;text-align:center;">© Basic Diet — رسالة آلية، يرجى عدم مشاركة رمز التحقق.</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { text, html };
}

async function sendEmailOtp({ toEmail, otp, purpose, expiresInMinutes }) {
  const config = getGmailConfig();
  const copy = getPurposeCopy(purpose);
  const safeOtp = escapeHtml(otp);
  const minutes = Number(expiresInMinutes) || 5;
  const content = buildOtpEmailContent({ copy, otp, safeOtp, minutes });

  try {
    if (config.provider === "gmail_api") {
      const info = await sendEmailOtpWithGmailApi({
        config,
        toEmail,
        copy,
        content,
      });
      logger.info("Email OTP accepted by Gmail API", {
        email: toEmail,
        purpose,
        messageId: info.messageId,
      });
      return info;
    }

    const info = await sendEmailOtpWithSmtp({ config, toEmail, copy, content });
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
  buildOtpEmailContent,
  getGmailApiAccessToken,
  getGmailConfig,
  normalizeEnvironmentValue,
  normalizeDeliveryProvider,
  postGmailApiMessage,
  resolveGmailIpv4,
  resolveGmailIpv4Addresses,
  sendEmailOtpWithSmtp,
  sendEmailOtp,
  resetGmailTransporterForTests,
};
