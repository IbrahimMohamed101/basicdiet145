const nodemailer = require("nodemailer");
const dns = require("dns");
const net = require("net");
const { ApiError } = require("../utils/apiError");
const { logger } = require("../utils/logger");

const GMAIL_SMTP_HOST = "smtp.gmail.com";
const GMAIL_SMTP_PORT = 465;

let cachedTransporter = null;
let cachedTransporterKey = null;

function getGmailConfig() {
  const user = String(process.env.GMAIL_USER || "").trim().toLowerCase();
  const appPassword = String(process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  const fromName = String(process.env.EMAIL_FROM_NAME || "Basic Diet")
    .replace(/[\r\n"<>]/g, "")
    .trim() || "Basic Diet";

  if (!user || !appPassword) {
    throw new ApiError({
      status: 503,
      code: "EMAIL_PROVIDER_NOT_CONFIGURED",
      message: "Email delivery is not configured",
    });
  }

  return { user, appPassword, fromName };
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
    logger.error("Gmail OTP delivery failed", {
      email: toEmail,
      purpose,
      error: { code: err && err.code, message: err && err.message },
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
}

module.exports = {
  buildGmailTransportOptions,
  getGmailConfig,
  resolveGmailIpv4,
  sendEmailOtp,
  resetGmailTransporterForTests,
};
