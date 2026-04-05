const test = require("node:test");
const assert = require("node:assert/strict");

const security = require("../src/utils/security");

function withEnv(overrides, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("legacy TEST_OTP_* env flags still enable dev OTP bypass", () => {
  withEnv(
    {
      NODE_ENV: "development",
      OTP_TEST_MODE: undefined,
      ALLOW_TEST_AUTH: undefined,
      OTP_TEST_CODE: undefined,
      OTP_TEST_PHONE: undefined,
      TEST_OTP_BYPASS: "true",
      TEST_OTP_CODE: "123456",
      TEST_OTP_PHONE: "+201000000000",
    },
    () => {
      assert.equal(security.isTestAuthEnabled(), true);
      assert.equal(security.getTestOtpCode(), "123456");
      assert.equal(security.getTestOtpPhone(), "+201000000000");
    }
  );
});

test("unified OTP test envs take precedence over legacy values", () => {
  withEnv(
    {
      NODE_ENV: "development",
      OTP_TEST_MODE: "true",
      ALLOW_TEST_AUTH: "true",
      OTP_TEST_CODE: "654321",
      OTP_TEST_PHONE: "+201111111111",
      TEST_OTP_BYPASS: "true",
      TEST_OTP_CODE: "123456",
      TEST_OTP_PHONE: "+201000000000",
    },
    () => {
      assert.equal(security.isTestAuthEnabled(), true);
      assert.equal(security.getTestOtpCode(), "654321");
      assert.equal(security.getTestOtpPhone(), "+201111111111");
    }
  );
});
