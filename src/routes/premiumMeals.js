const { Router } = require("express");
const controller = require("../controllers/premiumMealController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.get("/", asyncHandler(controller.listPremiumMeals));

module.exports = router;
