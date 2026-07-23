"use strict";

const { Router } = require("express");
const controller = require("../controllers/dashboard/subscriptionManualDeductionController");
const auditController = require("../controllers/dashboard/subscriptionAuditController");
const subscriptionCreationController = require("../controllers/dashboard/subscriptionCreationController");
const adminController = require("../controllers/adminController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.get(
  "/search",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "cashier"]),
  asyncHandler(controller.searchByPhone)
);

// Subscription creation remains admin/cashier only. The restaurant role can
// inspect balances and deduct fulfilled branch consumption, but cannot sell or
// create a new subscription through a hidden/direct API call.
router.post(
  "/quote",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "cashier"]),
  asyncHandler(subscriptionCreationController.quoteSubscriptionAdmin)
);

router.post(
  "/",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "cashier"]),
  asyncHandler(subscriptionCreationController.createSubscriptionAdmin)
);

router.get(
  "/:subscriptionId/audit",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin"]),
  asyncHandler(auditController.getSubscriptionAudit)
);

router.get(
  "/:subscriptionId/lifecycle",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin"]),
  asyncHandler(auditController.getSubscriptionLifecycle)
);

router.get(
  "/:id/addon-entitlements",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "cashier"]),
  asyncHandler(adminController.getSubscriptionAddonEntitlementsAdmin)
);

router.get(
  "/:id/balances",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "cashier"]),
  asyncHandler(adminController.getSubscriptionBalancesAdmin)
);

router.post(
  "/:subscriptionId/manual-deduction",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "cashier"]),
  asyncHandler(controller.manualDeduction)
);

router.get(
  "/:subscriptionId/manual-deductions",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "cashier"]),
  asyncHandler(controller.listManualDeductions)
);

module.exports = router;
