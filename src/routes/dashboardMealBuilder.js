const { Router } = require("express");

const controller = require("../controllers/dashboard/mealBuilderController");
const asyncHandler = require("../middleware/asyncHandler");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();
const readRoles = dashboardRoleMiddleware(["admin", "superadmin", "restaurant", "kitchen"]);
const authorRoles = dashboardRoleMiddleware(["admin", "superadmin"]);

router.use(dashboardAuthMiddleware);

// Restaurant/kitchen can inspect the published contract and picker catalog used
// for fulfillment. Draft creation and every authoring action remain admin-only.
router.get("/", readRoles, asyncHandler(controller.getMealBuilder));
router.get("/catalog", readRoles, asyncHandler(controller.getCatalog));
router.get("/published", readRoles, asyncHandler(controller.getPublished));
router.get("/pickers/:sectionKey", readRoles, asyncHandler(controller.getPicker));
router.get("/readiness", readRoles, asyncHandler(controller.getReadiness));

router.get("/draft", authorRoles, asyncHandler(controller.openDraft));
router.get("/draft/hydrated", authorRoles, asyncHandler(controller.getHydratedDraft));
router.post("/draft", authorRoles, asyncHandler(controller.createDraft));
router.post("/draft/reset", authorRoles, asyncHandler(controller.resetDraft));
router.put("/draft", authorRoles, asyncHandler(controller.updateDraft));
router.post("/sections", authorRoles, asyncHandler(controller.createSection));
router.patch("/sections/:sectionKey", authorRoles, asyncHandler(controller.updateSection));
router.delete("/sections/:sectionKey", authorRoles, asyncHandler(controller.deleteSection));
router.put(
  "/sections/:sectionKey/items",
  authorRoles,
  asyncHandler(controller.replaceItems)
);
router.post(
  "/sections/:sectionKey/products",
  authorRoles,
  asyncHandler(controller.addProducts)
);
router.delete(
  "/sections/:sectionKey/products/:productId",
  authorRoles,
  asyncHandler(controller.removeProduct)
);
router.post(
  "/sections/:sectionKey/options",
  authorRoles,
  asyncHandler(controller.addOptions)
);
router.delete(
  "/sections/:sectionKey/options/:optionId",
  authorRoles,
  asyncHandler(controller.removeOption)
);
router.post("/validate", authorRoles, asyncHandler(controller.validateDraft));
router.post("/publish", authorRoles, asyncHandler(controller.publishDraft));

module.exports = router;
