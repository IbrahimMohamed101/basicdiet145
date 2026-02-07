const rateLimit = require("express-rate-limit");

function buildLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: message || {
      ok: false,
      error: { code: "RATE_LIMIT", message: "Too many requests" },
    },
  });
}

const otpLimiter = buildLimiter({
  windowMs: Number(process.env.RATE_LIMIT_OTP_WINDOW_MS) || 60 * 1000,
  max: Number(process.env.RATE_LIMIT_OTP_MAX) || 5,
  message: { ok: false, error: { code: "RATE_LIMIT", message: "Too many OTP requests" } },
});

const checkoutLimiter = buildLimiter({
  windowMs: Number(process.env.RATE_LIMIT_CHECKOUT_WINDOW_MS) || 5 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_CHECKOUT_MAX) || 20,
  message: { ok: false, error: { code: "RATE_LIMIT", message: "Too many checkout attempts" } },
});

module.exports = { otpLimiter, checkoutLimiter };
