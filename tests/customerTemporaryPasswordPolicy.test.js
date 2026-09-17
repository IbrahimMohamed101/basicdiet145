"use strict";

const assert = require("assert");
const User = require("../src/models/User");
const { validateAppPassword } = require("../src/services/appPasswordService");
const {
  generateTemporaryPassword,
  validateTemporaryPassword,
  getTemporaryPasswordExpiresAt,
  resolveTemporaryPasswordTtlHours,
} = require("../src/services/customerTemporaryPasswordService");

const originalTtl = process.env.ADMIN_TEMP_PASSWORD_TTL_HOURS;

function restoreEnv() {
  if (originalTtl === undefined) {
    delete process.env.ADMIN_TEMP_PASSWORD_TTL_HOURS;
  } else {
    process.env.ADMIN_TEMP_PASSWORD_TTL_HOURS = originalTtl;
  }
}

try {
  assert.deepStrictEqual(
    validateTemporaryPassword("12345678"),
    { ok: true },
    "an eight-digit admin-issued temporary PIN must be accepted"
  );
  assert.strictEqual(
    validateTemporaryPassword("1234567").ok,
    false,
    "temporary passwords shorter than eight characters must be rejected"
  );
  assert.strictEqual(
    validateTemporaryPassword("1234 5678").ok,
    false,
    "temporary passwords containing whitespace must be rejected"
  );
  assert.strictEqual(
    validateTemporaryPassword("a".repeat(73)).ok,
    false,
    "temporary passwords beyond bcrypt's safe byte limit must be rejected"
  );
  assert.strictEqual(
    validateAppPassword("12345678").ok,
    false,
    "numeric-only passwords must remain forbidden for permanent customer credentials"
  );

  const generated = generateTemporaryPassword();
  assert(generated.length >= 8, "generated temporary passwords must be at least eight characters");
  assert(/[A-Z]/.test(generated), "generated temporary passwords must include uppercase");
  assert(/[a-z]/.test(generated), "generated temporary passwords must include lowercase");
  assert(/\d/.test(generated), "generated temporary passwords must include a digit");

  delete process.env.ADMIN_TEMP_PASSWORD_TTL_HOURS;
  assert.strictEqual(resolveTemporaryPasswordTtlHours(), 720, "default TTL must be 30 days");

  process.env.ADMIN_TEMP_PASSWORD_TTL_HOURS = "24";
  assert.strictEqual(
    resolveTemporaryPasswordTtlHours(),
    720,
    "legacy 24-hour production configuration must be clamped to 30 days"
  );

  process.env.ADMIN_TEMP_PASSWORD_TTL_HOURS = "1440";
  assert.strictEqual(resolveTemporaryPasswordTtlHours(), 1440, "longer configured TTL should be preserved");

  process.env.ADMIN_TEMP_PASSWORD_TTL_HOURS = "999999";
  assert.strictEqual(resolveTemporaryPasswordTtlHours(), 8760, "TTL must remain bounded to one year");

  process.env.ADMIN_TEMP_PASSWORD_TTL_HOURS = "not-a-number";
  assert.strictEqual(resolveTemporaryPasswordTtlHours(), 720, "invalid TTL must fall back to 30 days");

  delete process.env.ADMIN_TEMP_PASSWORD_TTL_HOURS;
  const issuedAt = new Date("2026-07-22T18:31:00.000Z");
  const expiresAt = getTemporaryPasswordExpiresAt(issuedAt);
  assert.strictEqual(
    expiresAt.getTime() - issuedAt.getTime(),
    30 * 24 * 60 * 60 * 1000,
    "temporary credentials must stay valid for exactly 30 days by default"
  );

  const legacyUser = new User({
    phone: "+966555000001",
    phoneE164: "+966555000001",
    role: "client",
    forcePasswordChange: true,
    temporaryPasswordIssuedAt: issuedAt,
    temporaryPasswordExpiresAt: new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000),
  });
  const effectiveLegacyExpiry = legacyUser.temporaryPasswordExpiresAt;
  assert.strictEqual(
    effectiveLegacyExpiry.getTime() - issuedAt.getTime(),
    30 * 24 * 60 * 60 * 1000,
    "previously issued 24-hour credentials must be treated as valid for 30 days"
  );
  assert.strictEqual(
    legacyUser.toObject().temporaryPasswordExpiresAt.getTime(),
    effectiveLegacyExpiry.getTime(),
    "dashboard serialization must expose the same effective expiry used by authentication"
  );

  console.log("customer temporary password policy checks passed");
} finally {
  restoreEnv();
}
