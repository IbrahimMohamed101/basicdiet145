const { Router } = require("express");

const controller = require("../controllers/dashboard/orderDashboardController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin", "kitchen", "courier"]));

router.get("/", asyncHandler(controller.listOrders));
router.get("/:orderId", asyncHandler(controller.getOrder));
router.post("/:orderId/actions/:action", asyncHandler(controller.handleOrderAction));

module.exports = router;
