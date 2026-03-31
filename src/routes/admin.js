const { Router } = require("express");
const controller = require("../controllers/adminController");
const saladController = require("../controllers/saladIngredientController");
const mealIngredientController = require("../controllers/mealIngredientController");
const mealController = require("../controllers/mealController");
const mealCategoryController = require("../controllers/mealCategoryController");
const premiumMealController = require("../controllers/premiumMealController");
const addonController = require("../controllers/addonController");
const uploadController = require("../controllers/uploadController");
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

router.get("/overview", asyncHandler(controller.getDashboardOverview));
router.get("/search", asyncHandler(controller.searchDashboard));
router.get("/notifications/summary", asyncHandler(controller.getDashboardNotificationSummary));
router.get("/reports/today", asyncHandler(controller.getTodayReport));
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

router.get("/premium-meals", asyncHandler(premiumMealController.listPremiumMealsAdmin));
router.get("/premium-meals/:id", asyncHandler(premiumMealController.getPremiumMealAdmin));
router.post("/premium-meals", adminImageUploadMiddleware, asyncHandler(premiumMealController.createPremiumMeal));
router.put("/premium-meals/:id", adminImageUploadMiddleware, asyncHandler(premiumMealController.updatePremiumMeal));
router.delete("/premium-meals/:id", asyncHandler(premiumMealController.deletePremiumMeal));
router.patch("/premium-meals/:id/toggle", asyncHandler(premiumMealController.togglePremiumMealActive));
router.patch("/premium-meals/:id/sort", asyncHandler(premiumMealController.updatePremiumMealSortOrder));
router.post("/premium-meals/:id/clone", asyncHandler(premiumMealController.clonePremiumMeal));

router.get("/addons", asyncHandler(addonController.listAddonsAdmin));
router.get("/addons/:id", asyncHandler(addonController.getAddonAdmin));
router.post("/addons", adminImageUploadMiddleware, asyncHandler(addonController.createAddon));
router.put("/addons/:id", adminImageUploadMiddleware, asyncHandler(addonController.updateAddon));
router.delete("/addons/:id", asyncHandler(addonController.deleteAddon));
router.patch("/addons/:id/toggle", asyncHandler(addonController.toggleAddonActive));
router.patch("/addons/:id/sort", asyncHandler(addonController.updateAddonSortOrder));
router.post("/addons/:id/clone", asyncHandler(addonController.cloneAddon));
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
router.put("/settings/cutoff", asyncHandler(controller.updateCutoff));
router.put("/settings/delivery-windows", asyncHandler(controller.updateDeliveryWindows));
router.put("/settings/skip-allowance", asyncHandler(controller.updateSkipAllowance));
router.put("/settings/premium-price", asyncHandler(controller.updatePremiumPrice));
router.put("/settings/subscription-delivery-fee", asyncHandler(controller.updateSubscriptionDeliveryFee));
router.put("/settings/vat-percentage", asyncHandler(controller.updateVatPercentage));
router.put("/settings/custom-salad-base-price", asyncHandler(controller.updateCustomSaladBasePrice));
router.put("/settings/custom-meal-base-price", asyncHandler(controller.updateCustomMealBasePrice));
router.get("/users", asyncHandler(controller.listAppUsers));
router.post("/users", asyncHandler(controller.createAppUserAdmin));
router.get("/users/:id/subscriptions", asyncHandler(controller.listAppUserSubscriptions));
router.get("/users/:id", asyncHandler(controller.getAppUser));
router.put("/users/:id", asyncHandler(controller.updateAppUser));
router.get("/subscriptions/summary", asyncHandler(controller.getSubscriptionsSummaryAdmin));
router.get("/subscriptions/export", asyncHandler(controller.exportSubscriptionsAdmin));
router.get("/subscriptions", asyncHandler(controller.listSubscriptionsAdmin));
router.post("/subscriptions", asyncHandler(controller.createSubscriptionAdmin));
router.get("/subscriptions/:id/days", asyncHandler(controller.listSubscriptionDaysAdmin));
router.get("/subscriptions/:id", asyncHandler(controller.getSubscriptionAdmin));
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
