const { Router } = require("express");

const controller = require("../controllers/dashboard/catalogItemController");
const asyncHandler = require("../middleware/asyncHandler");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
  dashboardMutationRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin", "superadmin", "kitchen"]));

router.use(dashboardMutationRoleMiddleware(["admin", "superadmin"]));

router.get("/", asyncHandler(controller.listCatalogItems));
router.post("/", asyncHandler(controller.createCatalogItem));
router.get("/:id", asyncHandler(controller.getCatalogItem));
router.patch("/:id", asyncHandler(controller.updateCatalogItem));

module.exports = router;
