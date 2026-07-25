"use strict";

const { Router } = require("express");
const adminController = require("../controllers/adminController");
const builderPremiumMealController = require("../controllers/builderPremiumMealController");
const zoneController = require("../controllers/zoneController");
const dashboardPromoCodeRoutes = require("./dashboardPromoCodes");
const asyncHandler = require("../middleware/asyncHandler");
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

// Promo codes are a restaurant business-management capability. Mount this
// scoped router before the broad admin router so restaurant users can list,
// create, update, validate, toggle, and archive promo codes without receiving
// unrelated admin access.
router.use("/promo-codes", dashboardPromoCodeRoutes);

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

// Restaurant and legacy kitchen staff may create a customer account before
// creating that customer's subscription. Authorization stays on this exact
// endpoint so the scoped router cannot open unrelated admin mutations.
router.post(
  "/users",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant", "kitchen"]),
  asyncHandler(adminController.createAppUserAdmin)
);

module.exports = router;
