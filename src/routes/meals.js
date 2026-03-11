const { Router } = require("express");
const controller = require("../controllers/mealController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.get("/", asyncHandler(controller.listMeals));

module.exports = router;
