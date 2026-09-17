const { Router } = require("express");
const controller = require("../controllers/courierController");
const deliveryListController = require("../controllers/courierDeliveryListController");
const deliveryFulfillmentController = require("../controllers/courierDeliveryFulfillmentController");
const orderController = require("../controllers/orderCourierController");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

const courierReadAccess = dashboardRoleMiddleware(["courier", "admin", "restaurant"]);
const courierMutationAccess = dashboardRoleMiddleware(["courier", "admin"]);

function makeCourierRowReadOnly(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  return {
    ...row,
    canCourierPickup: false,
    canMarkArrivingSoon: false,
    canMarkDelivered: false,
    canCancel: false,
    allowedActions: [],
    allowedActionIds: [],
  };
}

function restaurantCourierReadOnlyResponse(req, res, next) {
  if (req.dashboardUserRole !== "restaurant") return next();

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) {
      return originalJson(payload);
    }
    return originalJson({
      ...payload,
      data: payload.data.map(makeCourierRowReadOnly),
      meta: {
        ...(payload.meta && typeof payload.meta === "object" ? payload.meta : {}),
        readOnly: true,
        role: "restaurant",
      },
    });
  };

  return next();
}

router.use(dashboardAuthMiddleware);

router.get(
  "/deliveries/today",
  courierReadAccess,
  restaurantCourierReadOnlyResponse,
  asyncHandler(deliveryListController.listDeliveries)
);
router.put("/deliveries/:id/arriving-soon", courierMutationAccess, asyncHandler(controller.markArrivingSoon));
/**
 * @openapi
 * /courier/deliveries/{id}/delivered:
 *   put:
 *     summary: Mark delivery as delivered and fulfill its subscription day
 *     tags: [Courier]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *     responses:
 *       200:
 *         description: Delivered and subscription fulfillment settled
 */
router.put(
  "/deliveries/:id/delivered",
  courierMutationAccess,
  asyncHandler(deliveryFulfillmentController.markDelivered)
);
router.put("/deliveries/:id/cancel", courierMutationAccess, asyncHandler(controller.markCancelled));
router.put("/deliveries/:id/pickup", courierMutationAccess, asyncHandler(controller.markPickup));
router.put("/deliveries/:id/collect", courierMutationAccess, asyncHandler(controller.markCollect));

router.get(
  "/orders/today",
  courierReadAccess,
  restaurantCourierReadOnlyResponse,
  asyncHandler(orderController.listTodayOrders)
);
router.put("/orders/:id/arriving-soon", courierMutationAccess, asyncHandler(orderController.markArrivingSoon));
router.put("/orders/:id/delivered", courierMutationAccess, asyncHandler(orderController.markDelivered));
router.put("/orders/:id/cancel", courierMutationAccess, asyncHandler(orderController.markCancelled));

module.exports = router;
