const assert = require("assert");
const { assertNoTestFlagsInProduction } = require("../src/utils/security");
const {
  buildGmailApiRawMessage,
  buildGmailTransportOptions,
  buildOtpEmailContent,
  getGmailConfig,
  normalizeEnvironmentValue,
  normalizeDeliveryProvider,
  postGmailApiMessage,
  resetGmailTransporterForTests,
  resolveGmailIpv4,
  resolveGmailIpv4Addresses,
} = require("../src/services/gmailEmailService");
const { isEmailOtpEnabled } = require("../src/services/emailOtpService");

const MANAGED_KEYS = [
  "NODE_ENV",
  "APP_URL",
  "AUTH_EMAIL_OTP_ENABLED",
  "EMAIL_OTP_HASH_SECRET",
  "EMAIL_OTP_TEST_MODE",
  "EMAIL_OTP_TEST_EMAIL",
  "EMAIL_OTP_TEST_CODE",
  "ALLOW_TEST_AUTH",
  "ALLOW_STAGING_TEST_AUTH",
  "EMAIL_DELIVERY_PROVIDER",
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "GMAIL_OAUTH_CLIENT_ID",
  "GMAIL_OAUTH_CLIENT_SECRET",
  "GMAIL_OAUTH_REFRESH_TOKEN",
  "EMAIL_FROM_NAME",
];

