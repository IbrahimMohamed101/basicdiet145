const { Router } = require("express");
const { authMiddleware } = require("../middleware/auth");
const { getClientProfile } = require("../controllers/clientProfileController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

/**
 * @openapi
 * /client/profile:
 *   get:
 *     summary: Get client profile data
 *     tags: [Client]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Client profile data
 *       401:
 *         description: Unauthorized
 */
router.get("/profile", authMiddleware, asyncHandler(getClientProfile));

module.exports = router;
