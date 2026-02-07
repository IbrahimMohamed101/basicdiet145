const { Router } = require("express");
const { requestOtp, verifyOtp, updateDeviceToken } = require("../controllers/authController");
const { authMiddleware } = require("../middleware/auth");
const { otpLimiter } = require("../middleware/rateLimit");

const router = Router();

/**
 * @openapi
 * /auth/otp/request:
 *   post:
 *     summary: Request OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP initiated on client
 */
router.post("/otp/request", otpLimiter, requestOtp);

/**
 * @openapi
 * /auth/otp/verify:
 *   post:
 *     summary: Verify OTP (Firebase ID token)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Returns JWT token
 */
router.post("/otp/verify", verifyOtp);
router.post("/device-token", authMiddleware, updateDeviceToken);

module.exports = router;
