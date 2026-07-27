"use strict";

const { Router } = require("express");
const adminController = require("../controllers/adminController");
const builderPremiumMealController = require("../controllers/builderPremiumMealController");
const zoneController = require("../controllers/zoneController");
const asyncHandler = require("../middleware/asyncHandler");
const ignoreDashboardCustomerEmail = require("../middleware/ignoreDashboardCustomerEmail");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

const subscriptionStaffReadAccess = dashboardRoleMiddleware([
  "admin",
  "cashier",
  "restaurant",
  "kitchen",
]);

// The create-subscription workspace uses these exact legacy dashboard reads.
// Keep them narrowly scoped and read-only so restaurant/kitchen staff can load
// customers and subscription configuration without receiving admin mutations.
router.get(
  "/users",
  dashboardAuthMiddleware,
  subscriptionStaffReadAccess,
  asyncHandler(adminController.listAppUsers)
);
router.get(
  "/users/:id/subscriptions",
  dashboardAuthMiddleware,
  subscriptionStaffReadAccess,
  asyncHandler(adminController.listAppUserSubscriptions)
);
router.get(
  "/users/:id",
  dashboardAuthMiddleware,
  subscriptionStaffReadAccess,
  asyncHandler(adminController.getAppUser)
);
router.get(
  "/settings",
  dashboardAuthMiddleware,
  subscriptionStaffReadAccess,
  asyncHandler(adminController.getDashboardSettings)
);
router.get(
  "/zones",
  dashboardAuthMiddleware,
  subscriptionStaffReadAccess,
  asyncHandler(zoneController.listZonesAdmin)
);
router.get(
  "/builder-premium-meals",
  dashboardAuthMiddleware,
  subscriptionStaffReadAccess,
  asyncHandler(builderPremiumMealController.listBuilderPremiumMealsAdmin)
);
router.get(
  "/builder-premium-meals/:id",
  dashboardAuthMiddleware,
  subscriptionStaffReadAccess,
  asyncHandler(builderPremiumMealController.getBuilderPremiumMealAdmin)
);

// Dashboard-created customers are phone-authenticated. Email is intentionally
// ignored here so stale/default dashboard values cannot block a new phone.
router.post(
  "/users",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "kitchen"]),
  ignoreDashboardCustomerEmail,
  asyncHandler(adminController.createAppUserAdmin)
);

module.exports = router;
