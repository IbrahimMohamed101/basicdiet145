const { Router } = require("express");
const controller = require("../controllers/adminController");
const saladController = require("../controllers/saladIngredientController");
const mealIngredientController = require("../controllers/mealIngredientController");
const mealController = require("../controllers/mealController");
const mealCategoryController = require("../controllers/mealCategoryController");
const addonController = require("../controllers/addonController");
const builderPremiumMealController = require("../controllers/builderPremiumMealController");
const promoCodeController = require("../controllers/promoCodeController");
const uploadController = require("../controllers/uploadController");
const contentController = require("../controllers/contentController");
const zoneController = require("../controllers/zoneController");
const dashboardHealthController = require("../controllers/dashboardHealthController");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const asyncHandler = require("../middleware/asyncHandler");
const { adminImageUploadMiddleware } = require("../middleware/imageUpload");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin"]));

/**
 * @openapi
 * /admin/uploads/image:
 *   post:
 *     summary: Upload an image to Cloudinary
 *     tags: [Admin (Dashboard)]
 *     security:
 *       - dashboardBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               folder:
 *                 type: string
 *                 description: Optional folder suffix under `basicdiet/`, for example `plans`, `meals`, or `addons`.
 *     responses:
 *       201:
 *         description: Uploaded
 *       400:
 *         description: Missing file, invalid mime type, or file too large.
 */
router.post("/uploads/image", adminImageUploadMiddleware, asyncHandler(uploadController.uploadAdminImage));

/**
 * @openapi
 * /admin/content/terms/subscription:
 *   get:
 *     summary: Get the active subscription terms and conditions for dashboard editing
 *     tags: [Admin Content]
 *     security:
 *       - dashboardBearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locale
 *         schema:
 *           type: string
 *           example: ar
 *         description: Locale of the requested content. Defaults to `ar`.
 *     responses:
 *       200:
 *         description: Active subscription terms
 *       401:
 *         description: Missing or invalid dashboard token
 *       403:
 *         description: Dashboard user does not have admin permissions
 *       404:
 *         description: Active content not found
 *   put:
 *     summary: Create or update the active subscription terms and conditions
 *     tags: [Admin Content]
 *     security:
 *       - dashboardBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - content
 *               - locale
 *             properties:
 *               title:
 *                 type: string
 *                 example: شروط وأحكام اشتراك الباقات الشهرية
 *               locale:
 *                 type: string
 *                 example: ar
 *               content:
 *                 oneOf:
 *                   - type: string
 *                     example: النص الجديد...
 *                   - type: object
 *           examples:
 *             structured:
 *               value:
 *                 title: شروط وأحكام اشتراك الباقات الشهرية
 *                 locale: ar
 *                 content:
 *                   format: structured_document
 *                   sections:
 *                     - id: packages-and-meals
 *                       heading: شروط الباقات والوجبات
 *                       paragraphs:
 *                         - يجب على المشترك اختيار الباقة المناسبة قبل إتمام الاشتراك.
 *       responses:
 *         200:
 *           description: Content saved successfully
 *         400:
 *           description: Invalid body shape
 *         401:
 *           description: Missing or invalid dashboard token
 *         403:
 *           description: Dashboard user does not have admin permissions
 *         422:
 *           description: Semantic validation failed
 */
router.get("/content/terms/subscription", asyncHandler(contentController.getSubscriptionTermsAdmin));
router.put("/content/terms/subscription", asyncHandler(contentController.upsertSubscriptionTermsAdmin));

router.get("/overview", asyncHandler(controller.getDashboardOverview));
router.get("/search", asyncHandler(controller.searchDashboard));
router.get("/notifications/summary", asyncHandler(controller.getDashboardNotificationSummary));
router.get("/reports/today", asyncHandler(controller.getTodayReport));
router.get("/health/catalog", asyncHandler(dashboardHealthController.getCatalogHealth));
router.get("/health/subscription-menu", asyncHandler(dashboardHealthController.getSubscriptionMenuHealth));
router.get("/health/meal-planner", asyncHandler(dashboardHealthController.getMealPlannerHealth));
router.get("/health/indexes", asyncHandler(dashboardHealthController.getIndexesHealth));
router.get("/plans", asyncHandler(controller.listPlansAdmin));
router.get("/plans/:id", asyncHandler(controller.getPlanAdmin));
router.post("/plans", asyncHandler(controller.createPlan));
router.put("/plans/:id", asyncHandler(controller.updatePlan));
router.delete("/plans/:id", asyncHandler(controller.deletePlan));
router.patch("/plans/:id/toggle", asyncHandler(controller.togglePlanActive));
router.patch("/plans/:id/sort", asyncHandler(controller.updatePlanSortOrder));
router.post("/plans/:id/clone", asyncHandler(controller.clonePlan));

