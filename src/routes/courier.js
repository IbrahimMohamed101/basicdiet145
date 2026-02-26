const { Router } = require("express");
const controller = require("../controllers/courierController");
const orderController = require("../controllers/orderCourierController");
const { authMiddleware, roleMiddleware } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.use(authMiddleware, roleMiddleware(["courier", "admin"]));

router.get("/deliveries/today", asyncHandler(controller.listTodayDeliveries));
router.put("/deliveries/:id/arriving-soon", asyncHandler(controller.markArrivingSoon));
/**
 * @openapi
 * /courier/deliveries/{id}/delivered:
 *   put:
 *     summary: Mark delivery as delivered
 *     tags: [Courier]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *     responses:
 *       200:
 *         description: Delivered
 */
router.put("/deliveries/:id/delivered", asyncHandler(controller.markDelivered));
router.put("/deliveries/:id/cancel", asyncHandler(controller.markCancelled));

router.get("/orders/today", asyncHandler(orderController.listTodayOrders));
router.put("/orders/:id/delivered", asyncHandler(orderController.markDelivered));
router.put("/orders/:id/cancel", asyncHandler(orderController.markCancelled));

module.exports = router;
