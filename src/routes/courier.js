const { Router } = require("express");
const controller = require("../controllers/courierController");
const orderController = require("../controllers/orderCourierController");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

const courierReadAccess = dashboardRoleMiddleware(["courier", "admin", "restaurant"]);
const courierMutationAccess = dashboardRoleMiddleware(["courier", "admin"]);

router.use(dashboardAuthMiddleware);

router.get("/deliveries/today", courierReadAccess, asyncHandler(controller.listTodayDeliveries));
router.put("/deliveries/:id/arriving-soon", courierMutationAccess, asyncHandler(controller.markArrivingSoon));
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
router.put("/deliveries/:id/delivered", courierMutationAccess, asyncHandler(controller.markDelivered));
router.put("/deliveries/:id/cancel", courierMutationAccess, asyncHandler(controller.markCancelled));
router.put("/deliveries/:id/pickup", courierMutationAccess, asyncHandler(controller.markPickup));
router.put("/deliveries/:id/collect", courierMutationAccess, asyncHandler(controller.markCollect));

router.get("/orders/today", courierReadAccess, asyncHandler(orderController.listTodayOrders));
router.put("/orders/:id/arriving-soon", courierMutationAccess, asyncHandler(orderController.markArrivingSoon));
router.put("/orders/:id/delivered", courierMutationAccess, asyncHandler(orderController.markDelivered));
router.put("/orders/:id/cancel", courierMutationAccess, asyncHandler(orderController.markCancelled));

module.exports = router;
