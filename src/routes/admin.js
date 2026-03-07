const { Router } = require("express");
const controller = require("../controllers/adminController");
const saladController = require("../controllers/saladIngredientController");
const premiumMealController = require("../controllers/premiumMealController");
const addonController = require("../controllers/addonController");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin"]));

router.get("/plans", asyncHandler(controller.listPlansAdmin));
router.get("/plans/:id", asyncHandler(controller.getPlanAdmin));
router.post("/plans", asyncHandler(controller.createPlan));
router.put("/plans/:id", asyncHandler(controller.updatePlan));
router.delete("/plans/:id", asyncHandler(controller.deletePlan));
router.patch("/plans/:id/toggle", asyncHandler(controller.togglePlanActive));
router.patch("/plans/:id/sort", asyncHandler(controller.updatePlanSortOrder));
router.post("/plans/:id/clone", asyncHandler(controller.clonePlan));

router.post("/plans/:id/grams/clone", asyncHandler(controller.cloneGramsRow));
router.delete("/plans/:id/grams/:grams", asyncHandler(controller.deleteGramsRow));
router.patch("/plans/:id/grams/:grams/toggle", asyncHandler(controller.toggleGramsRow));
router.patch("/plans/:id/grams/:grams/sort", asyncHandler(controller.updateGramsSortOrder));

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
router.post("/premium-meals", asyncHandler(premiumMealController.createPremiumMeal));
router.put("/premium-meals/:id", asyncHandler(premiumMealController.updatePremiumMeal));
router.delete("/premium-meals/:id", asyncHandler(premiumMealController.deletePremiumMeal));
router.patch("/premium-meals/:id/toggle", asyncHandler(premiumMealController.togglePremiumMealActive));
router.patch("/premium-meals/:id/sort", asyncHandler(premiumMealController.updatePremiumMealSortOrder));
router.post("/premium-meals/:id/clone", asyncHandler(premiumMealController.clonePremiumMeal));

router.get("/addons", asyncHandler(addonController.listAddonsAdmin));
router.get("/addons/:id", asyncHandler(addonController.getAddonAdmin));
router.post("/addons", asyncHandler(addonController.createAddon));
router.put("/addons/:id", asyncHandler(addonController.updateAddon));
router.delete("/addons/:id", asyncHandler(addonController.deleteAddon));
router.patch("/addons/:id/toggle", asyncHandler(addonController.toggleAddonActive));
router.patch("/addons/:id/sort", asyncHandler(addonController.updateAddonSortOrder));
router.post("/addons/:id/clone", asyncHandler(addonController.cloneAddon));

router.put("/settings/cutoff", asyncHandler(controller.updateCutoff));
router.put("/settings/delivery-windows", asyncHandler(controller.updateDeliveryWindows));
router.put("/settings/skip-allowance", asyncHandler(controller.updateSkipAllowance));
router.put("/settings/premium-price", asyncHandler(controller.updatePremiumPrice));
router.get("/dashboard-users", asyncHandler(controller.listDashboardUsers));
router.post("/dashboard-users", asyncHandler(controller.createDashboardUser));
router.get("/logs", asyncHandler(controller.listActivityLogs));
router.get("/notification-logs", asyncHandler(controller.listNotificationLogs));

router.post("/trigger-cutoff", asyncHandler(controller.triggerDailyCutoff));

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

module.exports = router;
