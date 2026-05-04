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
  dashboardRoleMiddleware(["admin", "kitchen", "courier"]),
  asyncHandler(controller.listOperations)
);

router.get(
  "/search",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "kitchen", "courier"]),
  asyncHandler(controller.searchOperations)
);

// Phase 2: Action commands
router.post(
  "/actions/:action",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "kitchen", "courier"]),
  asyncHandler(actionController.handleAction)
);

// Phase 5: Cashier Flow
router.get(
  "/cashier/customer-lookup",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "kitchen", "cashier"]),
  asyncHandler(cashierController.customerLookup)
);

router.post(
  "/cashier/customer-consumption",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "kitchen", "cashier"]),
  asyncHandler(cashierController.customerConsumption)
);

module.exports = router;
