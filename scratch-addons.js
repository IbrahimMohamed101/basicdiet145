const dashboardAdminOrKitchen = dashboardRoleMiddleware(["admin", "kitchen"]);

router.get("/addons", dashboardAdminOrKitchen, asyncHandler(addonController.listDashboardAddonPlans));
router.post("/addons", dashboardAdminOrKitchen, asyncHandler(addonController.createDashboardAddonPlan));
router.patch("/addons/:id/toggle", dashboardAdminOrKitchen, asyncHandler(addonController.toggleAddonPlanActive));
router.put("/addons/:id", dashboardAdminOrKitchen, adminImageUploadMiddleware, asyncHandler(addonController.updateAddonPlan));
router.delete("/addons/:id", dashboardAdminOrKitchen, asyncHandler(addonController.deleteDashboardAddonPlan));

router.get("/addon-plans", dashboardAdminOrKitchen, asyncHandler(addonController.listAddonPlansAdmin));
router.post("/addon-plans", dashboardAdminOrKitchen, adminImageUploadMiddleware, asyncHandler(addonController.createAddonPlan));
router.patch("/addon-plans/:id/toggle", dashboardAdminOrKitchen, asyncHandler(addonController.toggleAddonPlanActive));
router.get("/addon-plans/:id", dashboardAdminOrKitchen, asyncHandler(addonController.getAddonPlanAdmin));
router.put("/addon-plans/:id", dashboardAdminOrKitchen, adminImageUploadMiddleware, asyncHandler(addonController.updateAddonPlan));
router.delete("/addon-plans/:id", dashboardAdminOrKitchen, asyncHandler(addonController.deleteAddonPlan));

router.get("/addon-items", dashboardAdminOrKitchen, asyncHandler(addonController.listAddonItemsAdmin));
router.post("/addon-items", dashboardAdminOrKitchen, adminImageUploadMiddleware, asyncHandler(addonController.createAddonItem));
router.patch("/addon-items/:id/toggle", dashboardAdminOrKitchen, asyncHandler(addonController.toggleAddonItemActive));
router.get("/addon-items/:id", dashboardAdminOrKitchen, asyncHandler(addonController.getAddonItemAdmin));
router.put("/addon-items/:id", dashboardAdminOrKitchen, adminImageUploadMiddleware, asyncHandler(addonController.updateAddonItem));
router.delete("/addon-items/:id", dashboardAdminOrKitchen, asyncHandler(addonController.deleteAddonItem));

router.get("/addon-prices", dashboardAdminOrKitchen, asyncHandler(addonPlanPriceController.listAddonPrices));
router.post("/addon-prices", dashboardAdminOrKitchen, asyncHandler(addonPlanPriceController.createAddonPrice));
router.get("/addon-prices/:id", dashboardAdminOrKitchen, asyncHandler(addonPlanPriceController.getAddonPrice));
router.put("/addon-prices/:id", dashboardAdminOrKitchen, asyncHandler(addonPlanPriceController.updateAddonPrice));
router.delete("/addon-prices/:id", dashboardAdminOrKitchen, asyncHandler(addonPlanPriceController.deleteAddonPrice));
router.patch("/addon-prices/:id/toggle", dashboardAdminOrKitchen, asyncHandler(addonPlanPriceController.toggleAddonPriceActive));
