const { Router } = require("express");
const asyncHandler = require("../middleware/asyncHandler");
const optionalAuthMiddleware = require("../middleware/optionalAuth");
const controller = require("../controllers/subscriptionMealPlannerV4Controller");

const router = Router();

router.get("/meal-planner-menu", optionalAuthMiddleware, asyncHandler(controller.getMealPlannerMenu));
router.get("/meal-builder", optionalAuthMiddleware, asyncHandler(controller.getMealPlannerMenu));

module.exports = router;
