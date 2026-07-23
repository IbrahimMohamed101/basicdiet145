const { Router } = require("express");
const controller = require("../controllers/dashboard/opsController");
const actionController = require("../controllers/dashboard/opsActionController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const cashierController = require("../controllers/dashboard/cashierController");

const router = Router();

// Phase 1 & 2: Read access
router.get(
  "/list",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "kitchen", "cashier", "courier"]),
  asyncHandler(controller.listOperations)
);

router.get(
  "/search",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "kitchen", "cashier", "courier"]),
  asyncHandler(controller.searchOperations)
);

// Phase 2: Action commands
router.post(
  "/actions/:action",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "kitchen", "cashier", "courier"]),
  asyncHandler(actionController.handleAction)
);

router.put(
  "/subscription-days/:id/ready-for-delivery",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "kitchen", "cashier", "courier"]),
  asyncHandler(actionController.readyForDelivery)
);

// Phase 5: Cashier Flow. Restaurant is the unified branch role and may use
// lookup/consumption, while subscription creation stays restricted elsewhere.
router.get(
  "/cashier/customer-lookup",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "cashier"]),
  asyncHandler(cashierController.customerLookup)
);

router.post(
  "/cashier/customer-consumption",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "cashier"]),
  asyncHandler(cashierController.customerConsumption)
);

module.exports = router;
