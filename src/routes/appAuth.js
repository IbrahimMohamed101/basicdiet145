const { Router } = require("express");
const { otpLimiter } = require("../middleware/rateLimit");
const { authMiddleware } = require("../middleware/auth");
const { login, register } = require("../controllers/appAuthController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.post("/login", otpLimiter, asyncHandler(login));
router.post("/register", authMiddleware, asyncHandler(register));

module.exports = router;
