"use strict";

const { Router } = require("express");
const controller = require("../controllers/dashboardCustomerManagementController");
const financialControlController = require("../controllers/dashboardSubscriptionFinancialControlController");
const asyncHandler = require("../middleware/asyncHandler");
const { adminPasswordResetLimiter } = require("../middleware/rateLimit");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();
const superadminOnly = dashboardRoleMiddleware(["superadmin"]);
const restaurantOrAbove = dashboardRoleMiddleware(["restaurant"]);

router.use(dashboardAuthMiddleware);

// Password recovery is a branch operation: restaurant, admin and superadmin can
// issue a new server-generated password. All broader customer-management writes
// remain superadmin-only below.
router.post(
  "/:id/password-reset",
  restaurantOrAbove,
  adminPasswordResetLimiter,
  asyncHandler(controller.resetCustomerPassword)
);

router.get("/:id", superadminOnly, asyncHandler(controller.getCustomer));
router.patch("/:id", superadminOnly, asyncHandler(controller.updateCustomer));
router.post(
  "/:id/meal-compensations",
  superadminOnly,
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
  superadminOnly,
  asyncHandler(controller.previewAccountMerge)
);
router.post("/:id/account-merge", superadminOnly, asyncHandler(controller.mergeAccounts));

module.exports = router;
