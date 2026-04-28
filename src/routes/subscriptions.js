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
/**
 * @openapi
 * /subscriptions/meal-planner-menu:
 *   get:
 *     summary: Get meal planner catalog (proteins, carbs, categories)
 *     tags: [Subscriptions]
 *     responses:
 *       200:
 *         description: Meal planner catalog
 */
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
 *                   required: [proteinId, qty]
 *                   properties:
 *                     proteinId:
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

const ENABLE_DEV_SUBSCRIPTION_ACTIVATION = process.env.ENABLE_DEV_SUBSCRIPTION_ACTIVATION === "true";

if (ENABLE_DEV_SUBSCRIPTION_ACTIVATION) {
  router.post("/:id/activate", asyncHandler(controller.activateSubscription));
}
router.get("/:id/renewal-seed", asyncHandler(controller.getSubscriptionRenewalSeed));
router.post("/:id/renew", asyncHandler(controller.renewSubscription));
router.get("/:id", asyncHandler(controller.getSubscription));
router.get("/:id/operations-meta", asyncHandler(controller.getSubscriptionOperationsMeta));
router.get("/:id/freeze-preview", asyncHandler(controller.getSubscriptionFreezePreview));
router.post("/:id/cancel", asyncHandler(controller.cancelSubscription));
/**
 * @openapi
 * /subscriptions/{id}/timeline:
 *   get:
 *     summary: Get the subscription timeline calendar
 *     tags: [Subscriptions]
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
 *         description: Timeline retrieved successfully
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
 *                     subscriptionId:
 *                       type: string
 *                     dailyMealsRequired:
 *                       type: integer
 *                     premiumMealsRemaining:
 *                       type: integer
 *                     premiumMealsSelected:
 *                       type: integer
 *                     premiumBalanceBreakdown:
 *                       type: array
 *                       items:
 *                         type: object
 *                     days:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           date:
 *                             type: string
 *                             format: date
 *                           day:
 *                             type: string
 *                           month:
 *                             type: string
 *                           dayNumber:
 *                             type: integer
 *                           status:
 *                             type: string
 *                             enum: [open, planned, locked, delivered, delivery_canceled, canceled_at_branch, no_show, frozen, skipped, extension]
 *                           statusLabel:
 *                             type: string
 *                           selectedMeals:
 *                             type: integer
 *                           requiredMeals:
 *                             type: integer
 *                           commercialState:
 *                             type: string
 *                             enum: [draft, payment_required, ready_to_confirm, confirmed]
 *                           commercialStateLabel:
 *                             type: string
 *                           isFulfillable:
 *                             type: boolean
 *                           canBePrepared:
 *                             type: boolean
 *                           fulfillmentMode:
 *                             type: string
 *                           consumptionState:
 *                             type: string
 *                           requiredMealCount:
 *                             type: integer
 *                           specifiedMealCount:
 *                             type: integer
 *                           unspecifiedMealCount:
 *                             type: integer
 *                           hasCustomerSelections:
 *                             type: boolean
 *                           planningReady:
 *                             type: boolean
 *                           fulfillmentReady:
 *                             type: boolean
 *                           paymentRequirement:
 *                             type: object
 *                             nullable: true
 *                           selectedMealIds:
 *                             type: array
 *                             items:
 *                               type: string
 *                           mealSlots:
 *                             type: array
 *                             items:
 *                               type: object
 *       400:
 *         description: Invalid subscription id
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Subscription not found
 */
