const { Router } = require("express");
const { listPlans, getPlan } = require("../controllers/planController");
const optionalAuthMiddleware = require("../middleware/optionalAuth");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.get("/", optionalAuthMiddleware, asyncHandler(listPlans));
router.get("/:id", optionalAuthMiddleware, asyncHandler(getPlan));

module.exports = router;
