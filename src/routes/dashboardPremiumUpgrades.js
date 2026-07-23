const { Router } = require("express");

const controller = require("../controllers/dashboard/premiumUpgradeController");
const asyncHandler = require("../middleware/asyncHandler");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
  dashboardMutationRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

// Read routes are available to branch fulfillment roles; mutation routes stay
// admin/superadmin only.
router.use(
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "superadmin", "restaurant", "kitchen"])
);

router.get("/", asyncHandler(controller.getConfigs));
router.get("/sources", asyncHandler(controller.getSources));
router.get("/candidates", asyncHandler(controller.getCandidates));
router.get("/readiness", asyncHandler(controller.getReadiness));
router.get("/:id", asyncHandler(controller.getConfigDetail));

router.post("/", dashboardMutationRoleMiddleware(["admin", "superadmin"]), asyncHandler(controller.createConfig));
router.patch("/:id", dashboardMutationRoleMiddleware(["admin", "superadmin"]), asyncHandler(controller.updateConfig));
router.patch("/:id/state", dashboardMutationRoleMiddleware(["admin", "superadmin"]), asyncHandler(controller.updateConfigState));
router.post("/:id/archive", dashboardMutationRoleMiddleware(["admin", "superadmin"]), asyncHandler(controller.archiveConfig));

module.exports = router;