async function withEnvironment(values, fn) {
  const previous = Object.fromEntries(MANAGED_KEYS.map((key) => [key, process.env[key]]));
  for (const key of MANAGED_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    for (const key of MANAGED_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    resetGmailTransporterForTests();
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function main() {
  await withEnvironment({ NODE_ENV: "production", APP_URL: "https://api.example.com" }, () => {
    const result = assertNoTestFlagsInProduction();
    assert(!result.violations || !result.violations.some((item) => item.includes("GMAIL_")));
  });

  await withEnvironment({
    NODE_ENV: "production",
    APP_URL: "https://api.example.com",
    AUTH_EMAIL_OTP_ENABLED: " TRUE ",
  }, () => {
    assert.strictEqual(isEmailOtpEnabled(), true);
    const result = assertNoTestFlagsInProduction();
    assert.strictEqual(result.ok, false);
    assert(result.violations.some((item) => item.includes("EMAIL_OTP_HASH_SECRET")));
    assert(result.violations.some((item) => item.includes("GMAIL_USER")));
    assert(result.violations.some((item) => item.includes("GMAIL_APP_PASSWORD")));
  });

  assert.strictEqual(normalizeEnvironmentValue('"otp.sender@gmail.com"'), "otp.sender@gmail.com");
  assert.strictEqual(normalizeEnvironmentValue("'abcdefghijklmnop'"), "abcdefghijklmnop");
  assert.strictEqual(normalizeEnvironmentValue(" Basic Diet "), "Basic Diet");
  assert.strictEqual(normalizeDeliveryProvider('"smtp"'), "smtp");

  await withEnvironment({
    NODE_ENV: "production",
    APP_URL: "https://api.example.com",
    AUTH_EMAIL_OTP_ENABLED: "true",
    EMAIL_OTP_HASH_SECRET: "e".repeat(32),
    EMAIL_DELIVERY_PROVIDER: "smtp",
    GMAIL_USER: "OTP.Sender@Gmail.com",
    GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
    EMAIL_FROM_NAME: "Basic Diet\r\nBcc: attacker@example.com",
  }, () => {
    const result = assertNoTestFlagsInProduction();
    const emailViolations = (result.violations || []).filter((item) => /EMAIL_OTP|GMAIL_|EMAIL_DELIVERY/.test(item));
    assert.deepStrictEqual(emailViolations, []);

    const config = getGmailConfig();
    assert.strictEqual(config.provider, "smtp");
    assert.strictEqual(config.user, "otp.sender@gmail.com");
    assert.strictEqual(config.appPassword, "abcdefghijklmnop");
    assert(!/[\r\n"<>]/.test(config.fromName));

    const transport = buildGmailTransportOptions(config, "142.250.153.108");
    assert.strictEqual(transport.host, "142.250.153.108");
    assert.strictEqual(transport.port, 465);
    assert.strictEqual(transport.secure, true);
    assert.strictEqual(transport.servername, "smtp.gmail.com");
    assert.strictEqual(transport.tls.servername, "smtp.gmail.com");
    assert.strictEqual(transport.tls.rejectUnauthorized, true);
    assert.strictEqual(transport.auth.user, config.user);
    assert.strictEqual(transport.auth.pass, config.appPassword);
  });

  assert.throws(
    () => buildGmailTransportOptions(
      { user: "otp.sender@gmail.com", appPassword: "abcdefghijklmnop" },
      "2404:6800:4003:c04::6c"
    ),
    /requires an IPv4 address/
  );

  const resolved = await resolveGmailIpv4(async (hostname) => {
    assert.strictEqual(hostname, "smtp.gmail.com");
    return ["142.250.153.108", "142.250.153.109"];
  });
  assert.strictEqual(resolved, "142.250.153.108");
  const resolvedAddresses = await resolveGmailIpv4Addresses(async () => [
    "142.250.153.108",
    "2404:6800:4003:c04::6c",
    "142.250.153.109",
    "142.250.153.108",
  ]);
  assert.deepStrictEqual(resolvedAddresses, ["142.250.153.108", "142.250.153.109"]);
  await assert.rejects(
    () => resolveGmailIpv4(async () => ["2404:6800:4003:c04::6c"]),
    (err) => err && err.code === "EDNS"
  );

  await withEnvironment({
    NODE_ENV: "production",
    APP_URL: "https://api.example.com",
    AUTH_EMAIL_OTP_ENABLED: "true",
    EMAIL_OTP_HASH_SECRET: "e".repeat(32),
    EMAIL_DELIVERY_PROVIDER: "gmail_api",
    GMAIL_USER: "OTP.Sender@Gmail.com",
    GMAIL_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com",
    GMAIL_OAUTH_CLIENT_SECRET: "oauth-client-secret",
    GMAIL_OAUTH_REFRESH_TOKEN: "1//oauth-refresh-token-long-enough",
    EMAIL_FROM_NAME: "Basic Diet\r\nBcc: attacker@example.com",
  }, async () => {
    const result = assertNoTestFlagsInProduction();
    const emailViolations = (result.violations || []).filter((item) => /EMAIL_OTP|GMAIL_|EMAIL_DELIVERY/.test(item));
    assert.deepStrictEqual(emailViolations, []);

    const config = getGmailConfig();
    assert.strictEqual(config.provider, "gmail_api");
    assert.strictEqual(config.user, "otp.sender@gmail.com");
    assert.strictEqual(config.clientId, "client-id.apps.googleusercontent.com");
    assert.strictEqual(config.clientSecret, "oauth-client-secret");
    assert.strictEqual(config.refreshToken, "1//oauth-refresh-token-long-enough");
    assert(!/[\r\n"<>]/.test(config.fromName));

    const content = buildOtpEmailContent({
      copy: {
        titleAr: "رمز توثيق البريد الإلكتروني",
        titleEn: "Email verification code",
        introAr: "استخدم الرمز التالي لتوثيق بريدك.",
        introEn: "Use this code to verify your email.",
      },
      otp: "654321",
      safeOtp: "654321",
      minutes: 5,
    });
    assert(content.text.includes("رمز التحقق: 654321"));
    assert(content.text.includes("Verification code: 654321"));
    assert(content.html.startsWith("<!doctype html>"));
    assert(content.html.includes('<html lang="ar" dir="rtl">'));
    assert(content.html.includes("BASIC DIET"));
    assert(content.html.includes(">654321</div>"));
    assert(content.html.includes("5 دقائق"));
    assert(!/<script|<img|https?:\/\//i.test(content.html));
    assert(Buffer.byteLength(content.html, "utf8") < 20000);

    const raw = buildGmailApiRawMessage({
      fromEmail: config.user,
      fromName: config.fromName,
      toEmail: "recipient@example.com",
      subject: "Basic Diet verification code",
      textBody: content.text,
      htmlBody: content.html,
    });
    assert(/^[A-Za-z0-9_-]+$/.test(raw));
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    assert(mime.includes("To: recipient@example.com"));
    assert(mime.includes("Content-Type: multipart/alternative"));
    assert(!mime.includes("Bcc: attacker@example.com"));
    assert.throws(
      () => buildGmailApiRawMessage({
        fromEmail: config.user,
        fromName: "Basic Diet",
        toEmail: "recipient@example.com\r\nBcc: attacker@example.com",
        subject: "subject",
        textBody: "text",
        htmlBody: "html",
      }),
      /Invalid email header address/
    );

    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (url === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(options.body);
        assert.strictEqual(form.get("grant_type"), "refresh_token");
        assert.strictEqual(form.get("client_id"), config.clientId);
        assert.strictEqual(form.get("client_secret"), config.clientSecret);
        assert.strictEqual(form.get("refresh_token"), config.refreshToken);
        return jsonResponse(200, { access_token: "access-token", expires_in: 3600 });
      }
      assert.strictEqual(url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      assert.strictEqual(options.headers.authorization, "Bearer access-token");
      assert.strictEqual(JSON.parse(options.body).raw, raw);
      return jsonResponse(200, { id: `gmail-message-${calls.length}` });
    };

    const first = await postGmailApiMessage({ config, raw, fetchImpl });
    const second = await postGmailApiMessage({ config, raw, fetchImpl });
    assert.strictEqual(first.messageId, "gmail-message-2");
    assert.strictEqual(second.messageId, "gmail-message-3");
    assert.strictEqual(calls.filter((call) => call.url.includes("oauth2.googleapis.com")).length, 1);
  });

  await withEnvironment({
    NODE_ENV: "production",
    APP_URL: "https://api.example.com",
    AUTH_EMAIL_OTP_ENABLED: "true",
    EMAIL_OTP_HASH_SECRET: "e".repeat(32),
    EMAIL_DELIVERY_PROVIDER: "gmail_api",
    GMAIL_USER: "otp.sender@gmail.com",
  }, () => {
    const result = assertNoTestFlagsInProduction();
    assert.strictEqual(result.ok, false);
    assert(result.violations.some((item) => item.includes("GMAIL_OAUTH_CLIENT_ID")));
    assert(result.violations.some((item) => item.includes("GMAIL_OAUTH_CLIENT_SECRET")));
    assert(result.violations.some((item) => item.includes("GMAIL_OAUTH_REFRESH_TOKEN")));
    assert.throws(() => getGmailConfig(), /Email delivery is not configured/);
  });

  await withEnvironment({
    NODE_ENV: "production",
    APP_URL: "https://api.example.com",
    AUTH_EMAIL_OTP_ENABLED: "true",
    EMAIL_OTP_HASH_SECRET: "e".repeat(32),
    EMAIL_OTP_TEST_MODE: "true",
    ALLOW_TEST_AUTH: "true",
    EMAIL_OTP_TEST_EMAIL: "test@example.com",
    EMAIL_OTP_TEST_CODE: "654321",
  }, () => {
    const result = assertNoTestFlagsInProduction();
    assert.strictEqual(result.ok, false);
    assert(result.violations.some((item) => item.includes("EMAIL_OTP_TEST_MODE")));
  });

  console.log("Email OTP security config tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