router.post("/plans/:id/grams", asyncHandler(controller.createGramsRow));
router.post("/plans/:id/grams/clone", asyncHandler(controller.cloneGramsRow));
router.delete("/plans/:id/grams/:grams", asyncHandler(controller.deleteGramsRow));
router.patch("/plans/:id/grams/:grams/toggle", asyncHandler(controller.toggleGramsRow));
router.patch("/plans/:id/grams/:grams/sort", asyncHandler(controller.updateGramsSortOrder));

router.post("/plans/:id/grams/:grams/meals", asyncHandler(controller.createMealsOption));
router.post("/plans/:id/grams/:grams/meals/clone", asyncHandler(controller.cloneMealsOption));
router.delete("/plans/:id/grams/:grams/meals/:mealsPerDay", asyncHandler(controller.deleteMealsOption));
router.patch(
  "/plans/:id/grams/:grams/meals/:mealsPerDay/toggle",
  asyncHandler(controller.toggleMealsOption)
);
router.patch(
  "/plans/:id/grams/:grams/meals/:mealsPerDay/sort",
  asyncHandler(controller.updateMealsSortOrder)
);

router.get("/addons", asyncHandler(addonController.listAddonsAdmin));
router.get("/addons/:id", asyncHandler(addonController.getAddonAdmin));
router.post("/addons", adminImageUploadMiddleware, asyncHandler(addonController.createAddon));
router.put("/addons/:id", adminImageUploadMiddleware, asyncHandler(addonController.updateAddon));
router.delete("/addons/:id", asyncHandler(addonController.deleteAddon));
router.patch("/addons/:id/toggle", asyncHandler(addonController.toggleAddonActive));
router.patch("/addons/:id/sort", asyncHandler(addonController.updateAddonSortOrder));
router.post("/addons/:id/clone", asyncHandler(addonController.cloneAddon));

router.get("/addon-plans", asyncHandler(addonController.listAddonPlansAdmin));
router.post("/addon-plans", adminImageUploadMiddleware, asyncHandler(addonController.createAddonPlan));
router.get("/addon-plans/:id", asyncHandler(addonController.getAddonPlanAdmin));
router.put("/addon-plans/:id", adminImageUploadMiddleware, asyncHandler(addonController.updateAddonPlan));
router.patch("/addon-plans/:id/toggle", asyncHandler(addonController.toggleAddonPlanActive));
router.get("/builder-premium-meals", asyncHandler(builderPremiumMealController.listBuilderPremiumMealsAdmin));
router.get("/builder-premium-meals/:id", asyncHandler(builderPremiumMealController.getBuilderPremiumMealAdmin));
router.post(
  "/builder-premium-meals",
  adminImageUploadMiddleware,
  asyncHandler(builderPremiumMealController.createBuilderPremiumMeal)
);
router.put(
  "/builder-premium-meals/:id",
  adminImageUploadMiddleware,
  asyncHandler(builderPremiumMealController.updateBuilderPremiumMeal)
);
router.delete("/builder-premium-meals/:id", asyncHandler(builderPremiumMealController.deleteBuilderPremiumMeal));
router.patch(
  "/builder-premium-meals/:id/toggle",
  asyncHandler(builderPremiumMealController.toggleBuilderPremiumMealActive)
);
router.patch(
  "/builder-premium-meals/:id/sort",
  asyncHandler(builderPremiumMealController.updateBuilderPremiumMealSortOrder)
);
router.post(
  "/builder-premium-meals/:id/clone",
  asyncHandler(builderPremiumMealController.cloneBuilderPremiumMeal)
);
router.get("/promo-codes", asyncHandler(promoCodeController.listPromoCodesAdmin));
router.get("/promo-codes/:id", asyncHandler(promoCodeController.getPromoCodeAdmin));
router.post("/promo-codes", asyncHandler(promoCodeController.createPromoCodeAdmin));
router.put("/promo-codes/:id", asyncHandler(promoCodeController.updatePromoCodeAdmin));
router.patch("/promo-codes/:id/toggle", asyncHandler(promoCodeController.togglePromoCodeActive));
router.delete("/promo-codes/:id", asyncHandler(promoCodeController.deletePromoCodeAdmin));
router.get("/meal-categories", asyncHandler(mealCategoryController.listMealCategoriesAdmin));
router.get("/meal-categories/:id", asyncHandler(mealCategoryController.getMealCategoryAdmin));
router.post("/meal-categories", asyncHandler(mealCategoryController.createMealCategory));
router.put("/meal-categories/:id", asyncHandler(mealCategoryController.updateMealCategory));
router.delete("/meal-categories/:id", asyncHandler(mealCategoryController.deleteMealCategory));
router.patch("/meal-categories/:id/toggle", asyncHandler(mealCategoryController.toggleMealCategoryActive));
router.patch("/meal-categories/:id/sort", asyncHandler(mealCategoryController.updateMealCategorySortOrder));
router.get("/meals", asyncHandler(mealController.listMealsAdmin));
router.get("/meals/:id", asyncHandler(mealController.getMealAdmin));
router.post("/meals", adminImageUploadMiddleware, asyncHandler(mealController.createMeal));
router.put("/meals/:id", adminImageUploadMiddleware, asyncHandler(mealController.updateMeal));
router.delete("/meals/:id", asyncHandler(mealController.deleteMeal));
router.patch("/meals/:id/toggle", asyncHandler(mealController.toggleMealActive));

