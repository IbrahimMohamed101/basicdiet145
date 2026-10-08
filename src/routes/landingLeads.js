"use strict";
const { Router } = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const service = require("../services/landingLeadService");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const publicRouter = Router(), adminRouter = Router();
const intakeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false });
function isTrustedLanding(req) {
  const key = process.env.LANDING_ANALYTICS_INGEST_SECRET || "";
  const supplied = req.get("x-landing-analytics-key") || "";
  return key.length > 0 && supplied.length === key.length
    && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(supplied));
}
publicRouter.get("/options", async (_req, res, next) => {
  try {
    const data = await service.getAvailableOptions();
    res.set("Cache-Control", "public, max-age=60");
    return res.json({ status: true, data });
  } catch (e) { return next(e); }
});
publicRouter.post("/leads", intakeLimiter, async (req, res, next) => {
  if (!isTrustedLanding(req)) return res.status(401).json({ status: false, error: { code: "UNAUTHORIZED" } });
  if (JSON.stringify(req.body || {}).length > 2048) return res.status(413).json({ status: false, error: { code: "REQUEST_TOO_LARGE" } });
  try {
    const result = await service.submitLead(req.body);
    res.set("Cache-Control", "no-store");
    if (!result.ok) return res.status(result.status).json({ status: false, error: { code: result.code } });
    return res.status(202).json({ status: true }); // no PII or existence oracle
  } catch (e) { return next(e); }
});
adminRouter.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin", "restaurant"]));
adminRouter.get("/", async (req, res, next) => {
  try {
    const result = await service.listLeads(req.query);
    if (!result.ok) return res.status(result.status).json({ status: false, error: { code: result.code } });
    res.set("Cache-Control", "no-store");
    return res.json({ status: true, data: result.data });
  } catch (e) { return next(e); }
});
adminRouter.patch("/:id", async (req, res, next) => {
  try {
    const result = await service.updateLead(req.params.id, req.body, req.dashboardUserId);
    if (!result.ok) return res.status(result.status).json({ status: false, error: { code: result.code } });
    res.set("Cache-Control", "no-store");
    return res.json({ status: true, data: result.data });
  } catch (e) { return next(e); }
});
module.exports = { publicRouter, adminRouter, isTrustedLanding };
