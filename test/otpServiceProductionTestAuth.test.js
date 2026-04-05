const test = require("node:test");
const assert = require("node:assert/strict");

const { logger } = require("../src/utils/logger");
const Otp = require("../src/models/Otp");
const { verifyOtpCode } = require("../src/services/otpService");

async function withEnv(overrides, fn) {
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
    return await fn();
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

test("verifyOtpCode accepts the configured staging test OTP without an OTP record", async () => {
  const originalFindOne = Otp.findOne;
  const originalWarn = logger.warn;
  const warnCalls = [];

  Otp.findOne = async () => null;
  logger.warn = (...args) => {
    warnCalls.push(args);
  };

  try {
    await withEnv(
      {
        NODE_ENV: "production",
        OTP_TEST_MODE: "true",
        ALLOW_TEST_AUTH: "true",
        ALLOW_STAGING_TEST_AUTH: "true",
        OTP_TEST_PHONE: "+201000000000",
        OTP_TEST_CODE: "123456",
      },
      async () => {
        const result = await verifyOtpCode({
          phoneE164: "+201000000000",
          otp: "123456",
        });

        assert.equal(result.phone, "+201000000000");
        assert.equal(result.context, "generic");
        assert.equal(result.pendingProfile, null);
        assert.equal(warnCalls[0][0], "⚠️ TEST OTP MODE ACTIVE (STAGING ONLY)");
      }
    );
  } finally {
    Otp.findOne = originalFindOne;
    logger.warn = originalWarn;
  }
});

test("verifyOtpCode accepts the configured staging test OTP even when a stale OTP record exists", async () => {
  const originalFindOne = Otp.findOne;
  const originalDeleteOne = Otp.deleteOne;

  let deletedId = null;
  Otp.findOne = async () => ({
    _id: "otp-1",
    codeHash: "stale-hash",
    expiresAt: new Date(Date.now() + 60 * 1000),
    attemptsLeft: 5,
    context: "app_register",
    pendingProfile: {
      fullName: "Test User",
      email: "test@example.com",
    },
  });
  Otp.deleteOne = async ({ _id }) => {
    deletedId = _id;
  };

  try {
    await withEnv(
      {
        NODE_ENV: "production",
        OTP_TEST_MODE: "true",
        ALLOW_TEST_AUTH: "true",
        ALLOW_STAGING_TEST_AUTH: "true",
        OTP_TEST_PHONE: "+201000000000",
        OTP_TEST_CODE: "123456",
      },
      async () => {
        const result = await verifyOtpCode({
          phoneE164: "+201000000000",
          otp: "123456",
        });

        assert.equal(result.phone, "+201000000000");
        assert.equal(result.context, "app_register");
        assert.deepEqual(result.pendingProfile, {
          fullName: "Test User",
          email: "test@example.com",
        });
        assert.equal(deletedId, "otp-1");
      }
    );
  } finally {
    Otp.findOne = originalFindOne;
    Otp.deleteOne = originalDeleteOne;
  }
});

test("verifyOtpCode rejects the staging test OTP for any phone other than OTP_TEST_PHONE", async () => {
  const originalFindOne = Otp.findOne;

  Otp.findOne = async () => null;

  try {
    await withEnv(
      {
        NODE_ENV: "production",
        OTP_TEST_MODE: "true",
        ALLOW_TEST_AUTH: "true",
        ALLOW_STAGING_TEST_AUTH: "true",
        OTP_TEST_PHONE: "+201000000000",
        OTP_TEST_CODE: "123456",
      },
      async () => {
        await assert.rejects(
          () => verifyOtpCode({
            phoneE164: "+201000000001",
            otp: "123456",
          }),
          (error) => error && error.code === "OTP_NOT_FOUND"
        );
      }
    );
  } finally {
    Otp.findOne = originalFindOne;
  }
});
