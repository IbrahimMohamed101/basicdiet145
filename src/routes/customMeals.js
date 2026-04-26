const { Router } = require("express");
const controller = require("../controllers/customMealController");
const { authMiddleware } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.use(authMiddleware);

router.post("/price", asyncHandler(controller.previewCustomMealPrice));

module.exports = router;
