const { Router } = require("express");
const controller = require("../controllers/subscriptionController");
const customSaladController = require("../controllers/customSaladController");
const customMealController = require("../controllers/customMealController");
const menuController = require("../controllers/menuController");
const { authMiddleware } = require("../middleware/auth");
const { checkoutLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.get("/menu", asyncHandler(menuController.getSubscriptionMenu));
router.get("/meal-planner-menu", asyncHandler(menuController.getSubscriptionMealPlannerMenu));
router.get("/delivery-options", asyncHandler(menuController.getDeliveryOptions));

router.use(authMiddleware);

router.get("/", asyncHandler(controller.listCurrentUserSubscriptions));
router.get("/payment-methods", asyncHandler(controller.getSubscriptionPaymentMethods));
router.get("/current/overview", asyncHandler(controller.getCurrentSubscriptionOverview));
router.post("/quote", asyncHandler(controller.quoteSubscription));
router.get("/checkout-drafts/:draftId", asyncHandler(controller.getCheckoutDraftStatus));
router.post("/checkout-drafts/:draftId/verify-payment", asyncHandler(controller.verifyCheckoutDraftPayment));
/**
 * @openapi
 * /subscriptions/checkout:
 *   post:
 *     summary: Checkout subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planId:
 *                 type: string
 *               premiumItems:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [premiumMealId, qty]
 *                   properties:
 *                     premiumMealId:
 *                       type: string
 *                     qty:
 *                       type: integer
 *               addons:
 *                 type: array
 *                 items:
 *                   type: string
 *               deliveryMode:
 *                 type: string
 *               deliveryAddress:
 *                 type: object
 *     responses:
 *       200:
 *         description: Checkout initiated
 */
router.post("/checkout", checkoutLimiter, asyncHandler(controller.checkoutSubscription));
if (process.env.NODE_ENV !== "production") {
  router.post("/:id/activate", asyncHandler(controller.activateSubscription)); // Mock activation — dev only
}
router.get("/:id/renewal-seed", asyncHandler(controller.getSubscriptionRenewalSeed));
router.post("/:id/renew", asyncHandler(controller.renewSubscription));
router.get("/:id", asyncHandler(controller.getSubscription));
router.get("/:id/operations-meta", asyncHandler(controller.getSubscriptionOperationsMeta));
router.get("/:id/freeze-preview", asyncHandler(controller.getSubscriptionFreezePreview));
router.post("/:id/cancel", asyncHandler(controller.cancelSubscription));
router.get("/:id/timeline", asyncHandler(controller.getSubscriptionTimeline));
router.get("/:id/wallet", asyncHandler(controller.getSubscriptionWallet));
router.get("/:id/wallet/history", asyncHandler(controller.getSubscriptionWalletHistory));
router.get("/:id/wallet/topups/:paymentId/status", asyncHandler(controller.getWalletTopupPaymentStatus));
router.post("/:id/wallet/topups/:paymentId/verify", asyncHandler(controller.verifyWalletTopupPayment));
router.post("/:id/freeze", asyncHandler(controller.freezeSubscription));
router.post("/:id/unfreeze", asyncHandler(controller.unfreezeSubscription));
router.get("/:id/days", authMiddleware, asyncHandler(controller.getSubscriptionDays));
router.get("/:id/today", asyncHandler(controller.getSubscriptionToday));
router.get("/:id/days/:date", asyncHandler(controller.getSubscriptionDay));
/**
 * @openapi
 * /subscriptions/{id}/days/{date}/selection:
 *   put:
 *     summary: Update day selections
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *       - name: date
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated selections
 */
router.put("/:id/days/:date/selection", asyncHandler(controller.updateDaySelection));
router.post("/:id/days/:date/confirm", asyncHandler(controller.confirmDayPlanning));
router.post("/:id/days/:date/premium-overage/payments", asyncHandler(controller.createPremiumOverageDayPayment));
router.post("/:id/days/:date/premium-overage/payments/:paymentId/verify", asyncHandler(controller.verifyPremiumOverageDayPayment));
router.post("/:id/days/:date/one-time-addons/payments", asyncHandler(controller.createOneTimeAddonDayPlanningPayment));
router.post("/:id/days/:date/one-time-addons/payments/:paymentId/verify", asyncHandler(controller.verifyOneTimeAddonDayPlanningPayment));
/**
 * @openapi
 * /subscriptions/{id}/days/skip:
 *   post:
 *     summary: Skip a day
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date]
 *             properties:
 *               date:
 *                 type: string
 *                 example: 2026-04-10
 *     responses:
 *       200:
 *         description: Day skipped
 */
router.post("/:id/days/skip", asyncHandler(controller.skipDay));
router.post("/:id/days/:date/skip", asyncHandler(controller.skipDay));
router.post("/:id/days/:date/unskip", asyncHandler(controller.unskipDay));
/**
 * @openapi
 * /subscriptions/{id}/skip-range:
 *   post:
 *     summary: Skip a range of days
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               startDate:
 *                 type: string
 *               days:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Range skip summary
 */
router.post("/:id/skip-range", authMiddleware, asyncHandler(controller.skipRange));
/**
 * @openapi
 * /subscriptions/{id}/days/{date}/pickup/prepare:
 *   post:
 *     summary: Prepare pickup for a day
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *       - name: date
 *         in: path
 *         required: true
 *     responses:
 *       200:
 *         description: Pickup prepared
 */
router.post("/:id/days/:date/pickup/prepare", asyncHandler(controller.preparePickup));
/**
 * @openapi
 * /subscriptions/{id}/days/{date}/custom-salad:
 *   post:
 *     summary: Purchase a custom salad for a subscription day
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: date
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
 *             properties:
 *               ingredients:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     ingredientId:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Custom salad added to day
 */
router.post("/:id/days/:date/custom-salad", asyncHandler(customSaladController.addCustomSaladToSubscriptionDay));
router.post("/:id/days/:date/custom-meal", asyncHandler(customMealController.addCustomMealToSubscriptionDay));
router.put("/:id/days/:date/delivery", asyncHandler(controller.updateDeliveryDetailsForDate));
router.post("/:id/premium/topup", asyncHandler(controller.topupPremium));
router.post("/:id/premium-credits/topup", asyncHandler(controller.topupPremiumCredits));
router.post("/:id/addon-credits/topup", asyncHandler(controller.topupAddonCredits));
router.post("/:id/premium-selections", asyncHandler(controller.consumePremiumSelection));
router.delete("/:id/premium-selections", asyncHandler(controller.removePremiumSelection));
router.post("/:id/addon-selections", asyncHandler(controller.consumeAddonSelection));
router.delete("/:id/addon-selections", asyncHandler(controller.removeAddonSelection));
router.post("/:id/addons/one-time", asyncHandler(controller.addOneTimeAddon));
router.put("/:id/delivery", asyncHandler(controller.updateDeliveryDetails));

module.exports = router;
