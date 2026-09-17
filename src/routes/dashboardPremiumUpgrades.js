const { Router } = require("express");

const controller = require("../controllers/dashboard/premiumUpgradeController");
const asyncHandler = require("../middleware/asyncHandler");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
  dashboardMutationRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

// Protect all routes with dashboard authentication. Read routes are available
// to dashboard read roles; restaurant staff may also author Premium upgrades.
router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin", "superadmin", "kitchen"]));

router.get("/", asyncHandler(controller.getConfigs));
router.get("/sources", asyncHandler(controller.getSources));
router.get("/candidates", asyncHandler(controller.getCandidates));
router.get("/readiness", asyncHandler(controller.getReadiness));
router.get("/:id", asyncHandler(controller.getConfigDetail));

router.post("/", dashboardMutationRoleMiddleware(["admin", "superadmin", "restaurant"]), asyncHandler(controller.createConfig));
router.patch("/:id", dashboardMutationRoleMiddleware(["admin", "superadmin", "restaurant"]), asyncHandler(controller.updateConfig));
router.patch("/:id/state", dashboardMutationRoleMiddleware(["admin", "superadmin", "restaurant"]), asyncHandler(controller.updateConfigState));
router.post("/:id/archive", dashboardMutationRoleMiddleware(["admin", "superadmin", "restaurant"]), asyncHandler(controller.archiveConfig));

module.exports = router;
