const { Router } = require("express");
const controller = require("../controllers/saladIngredientController");

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
router.get("/", controller.listActiveIngredients);

module.exports = router;
