const { Router } = require("express");
const controller = require("../controllers/builderPremiumMealController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.get("/", asyncHandler(controller.listBuilderPremiumMeals));

module.exports = router;
