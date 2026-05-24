const { Router } = require("express");

const controller = require("../controllers/dashboard/menuController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin", "superadmin"]));

router.get("/categories", asyncHandler(controller.listCategories));
router.post("/categories", asyncHandler(controller.createCategory));
router.get("/categories/:id", asyncHandler(controller.getCategory));
router.patch("/categories/:id", asyncHandler(controller.updateCategory));
router.patch("/categories/:id/visibility", asyncHandler(controller.updateCategoryVisibility));
router.patch("/categories/:id/availability", asyncHandler(controller.updateCategoryAvailability));
router.delete("/categories/:id", dashboardRoleMiddleware(["admin", "superadmin"]), asyncHandler(controller.deleteCategory));
router.patch("/categories/reorder", asyncHandler(controller.reorderCategories));

router.get("/products", asyncHandler(controller.listProducts));
router.post("/products", asyncHandler(controller.createProduct));
router.patch("/products/reorder", asyncHandler(controller.reorderProducts));
router.post("/products/:id/duplicate", asyncHandler(controller.duplicateProduct));
router.patch("/products/:id/category", asyncHandler(controller.updateProduct)); // Already handles categoryId in normalizeProductPayload
router.get("/products/:productId/option-groups", asyncHandler(controller.listProductGroups));
router.post("/products/:productId/option-groups", asyncHandler(controller.createProductGroup));
router.patch("/products/:productId/option-groups/:groupId", asyncHandler(controller.updateProductGroup));
router.patch("/products/:productId/option-groups/:groupId/selection-rules", asyncHandler(controller.updateProductGroupSelectionRules));
router.patch("/products/:productId/option-groups/:groupId/visibility", asyncHandler(controller.updateProductGroupVisibility));
router.patch("/products/:productId/option-groups/:groupId/availability", asyncHandler(controller.updateProductGroupAvailability));
router.delete("/products/:productId/option-groups/:groupId", asyncHandler(controller.deleteProductGroup));
router.get("/products/:productId/option-groups/:groupId/options", asyncHandler(controller.listProductGroupOptions));
router.post("/products/:productId/option-groups/:groupId/options", asyncHandler(controller.createProductGroupOption));
router.patch("/products/:productId/option-groups/:groupId/options/:optionId", asyncHandler(controller.updateProductGroupOption));
router.patch("/products/:productId/option-groups/:groupId/options/:optionId/visibility", asyncHandler(controller.updateProductGroupOptionVisibility));
router.patch("/products/:productId/option-groups/:groupId/options/:optionId/availability", asyncHandler(controller.updateProductGroupOptionAvailability));
router.delete("/products/:productId/option-groups/:groupId/options/:optionId", asyncHandler(controller.deleteProductGroupOption));
router.get("/products/:id", asyncHandler(controller.getProduct));
router.patch("/products/:id", asyncHandler(controller.updateProduct));
router.patch("/products/:id/visibility", asyncHandler(controller.updateProductVisibility));
router.delete("/products/:id", dashboardRoleMiddleware(["admin", "superadmin"]), asyncHandler(controller.deleteProduct));
router.put("/products/:productId/groups", asyncHandler(controller.setProductGroups));
router.put("/products/:productId/groups/:groupId/options", asyncHandler(controller.setProductGroupOptions));
router.patch("/products/:productId/availability", asyncHandler(controller.updateProductAvailability));

router.get("/option-groups", asyncHandler(controller.listOptionGroups));
router.post("/option-groups", asyncHandler(controller.createOptionGroup));
router.patch("/option-groups/reorder", asyncHandler(controller.reorderOptionGroups));
router.get("/option-groups/:groupId/options", asyncHandler(controller.listOptionsByGroup));
router.post("/option-groups/:groupId/options", asyncHandler(controller.createOptionForGroup));
router.get("/option-groups/:id", asyncHandler(controller.getOptionGroup));
router.patch("/option-groups/:id", asyncHandler(controller.updateOptionGroup));
router.patch("/option-groups/:id/visibility", asyncHandler(controller.updateOptionGroupVisibility));
router.patch("/option-groups/:id/availability", asyncHandler(controller.updateOptionGroupAvailability));
router.delete("/option-groups/:id", asyncHandler(controller.deleteOptionGroup));

router.get("/options", asyncHandler(controller.listOptions));
router.post("/options", asyncHandler(controller.createOption));
router.patch("/options/reorder", asyncHandler(controller.reorderOptions));
router.get("/options/:id", asyncHandler(controller.getOption));
router.patch("/options/:id", asyncHandler(controller.updateOption));
router.patch("/options/:id/visibility", asyncHandler(controller.updateOptionVisibility));
router.patch("/options/:id/availability", asyncHandler(controller.updateOptionAvailability));
router.delete("/options/:id", asyncHandler(controller.deleteOption));
router.patch("/options/:id/toggle", asyncHandler(controller.toggleOption));

router.post("/publish", asyncHandler(controller.publishMenu));
router.get("/versions", asyncHandler(controller.listVersions));
router.post("/rollback/:versionId", dashboardRoleMiddleware(["admin", "superadmin"]), asyncHandler(controller.rollbackMenu));
router.get("/diff", asyncHandler(controller.getDiff));
router.post("/validate", asyncHandler(controller.validateMenu));
router.get("/audit-logs", asyncHandler(controller.listAuditLogs));

module.exports = router;
