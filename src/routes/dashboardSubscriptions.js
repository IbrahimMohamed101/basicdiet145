"use strict";

const { Router } = require("express");
const controller = require("../controllers/dashboard/subscriptionManualDeductionController");
const auditController = require("../controllers/dashboard/subscriptionAuditController");
const subscriptionPaymentController = require("../controllers/dashboard/subscriptionPaymentRecordingController");
const subscriptionTrackingController = require("../controllers/subscriptionTrackingController");
const adminController = require("../controllers/adminController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();
const subscriptionStaffAccess = dashboardRoleMiddleware([
  "admin",
  "cashier",
  "restaurant",
  "kitchen",
]);
const subscriptionTrackingReadAccess = dashboardRoleMiddleware([
  "admin",
  "cashier",
]);
const manualDeductionWriteAccess = dashboardRoleMiddleware([
  "admin",
  "cashier",
  "restaurant",
]);

router.get(
  "/search",
  dashboardAuthMiddleware,
  subscriptionStaffAccess,
  asyncHandler(controller.searchByPhone)
);

router.post(
  "/quote",
  dashboardAuthMiddleware,
  subscriptionStaffAccess,
  asyncHandler(subscriptionPaymentController.quoteSubscriptionAdmin)
);

router.post(
  "/",
  dashboardAuthMiddleware,
  subscriptionStaffAccess,
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
  "/:id/tracking",
  dashboardAuthMiddleware,
  subscriptionTrackingReadAccess,
  asyncHandler(subscriptionTrackingController.getSubscriptionTrackingAdmin)
);

router.get(
  "/:id/addon-entitlements",
  dashboardAuthMiddleware,
  subscriptionStaffAccess,
  asyncHandler(adminController.getSubscriptionAddonEntitlementsAdmin)
);

router.get(
  "/:id/balances",
  dashboardAuthMiddleware,
  subscriptionStaffAccess,
  asyncHandler(adminController.getSubscriptionBalancesAdmin)
);

router.post(
  "/:subscriptionId/manual-deduction",
  dashboardAuthMiddleware,
  manualDeductionWriteAccess,
  asyncHandler(controller.manualDeduction)
);

router.get(
  "/:subscriptionId/manual-deductions",
  dashboardAuthMiddleware,
  subscriptionStaffAccess,
  asyncHandler(controller.listManualDeductions)
);

module.exports = router;
