const { Router } = require("express");
const controller = require("../controllers/webhookController");

const router = Router();

// Moyasar webhook (public, should use secret validation in production)
/**
 * @openapi
 * /webhooks/moyasar:
 *   post:
 *     summary: Moyasar webhook
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post("/moyasar", controller.handleMoyasarWebhook);

module.exports = router;
