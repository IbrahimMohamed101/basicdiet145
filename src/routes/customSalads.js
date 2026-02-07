const { Router } = require("express");
const controller = require("../controllers/customSaladController");
const { authMiddleware } = require("../middleware/auth");

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /custom-salads/price:
 *   post:
 *     summary: Preview custom salad price
 *     tags: [Salad]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ingredients:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     ingredientId:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Price snapshot
 */
router.post("/price", controller.previewCustomSaladPrice);

module.exports = router;