router.patch("/settings", asyncHandler(controller.patchSettings));
/**
 * @openapi
 * /admin/settings/restaurant-hours:
 *   get:
 *     summary: Get restaurant operating hours used by pickup preparation
 *     tags: [Admin (Dashboard)]
 *     security:
 *       - dashboardBearerAuth: []
 *     responses:
 *       200:
 *         description: Restaurant hours returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     timezone:
 *                       type: string
 *                       example: Asia/Riyadh
 *                     restaurant_open_time:
 *                       type: string
 *                       example: 10:00
 *                     restaurant_close_time:
 *                       type: string
 *                       example: 23:00
 *   put:
 *     summary: Update restaurant operating hours in Saudi time
 *     tags: [Admin (Dashboard)]
 *     security:
 *       - dashboardBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - restaurant_open_time
 *               - restaurant_close_time
 *             properties:
 *               restaurant_open_time:
 *                 type: string
 *                 example: 10:00
 *                 description: Saudi time in HH:mm format
 *               restaurant_close_time:
 *                 type: string
 *                 example: 23:00
 *                 description: Saudi time in HH:mm format
 *     responses:
 *       200:
 *         description: Restaurant hours updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     timezone:
 *                       type: string
 *                       example: Asia/Riyadh
 *                     restaurant_open_time:
 *                       type: string
 *                     restaurant_close_time:
 *                       type: string
 *       400:
 *         description: Invalid time input
 */
