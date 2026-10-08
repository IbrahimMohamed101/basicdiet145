"use strict";
const { Router } = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { recordEvent, buildLandingAnalyticsReport } = require("../services/landingAnalyticsService");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20000, standardHeaders: "draft-7", legacyHeaders: false });
function hasValidIngestSecret(req) {
  const expected = process.env.LANDING_ANALYTICS_INGEST_SECRET || "";
  const actual = req.get("x-landing-analytics-key") || "";
  if (!expected || !actual || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
router.post("/events", limiter, async (req, res, next) => {
  if (!hasValidIngestSecret(req)) return res.status(401).json({ status: false, error: { code: "UNAUTHORIZED" } });
  if (JSON.stringify(req.body || {}).length > 2048) return res.status(413).json({ status: false, error: { code: "EVENT_TOO_LARGE" } });
  try {
    const result = await recordEvent(req.body);
    if (!result.ok) return res.status(400).json({ status: false, error: { code: result.code } });
    res.set("Cache-Control", "no-store");
    return res.status(202).json({ status: true, recorded: result.created });
  } catch (err) { return next(err); }
});
router.get("/report", dashboardAuthMiddleware, dashboardRoleMiddleware(["admin"]), async (req, res, next) => {
  try {
    const data = await buildLandingAnalyticsReport({ from: req.query.from, to: req.query.to });
    res.set("Cache-Control", "no-store");
    return res.json({ status: true, data });
  } catch (err) {
    if (err.name === "MarketingAnalyticsError") return res.status(err.status).json({ status: false, error: { code: err.code } });
    return next(err);
  }
});
module.exports = { router, hasValidIngestSecret };
