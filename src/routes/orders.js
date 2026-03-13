const { Router } = require("express");
const controller = require("../controllers/orderController");
const customSaladController = require("../controllers/customSaladController");
const customMealController = require("../controllers/customMealController");
const menuController = require("../controllers/menuController");
const { authMiddleware } = require("../middleware/auth");
const { checkoutLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.get("/menu", asyncHandler(menuController.getOrderMenu));

router.use(authMiddleware);

router.post("/checkout", checkoutLimiter, asyncHandler(controller.checkoutOrder));
router.post("/:id/confirm", asyncHandler(controller.confirmOrder)); // Mock confirm — dev only
router.get("/:id/payment-status", asyncHandler(controller.getOrderPaymentStatus));
router.post("/:id/verify-payment", asyncHandler(controller.verifyOrderPayment));
router.post("/:id/reject-adjusted-date", asyncHandler(controller.rejectAdjustedDeliveryDate));
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
router.post("/:id/items/custom-salad", asyncHandler(customSaladController.addCustomSaladToOrder));
router.post("/:id/items/custom-meal", asyncHandler(customMealController.addCustomMealToOrder));
router.get("/", asyncHandler(controller.listOrders));
router.delete("/:id", asyncHandler(controller.cancelOrder));
router.get("/:id", asyncHandler(controller.getOrder));

module.exports = router;
