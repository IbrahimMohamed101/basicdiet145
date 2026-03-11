const { Router } = require("express");
const { otpLimiter } = require("../middleware/rateLimit");
const { authMiddleware } = require("../middleware/auth");
const { login, register, getProfile, updateProfile } = require("../controllers/appAuthController");
const { listCurrentUserSubscriptions } = require("../controllers/subscriptionController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.post("/login", otpLimiter, asyncHandler(login));
router.post("/register", authMiddleware, asyncHandler(register));
router.get("/profile", authMiddleware, asyncHandler(getProfile));
router.put("/profile", authMiddleware, asyncHandler(updateProfile));
router.get("/subscriptions", authMiddleware, asyncHandler(listCurrentUserSubscriptions));

module.exports = router;
