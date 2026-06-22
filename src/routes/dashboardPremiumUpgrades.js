const { Router } = require("express");

const controller = require("../controllers/dashboard/premiumUpgradeController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

// Protect all routes with dashboard authentication and admin/superadmin roles
router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin", "superadmin"]));

// Phase 1/2: Expose read, candidates, and readiness
router.get("/", asyncHandler(controller.getConfigs));
router.get("/candidates", asyncHandler(controller.getCandidates));
router.get("/readiness", asyncHandler(controller.getReadiness));

// Phase 2: Mutation endpoints
router.post("/", asyncHandler(controller.createConfig));
router.patch("/:id", asyncHandler(controller.updateConfig));
router.patch("/:id/state", asyncHandler(controller.updateConfigState));
router.post("/:id/archive", asyncHandler(controller.archiveConfig));

module.exports = router;
