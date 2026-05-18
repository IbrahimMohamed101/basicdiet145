"use strict";

const assert = require("assert");
const { sanitizeLogData, validateRedirectUrl } = require("../src/utils/security");
const { validateDashboardPassword } = require("../src/services/dashboardPasswordService");

function testSanitizeKeys() {
  const data = {
    phone: "1234567890",
    phoneE164: "+1234567890",
    email: "test@example.com",
    otpCode: "1234",
    password: "StrongPassword123!",
    safeValue: "safe",
  };
  const sanitized = sanitizeLogData(data);
  const REDACTED = "[REDACTED]";
  assert.strictEqual(sanitized.phone, REDACTED);
  assert.strictEqual(sanitized.phoneE164, REDACTED);
  assert.strictEqual(sanitized.email, REDACTED);
  assert.strictEqual(sanitized.otpCode, REDACTED);
  assert.strictEqual(sanitized.password, REDACTED);
  assert.strictEqual(sanitized.safeValue, "safe");
  console.log("✅ testSanitizeKeys passed");
}

function testDashboardPasswordPolicy() {
  const weakPasswords = [
    "short1!",
    "no_uppercase_1!",
    "NO_LOWERCASE_1!",
    "NoNumber!",
    "NoSymbol1234",
    "change_me", // in WEAK_DEFAULT_PASSWORDS
    "cashier123"
  ];
  for (const pw of weakPasswords) {
    const res = validateDashboardPassword(pw);
    if (res.ok) {
      throw new Error(`Expected weak password to be rejected: ${pw}`);
    }
  }

  const strongPassword = "StrongerPassword123!";
  const res = validateDashboardPassword(strongPassword);
  assert.strictEqual(res.ok, true, `Expected strong password to pass: ${strongPassword}`);
  console.log("✅ testDashboardPasswordPolicy passed");
}

function testRedirectAllowlist() {
  const originalEnv = process.env.PAYMENT_REDIRECT_ALLOWED_ORIGINS;
  const originalNodeEnv = process.env.NODE_ENV;
  
  try {
    process.env.PAYMENT_REDIRECT_ALLOWED_ORIGINS = "https://app.example.com,https://dashboard.example.com,https://fallback.example.com";
    process.env.NODE_ENV = "production";

    assert.strictEqual(
      validateRedirectUrl("https://app.example.com/payment/success", "https://fallback.example.com/"), 
      "https://app.example.com/payment/success"
    );
    assert.strictEqual(
      validateRedirectUrl("https://malicious.example.com/payment/success", "https://fallback.example.com/"), 
      "https://fallback.example.com/"
    );
    console.log("✅ testRedirectAllowlist passed");
  } finally {
    process.env.PAYMENT_REDIRECT_ALLOWED_ORIGINS = originalEnv;
    process.env.NODE_ENV = originalNodeEnv;
  }
}

try {
  testSanitizeKeys();
  testDashboardPasswordPolicy();
  testRedirectAllowlist();
  console.log("All security hardening unit tests passed!");
} catch (e) {
  console.error("❌ Test failed:", e.message);
  process.exit(1);
}
