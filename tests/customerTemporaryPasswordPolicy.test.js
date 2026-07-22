"use strict";

const assert = require("assert");
const {
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

  console.log("customer temporary password policy checks passed");
} finally {
  restoreEnv();
}
