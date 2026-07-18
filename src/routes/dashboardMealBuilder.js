const { Router } = require("express");

const controller = require("../controllers/dashboard/mealBuilderController");
const asyncHandler = require("../middleware/asyncHandler");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

router.use(
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "superadmin"])
);

router.get("/", asyncHandler(controller.getMealBuilder));
router.get("/published", asyncHandler(controller.getPublished));
router.get("/draft", asyncHandler(controller.openDraft));
router.get("/draft/hydrated", asyncHandler(controller.getHydratedDraft));
router.post("/draft", asyncHandler(controller.createDraft));
router.post("/draft/reset", asyncHandler(controller.resetDraft));
router.put("/draft", asyncHandler(controller.updateDraft));
router.get("/pickers/:sectionKey", asyncHandler(controller.getPicker));
router.post("/validate", asyncHandler(controller.validateDraft));
router.post("/publish", asyncHandler(controller.publishDraft));
router.get("/readiness", asyncHandler(controller.getReadiness));

module.exports = router;
