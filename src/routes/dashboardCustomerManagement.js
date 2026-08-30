"use strict";

const { Router } = require("express");
const controller = require("../controllers/dashboardCustomerManagementController");
const financialControlController = require("../controllers/dashboardSubscriptionFinancialControlController");
const asyncHandler = require("../middleware/asyncHandler");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["superadmin"]));
router.get("/:id", asyncHandler(controller.getCustomer));
router.patch("/:id", asyncHandler(controller.updateCustomer));
router.post("/:id/meal-compensations", asyncHandler(controller.grantMealCompensation));
router.get(
  "/:id/subscriptions/:subscriptionId/financial-control",
  asyncHandler(financialControlController.preview)
);
router.post(
  "/:id/subscriptions/:subscriptionId/financial-control",
  asyncHandler(financialControlController.execute)
);
router.post("/:id/account-merge/preview", asyncHandler(controller.previewAccountMerge));
router.post("/:id/account-merge", asyncHandler(controller.mergeAccounts));

module.exports = router;