router.get("/settings/restaurant-hours", asyncHandler(controller.getRestaurantHours));
router.put("/settings/restaurant-hours", asyncHandler(controller.updateRestaurantHours));
router.put("/settings/cutoff", asyncHandler(controller.updateCutoff));
router.put("/settings/delivery-windows", asyncHandler(controller.updateDeliveryWindows));
router.put("/settings/skip-allowance", asyncHandler(controller.updateSkipAllowance));
router.put("/settings/premium-price", asyncHandler(controller.updatePremiumPrice));
router.put("/settings/subscription-delivery-fee", asyncHandler(controller.updateSubscriptionDeliveryFee));
router.put("/settings/vat-percentage", asyncHandler(controller.updateVatPercentage));
router.put("/settings/custom-salad-base-price", asyncHandler(controller.updateCustomSaladBasePrice));
router.put("/settings/custom-meal-base-price", asyncHandler(controller.updateCustomMealBasePrice));
router.get("/zones", asyncHandler(zoneController.listZonesAdmin));
router.post("/zones", asyncHandler(zoneController.createZoneAdmin));
router.get("/zones/:id", asyncHandler(zoneController.getZoneAdmin));
router.put("/zones/:id", asyncHandler(zoneController.updateZoneAdmin));
router.patch("/zones/:id/toggle", asyncHandler(zoneController.toggleZoneActiveAdmin));
router.delete("/zones/:id", asyncHandler(zoneController.deleteZoneAdmin));
router.get("/users", asyncHandler(controller.listAppUsers));
router.post("/users", asyncHandler(controller.createAppUserAdmin));
router.get("/users/:id/subscriptions", asyncHandler(controller.listAppUserSubscriptions));
router.get("/users/:id", asyncHandler(controller.getAppUser));
router.put("/users/:id", asyncHandler(controller.updateAppUser));
router.get("/subscriptions/summary", asyncHandler(controller.getSubscriptionsSummaryAdmin));
router.get("/subscriptions/export", asyncHandler(controller.exportSubscriptionsAdmin));
router.get("/subscriptions", asyncHandler(controller.listSubscriptionsAdmin));
router.post("/subscriptions/quote", asyncHandler(controller.quoteSubscriptionAdmin));
router.post("/subscriptions", asyncHandler(controller.createSubscriptionAdmin));
router.get("/subscriptions/:id/days", asyncHandler(controller.listSubscriptionDaysAdmin));
router.get("/subscriptions/:id/audit-log", asyncHandler(controller.getSubscriptionAuditLogAdmin));
router.get("/subscriptions/:id", asyncHandler(controller.getSubscriptionAdmin));
router.put("/subscriptions/:id/delivery", asyncHandler(controller.updateSubscriptionDeliveryAdmin));
router.patch("/subscriptions/:id/addon-entitlements", asyncHandler(controller.updateSubscriptionAddonEntitlementsAdmin));
router.patch(
  "/subscriptions/:id/balances",
  dashboardRoleMiddleware(["superadmin"]),
  asyncHandler(controller.updateSubscriptionBalancesAdmin)
);
router.post("/subscriptions/:id/cancel", asyncHandler(controller.cancelSubscriptionAdmin));
router.put("/subscriptions/:id/extend", asyncHandler(controller.extendSubscriptionAdmin));
router.post("/subscriptions/:id/freeze", asyncHandler(controller.freezeSubscriptionAdmin));
router.post("/subscriptions/:id/unfreeze", asyncHandler(controller.unfreezeSubscriptionAdmin));
router.post("/subscriptions/:id/days/:date/skip", asyncHandler(controller.skipSubscriptionDayAdmin));
router.post("/subscriptions/:id/days/:date/unskip", asyncHandler(controller.unskipSubscriptionDayAdmin));
router.get("/orders", asyncHandler(controller.listOrdersAdmin));
router.get("/orders/:id", asyncHandler(controller.getOrderAdmin));
router.get("/payments", asyncHandler(controller.listPaymentsAdmin));
router.get("/payments/:id", asyncHandler(controller.getPaymentAdmin));
router.post("/payments/:id/verify", asyncHandler(controller.verifyPaymentAdmin));
router.get("/dashboard-users", asyncHandler(controller.listDashboardUsers));
router.post("/dashboard-users", asyncHandler(controller.createDashboardUser));
router.get("/dashboard-users/:id", asyncHandler(controller.getDashboardUser));
router.put("/dashboard-users/:id", asyncHandler(controller.updateDashboardUser));
router.delete("/dashboard-users/:id", asyncHandler(controller.deleteDashboardUser));
router.post("/dashboard-users/:id/reset-password", asyncHandler(controller.resetDashboardUserPassword));
router.get("/logs", asyncHandler(controller.listActivityLogs));
router.get("/notification-logs", asyncHandler(controller.listNotificationLogs));

router.post("/trigger-cutoff", asyncHandler(controller.triggerDailyCutoff));

router.get("/salad-ingredients", asyncHandler(saladController.listIngredientsAdmin));
/**
 * @openapi
 * /admin/salad-ingredients:
 *   post:
 *     summary: Create salad ingredient
 *     tags: [Salad]
 *     security:
 *       - dashboardBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name_en:
 *                 type: string
 *               name_ar:
 *                 type: string
 *               price:
 *                 type: number
 *               calories:
 *                 type: number
 *               maxQuantity:
 *                 type: number
 *     responses:
 *       201:
 *         description: Created
 */
router.post("/salad-ingredients", asyncHandler(saladController.createIngredient));
/**
 * @openapi
 * /admin/salad-ingredients/{id}:
 *   patch:
 *     summary: Update salad ingredient
 *     tags: [Salad]
 *     security:
 *       - dashboardBearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated
 */
router.patch("/salad-ingredients/:id", asyncHandler(saladController.updateIngredient));
/**
 * @openapi
 * /admin/salad-ingredients/{id}/toggle:
 *   patch:
 *     summary: Toggle salad ingredient active state
 *     tags: [Salad]
 *     security:
 *       - dashboardBearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Toggled
 */
router.patch("/salad-ingredients/:id/toggle", asyncHandler(saladController.toggleIngredient));

router.get("/meal-ingredients", asyncHandler(mealIngredientController.listIngredientsAdmin));
router.post("/meal-ingredients", asyncHandler(mealIngredientController.createIngredient));
router.patch("/meal-ingredients/:id", asyncHandler(mealIngredientController.updateIngredient));
router.patch("/meal-ingredients/:id/toggle", asyncHandler(mealIngredientController.toggleIngredient));

module.exports = router;
