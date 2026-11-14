"use strict";

const { Router } = require("express");
const controller = require("../controllers/dashboardCustomerManagementController");
const financialControlController = require("../controllers/dashboardSubscriptionFinancialControlController");
const retentionController = require("../controllers/dashboard/customerRetentionController");
const followupController = require("../controllers/dashboard/customerRetentionFollowupController");
const asyncHandler = require("../middleware/asyncHandler");
const { adminPasswordResetLimiter } = require("../middleware/rateLimit");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();
const superadminOnly = dashboardRoleMiddleware(["superadmin"]);
const customerManagementRoles = dashboardRoleMiddleware(["restaurant"]);
const customerPasswordResetRoles = dashboardRoleMiddleware(["restaurant", "admin"]);

router.use(dashboardAuthMiddleware);

// Password recovery also allows admins through its dedicated policy.
router.post(
  "/:id/password-reset",
  customerPasswordResetRoles,
  adminPasswordResetLimiter,
  asyncHandler(controller.resetCustomerPassword)
);

// Must precede the parameterized customer routes.
router.get("/retention", customerManagementRoles, asyncHandler(retentionController.getRetention));
router.get("/retention/:id/followups", customerManagementRoles, asyncHandler(followupController.listFollowups));
router.post("/retention/:id/followups", customerManagementRoles, asyncHandler(followupController.addFollowup));

router.get("/:id", customerManagementRoles, asyncHandler(controller.getCustomer));
router.patch("/:id", customerManagementRoles, asyncHandler(controller.updateCustomer));
router.post(
  "/:id/meal-compensations",
  customerManagementRoles,
  asyncHandler(controller.grantMealCompensation)
);
router.get(
  "/:id/subscriptions/:subscriptionId/financial-control",
  superadminOnly,
  asyncHandler(financialControlController.preview)
);
router.post(
  "/:id/subscriptions/:subscriptionId/financial-control",
  superadminOnly,
  asyncHandler(financialControlController.execute)
);
router.post(
  "/:id/account-merge/preview",
  customerManagementRoles,
  asyncHandler(controller.previewAccountMerge)
);
router.post("/:id/account-merge", customerManagementRoles, asyncHandler(controller.mergeAccounts));

module.exports = router;
