"use strict";

const { Router } = require("express");
const adminController = require("../controllers/adminController");
const addonController = require("../controllers/addonController");
const addonPlanPriceController = require("../controllers/addonPlanPriceController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware);
router.use((req, _res, next) => {
  // This compatibility router is mounted before the normal admin router. Let all
  // non-restaurant roles continue to their existing authorization path.
  if (req.dashboardUserRole !== "restaurant") return next("router");
  return next();
});

router.get("/users", asyncHandler(adminController.listAppUsers));
router.get("/users/:id/subscriptions", asyncHandler(adminController.listAppUserSubscriptions));
router.get("/users/:id", asyncHandler(adminController.getAppUser));
router.get("/orders", asyncHandler(adminController.listOrdersAdmin));
router.get("/orders/:id", asyncHandler(adminController.getOrderAdmin));

router.get("/addons", asyncHandler(addonController.listDashboardAddonPlans));
router.get("/addon-plans", asyncHandler(addonController.listAddonPlansAdmin));
router.get("/addon-plans/:id", asyncHandler(addonController.getAddonPlanAdmin));
router.get("/addon-items", asyncHandler(addonController.listAddonItemsAdmin));
router.get("/addon-items/:id", asyncHandler(addonController.getAddonItemAdmin));
router.get("/addon-prices", asyncHandler(addonPlanPriceController.listAddonPrices));
router.get("/addon-prices/:id", asyncHandler(addonPlanPriceController.getAddonPrice));
router.get("/plans", asyncHandler(adminController.listPlansAdmin));
router.get("/plans/:id", asyncHandler(adminController.getPlanAdmin));

module.exports = router;
