const { Router } = require("express");
const { otpLimiter, otpVerifyLimiter } = require("../middleware/rateLimit");
const { authMiddleware } = require("../middleware/auth");
const { login, register, getProfile, updateProfile } = require("../controllers/appAuthController");
const { verifyOtp } = require("../controllers/authController");
const { listCurrentUserSubscriptions } = require("../controllers/subscriptionController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.post("/login", otpLimiter, asyncHandler(login));
router.post("/register", otpLimiter, asyncHandler(register));
router.post("/verify", otpVerifyLimiter, asyncHandler(verifyOtp));
router.get("/profile", authMiddleware, asyncHandler(getProfile));
router.put("/profile", authMiddleware, asyncHandler(updateProfile));
router.get("/subscriptions", authMiddleware, asyncHandler(listCurrentUserSubscriptions));

module.exports = router;
