const { Router } = require("express");
const controller = require("../controllers/adminController");
const saladController = require("../controllers/saladIngredientController");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin"]));

router.post("/plans", controller.createPlan);
router.put("/settings/cutoff", controller.updateCutoff);
router.put("/settings/delivery-windows", controller.updateDeliveryWindows);
router.put("/settings/skip-allowance", controller.updateSkipAllowance);
router.put("/settings/premium-price", controller.updatePremiumPrice);
router.get("/dashboard-users", controller.listDashboardUsers);
router.post("/dashboard-users", controller.createDashboardUser);
router.get("/logs", controller.listActivityLogs);
router.get("/notification-logs", controller.listNotificationLogs);

router.post("/trigger-cutoff", controller.triggerDailyCutoff);

/**
 * @openapi
 * /admin/salad-ingredients:
 *   post:
 *     summary: Create salad ingredient
 *     tags: [Salad]
 *     security:
 *       - bearerAuth: []
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
router.post("/salad-ingredients", saladController.createIngredient);
/**
 * @openapi
 * /admin/salad-ingredients/{id}:
 *   patch:
 *     summary: Update salad ingredient
 *     tags: [Salad]
 *     security:
 *       - bearerAuth: []
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
router.patch("/salad-ingredients/:id", saladController.updateIngredient);
/**
 * @openapi
 * /admin/salad-ingredients/{id}/toggle:
 *   patch:
 *     summary: Toggle salad ingredient active state
 *     tags: [Salad]
 *     security:
 *       - bearerAuth: []
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
router.patch("/salad-ingredients/:id/toggle", saladController.toggleIngredient);

module.exports = router;
