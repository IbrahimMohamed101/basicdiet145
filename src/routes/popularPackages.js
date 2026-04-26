const { Router } = require("express");
const { listPopularPackages } = require("../controllers/popularPackageController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

/**
 * @openapi
 * /api/popular_packages:
 *   get:
 *     tags: [Plans]
 *     summary: Get popular packages
 *     description: Returns up to three active plans from the database, each mapped to its first active grams and meals option so it can be used directly for subscription checkout.
 *     responses:
 *       200:
 *         description: Popular packages list.
 */
router.get("/", asyncHandler(listPopularPackages));

module.exports = router;
