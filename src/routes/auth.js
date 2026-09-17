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
  completePasswordChange,
  updateDeviceToken,
  deleteDeviceToken,
} = require("../controllers/authController");
const {
  confirmExistingEmailVerification,
  requestEmailPasswordReset,
  requestExistingEmailVerification,
  resetPasswordWithEmail,
  startEmailRegistration,
  verifyEmailPasswordReset,
  verifyEmailRegistration,
} = require("../controllers/emailAuthController");
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
// Email-auth v2 is additive and default-off. Existing mobile builds continue to
// use the legacy registration/password endpoints unchanged.
router.post("/email/register/start", otpLimiter, asyncHandler(startEmailRegistration));
router.post("/email/register/verify", otpVerifyLimiter, asyncHandler(verifyEmailRegistration));
router.post(
  "/email/verification/request",
  authMiddleware,
  otpLimiter,
  asyncHandler(requestExistingEmailVerification)
);
router.post(
  "/email/verification/confirm",
  authMiddleware,
  otpVerifyLimiter,
  asyncHandler(confirmExistingEmailVerification)
);
/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Password login
 *     tags: [Auth]
 *     description: Returns normal app tokens for permanent-password users, or a short-lived passwordChangeToken when a temporary admin-issued password must be changed.
 *     responses:
 *       200:
 *         description: Logged in or password_change_required
 *       401:
 *         description: INVALID_CREDENTIALS
 *       403:
 *         description: TEMPORARY_PASSWORD_EXPIRED or FORBIDDEN
 */
router.post("/login", mobileLoginLimiter, asyncHandler(login));
router.post("/guest", mobileLoginLimiter, asyncHandler(guest));
router.post("/refresh", asyncHandler(refresh));
router.get("/me", authMiddleware, asyncHandler(me));
router.post("/logout", authMiddleware, asyncHandler(logout));
router.post("/logout-all", authMiddleware, asyncHandler(logoutAll));
router.post("/password/forgot", otpLimiter, asyncHandler(forgotPassword));
router.post("/password/reset", otpVerifyLimiter, asyncHandler(resetPassword));
router.post("/password/email/request", otpLimiter, asyncHandler(requestEmailPasswordReset));
router.post("/password/email/verify", otpVerifyLimiter, asyncHandler(verifyEmailPasswordReset));
router.post("/password/email/reset", mobileLoginLimiter, asyncHandler(resetPasswordWithEmail));
/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     summary: Change an authenticated permanent password
 *     tags: [Auth]
 *     description: For already-authenticated customers. Forced-change users receive PASSWORD_CHANGE_REQUIRED and must use complete-password-change.
 *     responses:
 *       200:
 *         description: Password changed; old sessions are revoked and the client should log in again.
 *       400:
 *         description: WEAK_PASSWORD or PASSWORD_CONFIRMATION_MISMATCH
 *       403:
 *         description: PASSWORD_CHANGE_REQUIRED
 */
router.post("/change-password", authMiddleware, asyncHandler(changePassword));
/**
 * @openapi
 * /auth/complete-password-change:
 *   post:
 *     summary: Complete mandatory password change
 *     tags: [Auth]
 *     description: Accepts only a customer_password_change bearer token from temporary-password login and returns normal app tokens after setting a permanent password.
 *     responses:
 *       200:
 *         description: password_changed
 *       400:
 *         description: WEAK_PASSWORD, PASSWORD_CONFIRMATION_MISMATCH, or PASSWORD_REUSE_FORBIDDEN
 *       401:
 *         description: INVALID_PASSWORD_CHANGE_TOKEN
 *       403:
 *         description: TEMPORARY_PASSWORD_EXPIRED or FORBIDDEN
 *       409:
 *         description: PASSWORD_CHANGE_ALREADY_COMPLETED
 */
router.post("/complete-password-change", mobileLoginLimiter, asyncHandler(completePasswordChange));
router.post("/device-token", authMiddleware, asyncHandler(updateDeviceToken));
router.delete("/device-token", authMiddleware, asyncHandler(deleteDeviceToken));

module.exports = router;
