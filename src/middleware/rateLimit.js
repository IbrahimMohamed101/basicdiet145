const rateLimit = require("express-rate-limit");
const errorResponse = require("../utils/errorResponse");

function buildRateLimitPayload(req, message) {
  const res = {
    req,
    payload: null,
    status() {
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  errorResponse(res, 429, "RATE_LIMIT", message || "errors.rateLimit.default");
  return res.payload;
}

function buildLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      return res.status(429).json(buildRateLimitPayload(req, message));
    },
  });
}

const otpLimiter = buildLimiter({
  windowMs: Number(process.env.RATE_LIMIT_OTP_WINDOW_MS) || 60 * 1000,
  max: Number(process.env.RATE_LIMIT_OTP_MAX) || 5,
  message: "errors.rateLimit.otp",
});

const otpVerifyLimiter = buildLimiter({
  windowMs: Number(process.env.RATE_LIMIT_OTP_VERIFY_WINDOW_MS) || 60 * 1000,
  max: Number(process.env.RATE_LIMIT_OTP_VERIFY_MAX) || 10,
  message: "errors.rateLimit.otpVerify",
});

const checkoutLimiter = buildLimiter({
  windowMs: Number(process.env.RATE_LIMIT_CHECKOUT_WINDOW_MS) || 5 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_CHECKOUT_MAX) || 20,
  message: "errors.rateLimit.checkout",
});

const dashboardLoginLimiter = buildLimiter({
  windowMs: Number(process.env.RATE_LIMIT_DASHBOARD_LOGIN_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_DASHBOARD_LOGIN_MAX) || 20,
  message: "errors.rateLimit.dashboardLogin",
});

module.exports = { otpLimiter, otpVerifyLimiter, checkoutLimiter, dashboardLoginLimiter, buildRateLimitPayload };
