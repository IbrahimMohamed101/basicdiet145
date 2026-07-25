"use strict";

const { Router } = require("express");
const controller = require("../controllers/dashboard/subscriptionManualDeductionController");
const auditController = require("../controllers/dashboard/subscriptionAuditController");
const subscriptionPaymentController = require("../controllers/dashboard/subscriptionPaymentRecordingController");
const adminController = require("../controllers/adminController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.get(
  "/search",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "cashier", "restaurant"]),
  asyncHandler(controller.searchByPhone)
);

router.post(
  "/quote",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "cashier", "restaurant"]),
  asyncHandler(subscriptionPaymentController.quoteSubscriptionAdmin)
);

router.post(
  "/",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "cashier", "restaurant"]),
  asyncHandler(subscriptionPaymentController.createSubscriptionAdmin)
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
  dashboardRoleMiddleware(["admin", "cashier", "restaurant"]),
  asyncHandler(adminController.getSubscriptionAddonEntitlementsAdmin)
);

router.get(
  "/:id/balances",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "cashier", "restaurant"]),
  asyncHandler(adminController.getSubscriptionBalancesAdmin)
);

router.post(
  "/:subscriptionId/manual-deduction",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "cashier", "restaurant"]),
  asyncHandler(controller.manualDeduction)
);

router.get(
  "/:subscriptionId/manual-deductions",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "cashier", "restaurant"]),
  asyncHandler(controller.listManualDeductions)
);

module.exports = router;
