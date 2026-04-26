const { Router } = require("express");
const controller = require("../controllers/saladIngredientController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

/**
 * @openapi
 * /salad-ingredients:
 *   get:
 *     summary: List active salad ingredients
 *     tags: [Salad]
 *     responses:
 *       200:
 *         description: Ingredient list
 */
router.get("/", asyncHandler(controller.listActiveIngredients));

module.exports = router;
