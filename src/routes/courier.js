const { Router } = require("express");
const controller = require("../controllers/courierController");
const orderController = require("../controllers/orderCourierController");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["courier", "admin"]));

router.get("/deliveries/today", controller.listTodayDeliveries);
router.put("/deliveries/:id/arriving-soon", controller.markArrivingSoon);
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
router.put("/deliveries/:id/delivered", controller.markDelivered);
router.put("/deliveries/:id/cancel", controller.markCancelled);

router.get("/orders/today", orderController.listTodayOrders);
router.put("/orders/:id/delivered", orderController.markDelivered);
router.put("/orders/:id/cancel", orderController.markCancelled);

module.exports = router;
