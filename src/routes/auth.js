const { Router } = require("express");
const { requestOtp, verifyOtp, updateDeviceToken, deleteDeviceToken } = require("../controllers/authController");
const { authMiddleware } = require("../middleware/auth");
const { otpLimiter, otpVerifyLimiter } = require("../middleware/rateLimit");
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
router.post("/device-token", authMiddleware, asyncHandler(updateDeviceToken));
router.delete("/device-token", authMiddleware, asyncHandler(deleteDeviceToken));

module.exports = router;
