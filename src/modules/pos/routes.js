"use strict";
// Phase 0 deliberately has NO selling, payment, refund, shift mutation routes.
const { Router } = require("express");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../../middleware/dashboardAuth");
const { getPosReadiness } = require("./readiness");
const router = Router();
router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["cashier", "restaurant", "admin"]));
router.get("/health", async (_req, res) => {
  const result = await getPosReadiness();
  return res.status(result.ready ? 200 : 503).json({
    ok: result.ready, code: result.code, salesEnabled: false,
  });
});
module.exports = router;
