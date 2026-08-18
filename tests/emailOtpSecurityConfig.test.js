const assert = require("assert");
const { assertNoTestFlagsInProduction } = require("../src/utils/security");
const {
  buildGmailTransportOptions,
  getGmailConfig,
  resolveGmailIpv4,
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
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "EMAIL_FROM_NAME",
];

function withEnvironment(values, fn) {
  const previous = Object.fromEntries(MANAGED_KEYS.map((key) => [key, process.env[key]]));
  for (const key of MANAGED_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return fn();
  } finally {
    for (const key of MANAGED_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

withEnvironment({ NODE_ENV: "production", APP_URL: "https://api.example.com" }, () => {
  const result = assertNoTestFlagsInProduction();
  assert(!result.violations || !result.violations.some((item) => item.includes("GMAIL_")));
});

withEnvironment({
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

withEnvironment({
  NODE_ENV: "production",
  APP_URL: "https://api.example.com",
  AUTH_EMAIL_OTP_ENABLED: "true",
  EMAIL_OTP_HASH_SECRET: "e".repeat(32),
  GMAIL_USER: "OTP.Sender@Gmail.com",
  GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
  EMAIL_FROM_NAME: "Basic Diet\r\nBcc: attacker@example.com",
}, () => {
  const result = assertNoTestFlagsInProduction();
  const emailViolations = (result.violations || []).filter((item) => /EMAIL_OTP|GMAIL_/.test(item));
  assert.deepStrictEqual(emailViolations, []);

  const config = getGmailConfig();
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

(async () => {
  const resolved = await resolveGmailIpv4(async (hostname) => {
    assert.strictEqual(hostname, "smtp.gmail.com");
    return ["142.250.153.108", "142.250.153.109"];
  });
  assert.strictEqual(resolved, "142.250.153.108");

  await assert.rejects(
    () => resolveGmailIpv4(async () => ["2404:6800:4003:c04::6c"]),
    (err) => err && err.code === "EDNS"
  );

  console.log("Email OTP security config tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

withEnvironment({
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
