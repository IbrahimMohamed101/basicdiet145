const { Router } = require("express");
const controller = require("../controllers/mealIngredientController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.get("/", asyncHandler(controller.listActiveIngredients));

module.exports = router;
