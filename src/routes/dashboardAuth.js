const { Router } = require("express");
const controller = require("../controllers/dashboardAuthController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware } = require("../middleware/dashboardAuth");
const { dashboardLoginLimiter } = require("../middleware/rateLimit");

const router = Router();

router.post("/login", dashboardLoginLimiter, asyncHandler(controller.login));
router.get("/me", dashboardAuthMiddleware, asyncHandler(controller.me));
router.post("/logout", dashboardAuthMiddleware, asyncHandler(controller.logout));

module.exports = router;
