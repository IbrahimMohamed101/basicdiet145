const { Router } = require("express");

const asyncHandler = require("../middleware/asyncHandler");
const contentController = require("../controllers/contentController");

const router = Router();

/**
 * @openapi
 * /content/terms/subscription:
 *   get:
 *     summary: Get the active subscription terms and conditions
 *     tags: [Content]
 *     parameters:
 *       - in: query
 *         name: locale
 *         schema:
 *           type: string
 *           example: ar
 *         description: Locale of the requested active content. Defaults to `ar`.
 *     responses:
 *       200:
 *         description: Active subscription terms
 *       404:
 *         description: Active content not found
 */
router.get("/terms/subscription", asyncHandler(contentController.getSubscriptionTerms));

module.exports = router;
