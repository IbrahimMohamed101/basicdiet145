"use strict";
const crypto = require("crypto");
const Plan = require("../models/Plan");
const LandingLead = require("../models/LandingLead");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["new", "contacted", "interested", "converted", "not_interested"]);
const DURATIONS = new Set([7, 26, 30]);

function normalizeSaudiPhone(raw) {
  if (typeof raw !== "string" || raw.length > 32) return null;
  const value = raw.replace(/[ \t()-]/g, "");
  let local = value;
  if (local.startsWith("+966")) local = local.slice(4);
  else if (local.startsWith("966")) local = local.slice(3);
  else if (local.startsWith("0")) local = local.slice(1);
  return /^5[0-9]{8}$/.test(local) ? "+966" + local : null;
}
function clean(value, max = 80) {
  return typeof value === "string" ? value.trim().slice(0, max).replace(/[\p{C}<>]/gu, "") : "";
}
function validSourceHost(value) {
  return typeof value === "string" && /^[a-z0-9.-]{1,100}$/i.test(value) ? value.toLowerCase() : "";
}
function isValidRequest(body) {
  return body && typeof body === "object" && !Array.isArray(body)
    && UUID.test(body.requestId || "")
    && body.contactConsent === true
    && normalizeSaudiPhone(body.phone)
    && /^[0-9a-f]{24}$/i.test(body.planId || "")
    && DURATIONS.has(body.daysCount)
    && Number.isInteger(body.grams) && body.grams > 0 && body.grams <= 1000
    && Number.isInteger(body.mealsPerDay) && body.mealsPerDay > 0 && body.mealsPerDay <= 10
    && (body.fulfillmentMethod === undefined || ["delivery", "pickup"].includes(body.fulfillmentMethod));
}
async function getAvailableOptions() {
  const plans = await Plan.find(Plan.getSellableQuery())
    .sort({ sortOrder: 1, createdAt: -1 }).lean();
  return plans.filter(p => DURATIONS.has(p.daysCount) && Plan.isViable(p)).map(plan => ({
    planId: String(plan._id),
    daysCount: plan.daysCount,
    gramsOptions: (plan.gramsOptions || []).filter(g => g.isActive !== false).map(g => ({
      grams: g.grams,
      mealsPerDay: (g.mealsOptions || []).filter(m => m.isActive !== false).map(m => m.mealsPerDay),
    })).filter(g => g.mealsPerDay.length > 0),
  })).filter(p => p.gramsOptions.length > 0);
}
async function submitLead(body) {
  if (!isValidRequest(body)) return { ok: false, status: 400, code: "INVALID_REQUEST" };
  // Honeypot: silently accept bot submissions without persisting PII.
  if (typeof body.website === "string" && body.website.trim()) return { ok: true, created: false };
  const plan = await Plan.findOne({ ...Plan.getSellableQuery(), _id: body.planId }).lean();
  if (!plan || !Plan.isViable(plan) || plan.daysCount !== body.daysCount || !DURATIONS.has(plan.daysCount)) {
    return { ok: false, status: 400, code: "PLAN_UNAVAILABLE" };
  }
  const gram = (plan.gramsOptions || []).find(g => g.isActive !== false && g.grams === body.grams);
  if (!gram || !(gram.mealsOptions || []).some(m => m.isActive !== false && m.mealsPerDay === body.mealsPerDay)) {
    return { ok: false, status: 400, code: "OPTION_UNAVAILABLE" };
  }
  const phone = normalizeSaudiPhone(body.phone);
  const secret = process.env.LANDING_ANALYTICS_INGEST_SECRET;
  if (!secret) return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
  const phoneHash = crypto.createHmac("sha256", secret).update(phone).digest("hex");
  const now = new Date();
  try {
    await LandingLead.create({
      requestId: body.requestId.toLowerCase(),
      name: clean(body.name, 70),
      phone, phoneHash, dayBucket: now.toISOString().slice(0, 10),
      planId: plan._id, daysCount: plan.daysCount, grams: body.grams,
      mealsPerDay: body.mealsPerDay,
      fulfillmentMethod: body.fulfillmentMethod || "unspecified", contactConsent: true,
      marketingConsent: body.marketingConsent === true, consentAt: now,
      source: clean(body.source), medium: clean(body.medium),
      campaign: clean(body.campaign, 100), content: clean(body.content, 100),
      referrerHost: validSourceHost(body.referrerHost),
      location: ["header", "hero", "app", "plans", "final", "benefits"].includes(body.location) ? body.location : "",
      sessionId: UUID.test(body.sessionId || "") ? body.sessionId.toLowerCase() : "",
      expiresAt: new Date(now.getTime() + 180 * 86400000),
    });
    return { ok: true, created: true };
  } catch (error) {
    if (error.code === 11000) return { ok: true, created: false };
    throw error;
  }
}
async function listLeads(query) {
  const page = Math.min(1000, Math.max(1, Number.parseInt(query.page, 10) || 1));
  const filter = {};
  if (query.status && query.status !== "all") {
    if (!STATUSES.has(query.status)) return { ok: false, status: 400, code: "INVALID_STATUS" };
    filter.status = query.status;
  }
  const [rows, total] = await Promise.all([
    LandingLead.find(filter).select("-phoneHash -dayBucket -sessionId").sort({ createdAt: -1 })
      .skip((page - 1) * 25).limit(25).lean(),
    LandingLead.countDocuments(filter),
  ]);
  return { ok: true, data: { rows, total, page, pageSize: 25 } };
}
async function updateLead(id, body, dashboardUserId) {
  if (!/^[0-9a-f]{24}$/i.test(id) || !body || !STATUSES.has(body.status)) {
    return { ok: false, status: 400, code: "INVALID_REQUEST" };
  }
  const updates = { status: body.status, updatedBy: dashboardUserId };
  if (body.status !== "new") updates.contactedAt = new Date();
  if (typeof body.staffNote === "string") updates.staffNote = clean(body.staffNote, 280);
  const lead = await LandingLead.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true })
    .select("-phoneHash -dayBucket -sessionId").lean();
  return lead ? { ok: true, data: lead } : { ok: false, status: 404, code: "NOT_FOUND" };
}
module.exports = { normalizeSaudiPhone, isValidRequest, getAvailableOptions, submitLead, listLeads, updateLead };
