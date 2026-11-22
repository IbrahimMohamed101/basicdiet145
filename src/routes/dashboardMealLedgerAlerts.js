const { Router } = require("express");
const controller = require("../controllers/dashboard/mealLedgerAlertController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

// Everyone who opens the dashboard sees pending alerts; verifying one needs a
// branch operator or admin. Running a scan on demand is admin only.
const READ_ROLES = ["admin", "restaurant", "cashier", "kitchen"];
const VERIFY_ROLES = ["admin", "restaurant", "cashier"];

router.get("/summary", dashboardAuthMiddleware, dashboardRoleMiddleware(READ_ROLES), asyncHandler(controller.getSummary));
router.get("/", dashboardAuthMiddleware, dashboardRoleMiddleware(READ_ROLES), asyncHandler(controller.listAlerts));
router.post("/scan", dashboardAuthMiddleware, dashboardRoleMiddleware(["admin"]), asyncHandler(controller.scanNow));
router.post("/:id/acknowledge", dashboardAuthMiddleware, dashboardRoleMiddleware(VERIFY_ROLES), asyncHandler(controller.acknowledge));

router.ROLE_POLICY = Object.freeze({ READ_ROLES, VERIFY_ROLES, SCAN_ROLES: ["admin"] });

module.exports = router;
