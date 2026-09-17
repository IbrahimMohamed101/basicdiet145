const { Router } = require("express");
const controller = require("../controllers/dashboard/accountingReportController");
const subscriptionPaymentController = require("../controllers/dashboard/subscriptionPaymentReportController");
const subscriptionOperationsAuditController = require("../controllers/dashboard/subscriptionOperationsAuditController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.get(
  "/daily-report",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin"]),
  asyncHandler(controller.getDailyReport)
);

router.get(
  "/daily-report/export",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin"]),
  asyncHandler(controller.exportDailyReport)
);

router.get(
  "/subscription-payments/daily",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin"]),
  asyncHandler(subscriptionPaymentController.getDailySubscriptionPayments)
);

router.get(
  "/subscription-payments/monthly",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin"]),
  asyncHandler(subscriptionPaymentController.getMonthlySubscriptionPayments)
);

router.get(
  "/subscription-payments/range",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin"]),
  asyncHandler(subscriptionPaymentController.getRangeSubscriptionPayments)
);

router.get(
  "/subscription-operations-audit",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin"]),
  asyncHandler(subscriptionOperationsAuditController.getSubscriptionOperationsAudit)
);

module.exports = router;
