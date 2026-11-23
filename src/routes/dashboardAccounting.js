const { Router } = require("express");
const controller = require("../controllers/dashboard/accountingReportController");
const subscriptionPaymentController = require("../controllers/dashboard/subscriptionPaymentReportController");
const subscriptionOperationsAuditController = require("../controllers/dashboard/subscriptionOperationsAuditController");
const marketingAnalyticsController = require("../controllers/dashboard/marketingAnalyticsController");
const asyncHandler = require("../middleware/asyncHandler");
const errorResponse = require("../utils/errorResponse");
const { buildPosAccountingRange } = require("../services/dashboard/posAccountingRangeReportService");
const { buildOneTimeAccountingRange } = require("../services/dashboard/oneTimeAccountingRangeReportService");
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

router.get(
  "/marketing-analytics",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin"]),
  asyncHandler(marketingAnalyticsController.getMarketingAnalytics)
);

// Superadmin-only, read-only financial intelligence over immutable POS documents.
// This route neither changes POS invoices nor reconciles external platform payouts.
router.get(
  "/pos/range",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware([]), // Only superadmin gets the explicit bypass.
  asyncHandler(async (req, res) => {
    try {
      const data = await buildPosAccountingRange(req.query);
      return res.json({ status: true, data });
    } catch (error) {
      if (error && error.code === "POS_ACCOUNTING_INVALID_RANGE") {
        return errorResponse(res, 400, error.code, error.message);
      }
      throw error;
    }
  })
);

// Online one-time pay orders have a separate immutable accounting source from POS.
router.get(
  "/one-time/range",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware([]),
  asyncHandler(async (req, res) => {
    try {
      return res.json({ status: true, data: await buildOneTimeAccountingRange(req.query) });
    } catch (error) {
      if (error && error.code === "POS_ACCOUNTING_INVALID_RANGE") {
        return errorResponse(res, 400, error.code, error.message);
      }
      throw error;
    }
  })
);

module.exports = router;
