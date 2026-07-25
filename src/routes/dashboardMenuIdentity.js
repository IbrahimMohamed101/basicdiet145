const { Router } = require("express");
const menuIdentityController = require("../controllers/dashboard/menuIdentityController");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

// Dashboard-only menu identity endpoints. Restaurant staff may review and
// resolve catalog identity suggestions as part of day-to-day menu management.
router.use(dashboardAuthMiddleware);
router.use(dashboardRoleMiddleware(["admin", "restaurant"])); // superadmin also allowed via middleware logic

router.get("/menu-identities", menuIdentityController.listMenuIdentities);
router.get("/menu-identities/:id", menuIdentityController.getMenuIdentity);
router.get("/menu-identities/:id/links", menuIdentityController.getMenuIdentityLinks);
router.get("/menu-identity-links", menuIdentityController.listMenuIdentityLinks);

// Suggested mappings and approval workflow
router.get("/menu-identity-suggestions", menuIdentityController.listSuggestions);
router.get("/menu-identity-suggestions/:id", menuIdentityController.getSuggestion);
router.post("/menu-identity-suggestions/:id/approve", menuIdentityController.approveSuggestion);
router.post("/menu-identity-suggestions/:id/reject", menuIdentityController.rejectSuggestion);

module.exports = router;
