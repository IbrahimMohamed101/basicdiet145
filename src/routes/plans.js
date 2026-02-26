const { Router } = require("express");
const { listPlans, getPlan } = require("../controllers/planController");
const { authMiddleware } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.use(authMiddleware);

router.get("/", asyncHandler(listPlans));
router.get("/:id", asyncHandler(getPlan));

module.exports = router;