router.get("/:id/timeline", asyncHandler(controller.getSubscriptionTimeline));
router.post("/:id/freeze", asyncHandler(controller.freezeSubscription));
router.post("/:id/unfreeze", asyncHandler(controller.unfreezeSubscription));
router.get("/:id/days", authMiddleware, asyncHandler(controller.getSubscriptionDays));
router.get("/:id/today", asyncHandler(controller.getSubscriptionToday));
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
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Pickup prepared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     subscriptionId:
 *                       type: string
 *                     date:
 *                       type: string
 *                     currentStep:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     statusLabel:
 *                       type: string
 *                     message:
 *                       type: string
 *                     pickupRequested:
 *                       type: boolean
 *                     nextAction:
 *                       type: string
 *       400:
 *         description: Invalid pickup prepare request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       enum: [INVALID_DATE, INVALID, RESTAURANT_CLOSED]
 *                     message:
 *                       type: string
 *       409:
 *         description: Pickup cannot be requested because the day is no longer requestable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       enum: [DAY_SKIPPED, DAY_FROZEN, PICKUP_ALREADY_REQUESTED, PICKUP_ALREADY_COMPLETED, PICKUP_ALREADY_CLOSED, DAY_ALREADY_CONSUMED, LOCKED]
 *                     message:
 *                       type: string
 *       422:
 *         description: Subscription inactive, expired, invalid planning, or insufficient credits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       enum: [SUB_INACTIVE, SUB_EXPIRED, PLANNING_INCOMPLETE, PREMIUM_OVERAGE_PAYMENT_REQUIRED, PREMIUM_PAYMENT_REQUIRED, ONE_TIME_ADDON_PAYMENT_REQUIRED, PLANNER_UNCONFIRMED, INSUFFICIENT_CREDITS]
 *                     message:
 *                       type: string
 */
router.post("/:id/days/:date/pickup/prepare", asyncHandler(controller.preparePickup));

/**
 * @openapi
 * /subscriptions/{id}/days/{date}/pickup/status:
 *   get:
 *     summary: Get pickup status for a day
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
 *           format: date
 *     responses:
 *       200:
 *         description: Pickup status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     subscriptionId:
 *                       type: string
 *                     date:
 *                       type: string
 *                     currentStep:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     statusLabel:
 *                       type: string
 *                     message:
 *                       type: string
 *                     canModify:
 *                       type: boolean
 *                     isReady:
 *                       type: boolean
 *                     isCompleted:
 *                       type: boolean
 *                     pickupCode:
 *                       type: string
 *                       nullable: true
 *                     pickupCodeIssuedAt:
 *                       type: string
 *                       nullable: true
 *                     fulfilledAt:
 *                       type: string
 *                       nullable: true
 *                     pickupRequested:
 *                       type: boolean
 *                     pickupPrepared:
 *                       type: boolean
 *                     pickupPreparationFlowStatus:
 *                       type: string
 *                     consumptionState:
 *                       type: string
 *                     fulfillmentMode:
 *                       type: string
 *                     dayEndConsumptionReason:
 *                       type: string
 *                       nullable: true
 *                     canRequestPrepare:
 *                       type: boolean
 *                     requestBlockedReason:
 *                       type: string
 *                       nullable: true
 *                       description: Present when a new pickup prepare request is currently blocked
 *                     requestBlockedMessage:
 *                       type: string
 *                       nullable: true
 *                     restaurantHours:
 *                       type: object
 *                       properties:
 *                         openTime:
 *                           type: string
 *                           example: 10:00
 *                         closeTime:
 *                           type: string
 *                           example: 23:00
 *                         isOpenNow:
 *                           type: boolean
 */
router.get("/:id/days/:date/pickup/status", asyncHandler(controller.getPickupStatus));

/**
 * @openapi
 * /subscriptions/{id}/days/{date}:
 *   get:
 *     summary: Get subscription day details including planner view
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
 *         description: Day details with mealSlots, plannerMeta, and rules
 */
router.get("/:id/days/:date", asyncHandler(controller.getSubscriptionDay));
/**
 * @openapi
 * /subscriptions/{id}/days/selections/bulk:
 *   put:
 *     summary: Bulk update canonical meal planner selections for multiple dates
 *     tags: [Subscriptions]
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
 *             oneOf:
 *               - type: object
 *                 required: [dates, mealSlots]
 *                 properties:
 *                   dates:
 *                     type: array
 *                     items:
 *                       type: string
 *                       example: 2026-04-15
 *                   mealSlots:
 *                     type: array
 *                     items:
 *                       $ref: '#/components/schemas/MealSlot'
 *                   addonsOneTime:
 *                     type: array
 *                     items:
 *                       type: string
 *               - type: object
 *                 required: [days]
 *                 properties:
 *                   days:
 *                     type: array
 *                     items:
 *                       type: object
 *                       required: [date, mealSlots]
 *                       properties:
 *                         date:
 *                           type: string
 *                           example: 2026-04-15
 *                         mealSlots:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/MealSlot'
 *                         addonsOneTime:
 *                           type: array
 *                           items:
 *                             type: string
 *     responses:
 *       200:
 *         description: Bulk day selections processed
 *       422:
 *         description: Legacy bulk payloads without canonical mealSlots are rejected per date
 */
