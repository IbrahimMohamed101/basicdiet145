"use strict";

const { Router } = require("express");
const controller = require("../controllers/dashboard/subscriptionManualDeductionController");
const auditController = require("../controllers/dashboard/subscriptionAuditController");
const subscriptionPaymentController = require("../controllers/dashboard/subscriptionPaymentRecordingController");
const adminController = require("../controllers/adminController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();
const subscriptionReadAccess = dashboardRoleMiddleware([
  "admin",
  "cashier",
  "restaurant",
  "kitchen",
]);
const subscriptionWriteAccess = dashboardRoleMiddleware([
  "admin",
  "cashier",
  "restaurant",
]);

router.get(
  "/search",
  dashboardAuthMiddleware,
  subscriptionReadAccess,
  asyncHandler(controller.searchByPhone)
);

router.post(
  "/quote",
  dashboardAuthMiddleware,
  subscriptionWriteAccess,
  asyncHandler(subscriptionPaymentController.quoteSubscriptionAdmin)
);

router.post(
  "/",
  dashboardAuthMiddleware,
  subscriptionWriteAccess,
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
  subscriptionReadAccess,
  asyncHandler(adminController.getSubscriptionAddonEntitlementsAdmin)
);

router.get(
  "/:id/balances",
  dashboardAuthMiddleware,
  subscriptionReadAccess,
  asyncHandler(adminController.getSubscriptionBalancesAdmin)
);

router.post(
  "/:subscriptionId/manual-deduction",
  dashboardAuthMiddleware,
  subscriptionWriteAccess,
  asyncHandler(controller.manualDeduction)
);

router.get(
  "/:subscriptionId/manual-deductions",
  dashboardAuthMiddleware,
  subscriptionReadAccess,
  asyncHandler(controller.listManualDeductions)
);

module.exports = router;
