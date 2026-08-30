"use strict";

// Install the additive dashboard-create adapter before any dashboard controller
// captures subscription activation exports.
require("../services/installDashboardSubscriptionStackingFlow");
require("../services/installDashboardSubscriptionPromoFlow");

const { Router } = require("express");
const controller = require("../controllers/dashboard/subscriptionManualDeductionController");
const quickDayDeductionController = require("../controllers/dashboard/subscriptionQuickDayDeductionController");
const fulfillmentListController = require("../controllers/dashboard/subscriptionFulfillmentListController");
const auditController = require("../controllers/dashboard/subscriptionAuditController");
const subscriptionPaymentController = require("../controllers/dashboard/subscriptionPaymentRecordingController");
const subscriptionInvoiceController = require("../controllers/dashboard/subscriptionInvoiceController");
const financialControlController = require("../controllers/dashboardSubscriptionFinancialControlController");
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
const invoiceReadAccess = dashboardRoleMiddleware([
  "admin",
  "cashier",
]);
const manualDeductionWriteAccess = dashboardRoleMiddleware([
  "admin",
  "cashier",
  "restaurant",
]);
const quickDayDeductionWriteAccess = dashboardRoleMiddleware([
  "admin",
  "cashier",
]);
const superadminFinancialControlAccess = dashboardRoleMiddleware(["superadmin"]);

router.get(
  "/list",
  dashboardAuthMiddleware,
  subscriptionStaffAccess,
  asyncHandler(fulfillmentListController.list)
);

router.get(
  "/search",
  dashboardAuthMiddleware,
  subscriptionStaffAccess,
  asyncHandler(controller.searchByPhone)
);

router.get(
  "/quick-day-deduction/search",
  dashboardAuthMiddleware,
  quickDayDeductionWriteAccess,
  asyncHandler(quickDayDeductionController.search)
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
  "/:subscriptionId/invoice",
  dashboardAuthMiddleware,
  invoiceReadAccess,
  asyncHandler(subscriptionInvoiceController.getSubscriptionInvoice)
);

router.get(
  "/:subscriptionId/financial-control",
  dashboardAuthMiddleware,
  superadminFinancialControlAccess,
  asyncHandler(financialControlController.preview)
);

router.post(
  "/:subscriptionId/financial-control",
  dashboardAuthMiddleware,
  superadminFinancialControlAccess,
  asyncHandler(financialControlController.execute)
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

router.get(
  "/:subscriptionId/quick-day-deduction/options",
  dashboardAuthMiddleware,
  quickDayDeductionWriteAccess,
  asyncHandler(quickDayDeductionController.listOptions)
);

router.post(
  "/:subscriptionId/quick-day-deduction",
  dashboardAuthMiddleware,
  quickDayDeductionWriteAccess,
  asyncHandler(quickDayDeductionController.deduct)
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
