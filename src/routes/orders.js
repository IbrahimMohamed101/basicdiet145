const { Router } = require("express");
const controller = require("../controllers/orderController");
const customSaladController = require("../controllers/customSaladController");
const { authMiddleware } = require("../middleware/auth");
const { checkoutLimiter } = require("../middleware/rateLimit");

const router = Router();

router.use(authMiddleware);

router.post("/checkout", checkoutLimiter, controller.checkoutOrder);
router.post("/:id/confirm", controller.confirmOrder); // Mock payment confirmation
/**
 * @openapi
 * /orders/{id}/items/custom-salad:
 *   post:
 *     summary: Add custom salad to an order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
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
 *         description: Custom salad added
 */
router.post("/:id/items/custom-salad", customSaladController.addCustomSaladToOrder);
router.get("/", controller.listOrders);
router.get("/:id", controller.getOrder);

module.exports = router;
