const { Router } = require("express");
const { otpLimiter, otpVerifyLimiter } = require("../middleware/rateLimit");
const { authMiddleware } = require("../middleware/auth");
const { login, register, guest, getProfile, updateProfile, getTodayPickup } = require("../controllers/appAuthController");
const { verifyOtp } = require("../controllers/authController");
const { listCurrentUserSubscriptions } = require("../controllers/subscriptionController");
const { getAppConfig } = require("../controllers/settingsController");
const { accountDeletionLimiter } = require("../middleware/rateLimit");
const { requestAccountDeletion } = require("../controllers/accountDeletionController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.post("/login", otpLimiter, asyncHandler(login));
router.post("/register", otpLimiter, asyncHandler(register));
router.post("/guest", otpLimiter, asyncHandler(guest));
router.post("/verify", otpVerifyLimiter, asyncHandler(verifyOtp));
router.get("/config", asyncHandler(getAppConfig));
router.get("/profile", authMiddleware, asyncHandler(getProfile));
router.put("/profile", authMiddleware, asyncHandler(updateProfile));
router.get("/subscriptions", authMiddleware, asyncHandler(listCurrentUserSubscriptions));
router.get("/today-pickup", authMiddleware, asyncHandler(getTodayPickup));
router.post("/account-deletion/request", accountDeletionLimiter, authMiddleware, asyncHandler(requestAccountDeletion));

module.exports = router;