router.put("/:id/days/selections/bulk", asyncHandler(controller.updateBulkDaySelections));

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
/**
 * @openapi
 * /subscriptions/{id}/days/{date}/selection:
 *   put:
 *     summary: Update day selections (Slot-based)
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mealSlots:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/MealSlot'
 *     responses:
 *       200:
 *         description: Updated selections
 */
router.put("/:id/days/:date/selection", asyncHandler(controller.updateDaySelection));

/**
 * @openapi
 * /subscriptions/{id}/days/{date}/selection/validate:
 *   post:
 *     summary: Validate day selections without saving
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mealSlots:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/MealSlot'
 *     responses:
 *       200:
 *         description: Validation result
 *       422:
 *         description: Validation errors (e.g. beef limit)
 */
router.post("/:id/days/:date/selection/validate", asyncHandler(controller.validateDaySelection));

/**
 * @openapi
 * /subscriptions/{id}/days/{date}/confirm:
 *   post:
 *     summary: Finalize and confirm day planning
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
 *         description: Day confirmed
 *       422:
 *         description: Cannot confirm (incomplete or beef violation)
 */
router.post("/:id/days/:date/confirm", asyncHandler(controller.confirmDayPlanning));

/**
 * @openapi
 * /subscriptions/{id}/days/{date}/premium-extra/payments:
 *   post:
 *     summary: Create premium extra payment for a planner day
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
 *       201:
 *         description: Premium extra payment created
 *       200:
 *         description: Existing reusable initiated payment returned
 */
router.post("/:id/days/:date/premium-extra/payments", asyncHandler(controller.createPremiumExtraDayPayment));

/**
 * @openapi
 * /subscriptions/{id}/days/{date}/premium-extra/payments/{paymentId}/verify:
 *   post:
 *     summary: Verify premium extra payment and settle planner slots
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
 *       - name: paymentId
 *         in: path
 *         required: true
 *     responses:
 *       200:
 *         description: Premium extra payment status returned and planner synchronized when paid
 */
router.post("/:id/days/:date/premium-extra/payments/:paymentId/verify", asyncHandler(controller.verifyPremiumExtraDayPayment));

router.post("/:id/days/:date/one-time-addons/payments", asyncHandler(controller.createOneTimeAddonDayPlanningPayment));
router.post("/:id/days/:date/one-time-addons/payments/verify", asyncHandler(controller.verifyOneTimeAddonDayPlanningPayment));
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

/**
 * @openapi
 * /subscriptions/{id}/addon-selections:
 *   post:
 *     summary: Legacy convenience wrapper to update one-time day addons over canonical planner state
 *     tags: [Subscriptions]
 *     deprecated: true
 *     responses:
 *       422:
 *         description: Clients must submit canonical mealSlots via /subscriptions/{id}/days/{date}/selection
 *   delete:
 *     summary: Legacy convenience wrapper to remove one-time day addons over canonical planner state
 *     tags: [Subscriptions]
 *     deprecated: true
 *     responses:
 *       422:
 *         description: Clients must submit canonical mealSlots via /subscriptions/{id}/days/{date}/selection
 */
router.post("/:id/addon-selections", asyncHandler(controller.consumeAddonSelection));
router.delete("/:id/addon-selections", asyncHandler(controller.removeAddonSelection));

/**
 * @openapi
 * /subscriptions/{id}/premium-selections:
 *   post:
 *     summary: Deprecated legacy premium helper endpoint
 *     tags: [Subscriptions]
 *     deprecated: true
 *     responses:
 *       422:
 *         description: Clients must submit canonical mealSlots via /subscriptions/{id}/days/{date}/selection
 *   delete:
 *     summary: Deprecated legacy premium helper endpoint
 *     tags: [Subscriptions]
 *     deprecated: true
 *     responses:
 *       422:
 *         description: Clients must submit canonical mealSlots via /subscriptions/{id}/days/{date}/selection
 */
router.post("/:id/premium-selections", asyncHandler(controller.consumePremiumSelection));
router.delete("/:id/premium-selections", asyncHandler(controller.removePremiumSelection));
router.post("/:id/addons/one-time", asyncHandler(controller.addOneTimeAddon));
router.put("/:id/delivery", asyncHandler(controller.updateDeliveryDetails));

module.exports = router;
