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
router.get("/catalog", asyncHandler(controller.getCatalog));
router.get("/published", asyncHandler(controller.getPublished));
router.get("/draft", asyncHandler(controller.openDraft));
router.get("/draft/hydrated", asyncHandler(controller.getHydratedDraft));
router.post("/draft", asyncHandler(controller.createDraft));
router.post("/draft/reset", asyncHandler(controller.resetDraft));
router.put("/draft", asyncHandler(controller.updateDraft));
router.get("/pickers/:sectionKey", asyncHandler(controller.getPicker));
router.post("/sections", asyncHandler(controller.createSection));
router.patch("/sections/:sectionKey", asyncHandler(controller.updateSection));
router.delete("/sections/:sectionKey", asyncHandler(controller.deleteSection));
router.post(
  "/sections/:sectionKey/products",
  asyncHandler(controller.addProducts)
);
router.delete(
  "/sections/:sectionKey/products/:productId",
  asyncHandler(controller.removeProduct)
);
router.post("/validate", asyncHandler(controller.validateDraft));
router.post("/publish", asyncHandler(controller.publishDraft));
router.get("/readiness", asyncHandler(controller.getReadiness));

module.exports = router;
