const { Router } = require("express");
const controller = require("../controllers/dashboardAuthController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardOptionalAuthMiddleware } = require("../middleware/dashboardAuth");
const { dashboardLoginLimiter } = require("../middleware/rateLimit");

const router = Router();

router.post("/login", dashboardLoginLimiter, asyncHandler(controller.login));
router.get("/me", dashboardOptionalAuthMiddleware, asyncHandler(controller.me));
router.post("/logout", dashboardAuthMiddleware, asyncHandler(controller.logout));

module.exports = router;
