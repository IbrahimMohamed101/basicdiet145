const { Router } = require("express");

const controller = require("../controllers/dashboard/menuController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin", "superadmin"]));

router.get("/categories", asyncHandler(controller.listCategories));
router.post("/categories", asyncHandler(controller.createCategory));
router.patch("/categories/reorder", asyncHandler(controller.reorderCategories));
router.get("/categories/:id", asyncHandler(controller.getCategory));
router.patch("/categories/:id", asyncHandler(controller.updateCategory));
router.delete("/categories/:id", asyncHandler(controller.deleteCategory));

router.get("/products", asyncHandler(controller.listProducts));
router.post("/products", asyncHandler(controller.createProduct));
router.patch("/products/reorder", asyncHandler(controller.reorderProducts));
router.get("/products/:id", asyncHandler(controller.getProduct));
router.patch("/products/:id", asyncHandler(controller.updateProduct));
router.delete("/products/:id", asyncHandler(controller.deleteProduct));
router.put("/products/:productId/groups", asyncHandler(controller.setProductGroups));
router.put("/products/:productId/groups/:groupId/options", asyncHandler(controller.setProductGroupOptions));
router.patch("/products/:productId/availability", asyncHandler(controller.updateProductAvailability));

router.get("/option-groups", asyncHandler(controller.listOptionGroups));
router.post("/option-groups", asyncHandler(controller.createOptionGroup));
router.get("/option-groups/:id", asyncHandler(controller.getOptionGroup));
router.patch("/option-groups/:id", asyncHandler(controller.updateOptionGroup));
router.delete("/option-groups/:id", asyncHandler(controller.deleteOptionGroup));

router.get("/options", asyncHandler(controller.listOptions));
router.post("/options", asyncHandler(controller.createOption));
router.get("/options/:id", asyncHandler(controller.getOption));
router.patch("/options/:id", asyncHandler(controller.updateOption));
router.delete("/options/:id", asyncHandler(controller.deleteOption));

router.post("/publish", asyncHandler(controller.publishMenu));
router.get("/audit-logs", asyncHandler(controller.listAuditLogs));

module.exports = router;
