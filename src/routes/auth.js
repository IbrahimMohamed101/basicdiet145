const { Router } = require("express");
const {
  requestOtp,
  requestRegisterOtp,
  verifyOtp,
  register,
  verifyRegister,
  login,
  guest,
  refresh,
  me,
  logout,
  logoutAll,
  forgotPassword,
  resetPassword,
  changePassword,
  updateDeviceToken,
  deleteDeviceToken,
} = require("../controllers/authController");
const { authMiddleware } = require("../middleware/auth");
const { otpLimiter, otpVerifyLimiter, mobileLoginLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

/**
 * @openapi
 * /auth/otp/request:
 *   post:
 *     summary: Request WhatsApp OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phoneE164:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent via Twilio WhatsApp
 */
router.post("/otp/request", otpLimiter, asyncHandler(requestOtp));

/**
 * @openapi
 * /auth/otp/verify:
 *   post:
 *     summary: Verify WhatsApp OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phoneE164:
 *                 type: string
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: Returns JWT token
 */
router.post("/otp/verify", otpVerifyLimiter, asyncHandler(verifyOtp));
router.post("/register/request-otp", otpLimiter, asyncHandler(requestRegisterOtp));
router.post("/register/verify", otpVerifyLimiter, asyncHandler(verifyRegister));
router.post("/register", mobileLoginLimiter, asyncHandler(register));
router.post("/login", mobileLoginLimiter, asyncHandler(login));
router.post("/guest", mobileLoginLimiter, asyncHandler(guest));
router.post("/refresh", asyncHandler(refresh));
router.get("/me", authMiddleware, asyncHandler(me));
router.post("/logout", authMiddleware, asyncHandler(logout));
router.post("/logout-all", authMiddleware, asyncHandler(logoutAll));
router.post("/password/forgot", otpLimiter, asyncHandler(forgotPassword));
router.post("/password/reset", otpVerifyLimiter, asyncHandler(resetPassword));
router.post("/change-password", authMiddleware, asyncHandler(changePassword));
router.post("/device-token", authMiddleware, asyncHandler(updateDeviceToken));
router.delete("/device-token", authMiddleware, asyncHandler(deleteDeviceToken));

module.exports = router;
