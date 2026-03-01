const { Router } = require("express");
const controller = require("../controllers/adminController");
const saladController = require("../controllers/saladIngredientController");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin"]));

router.post("/plans", asyncHandler(controller.createPlan));
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
