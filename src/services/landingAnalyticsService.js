"use strict";
const LandingAnalyticsEvent = require("../models/LandingAnalyticsEvent");
const LandingLead = require("../models/LandingLead");
const { resolveRange } = require("./dashboard/marketingAnalyticsService");

const EVENTS = new Set([
  "lp_view", "lp_section_view", "lp_cta_click", "lp_store_click",
  "lp_nav_click", "lp_faq_open", "lp_reel_click", "lp_lead_submitted",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED = {
  device: new Set(["ios", "android", "desktop", "other"]),
  location: new Set(["header", "hero", "app", "plans", "final", "benefits"]),
  section: new Set(["top", "meals", "how-it-works", "app", "plans", "faq", "reels"]),
  platform: new Set(["ios", "android", "desktop"]),
  store: new Set(["app_store", "google_play"]),
  action: new Set(["open", "embed", "instagram"]),
};
function stringValue(value, max = 64) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max).replace(/[^\p{L}\p{N}_\- .]/gu, "");
}
function enumValue(key, value) {
  return ALLOWED[key].has(value) ? value : "";
}
function parseEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (!EVENTS.has(body.event) || !UUID.test(body.eventId) || !UUID.test(body.sessionId)) return null;
  const path = typeof body.path === "string" && /^\/[a-zA-Z0-9/_-]{0,100}$/.test(body.path)
    ? body.path : "/";
  const record = {
    _id: body.eventId.toLowerCase(),
    eventId: body.eventId.toLowerCase(),
    sessionId: body.sessionId.toLowerCase(),
    event: body.event,
    path,
    device: enumValue("device", body.device) || "other",
    referrerHost: typeof body.referrerHost === "string" && /^[a-zA-Z0-9.-]{1,100}$/.test(body.referrerHost)
      ? body.referrerHost.toLowerCase() : "",
    source: stringValue(body.source),
    medium: stringValue(body.medium),
    campaign: stringValue(body.campaign, 100),
    content: stringValue(body.content, 100),
    term: stringValue(body.term),
    location: enumValue("location", body.location),
    section: enumValue("section", body.section),
    platform: enumValue("platform", body.platform),
    store: enumValue("store", body.store),
    action: enumValue("action", body.action),
    reel: /^[a-zA-Z0-9_-]{5,24}$/.test(body.reel || "") ? body.reel : "",
    planDays: [7, 26, 30].includes(body.planDays) ? body.planDays : null,
    expiresAt: new Date(Date.now() + 180 * 86400000),
  };
  if (record.event === "lp_section_view" && !record.section) return null;
  if (record.event === "lp_store_click" && !record.store) return null;
  if (record.event === "lp_cta_click" && !record.location) return null;
  return record;
}
async function recordEvent(body) {
  const record = parseEvent(body);
  if (!record) return { ok: false, code: "INVALID_EVENT" };
  try {
    await LandingAnalyticsEvent.create(record);
    return { ok: true, created: true };
  } catch (error) {
    if (error && error.code === 11000) return { ok: true, created: false };
    throw error;
  }
}
function flattenGroups(rows) {
  return rows.map(row => ({ key: row._id || "direct", count: row.count })).slice(0, 15);
}
async function groupByField(base, event, field) {
  return LandingAnalyticsEvent.aggregate([
    { $match: { ...base, event } },
    { $group: { _id: "$" + field, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } }, { $limit: 15 },
  ]);
}
async function buildLandingAnalyticsReport({ from, to }) {
  const period = resolveRange(from, to);
  const base = { createdAt: { $gte: period.start, $lte: period.end } };
  const [totals, daily, uniques, sources, campaigns, devices, ctas, sections, stores, reels, referrers, plans, uniqueLeads] =
    await Promise.all([
      LandingAnalyticsEvent.aggregate([
        { $match: base }, { $group: { _id: "$event", count: { $sum: 1 } } },
      ]),
      LandingAnalyticsEvent.aggregate([
        { $match: base },
        { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Riyadh" } }, event: "$event" }, count: { $sum: 1 } } },
        { $sort: { "_id.day": 1 } },
      ]),
      LandingAnalyticsEvent.aggregate([
        { $match: { ...base, event: "lp_view" } },
        { $group: { _id: "$sessionId" } }, { $count: "count" },
      ]),
      groupByField(base, "lp_view", "source"),
      groupByField(base, "lp_view", "campaign"),
      groupByField(base, "lp_view", "device"),
      groupByField(base, "lp_cta_click", "location"),
      groupByField(base, "lp_section_view", "section"),
      groupByField(base, "lp_store_click", "store"),
      groupByField(base, "lp_reel_click", "reel"),
      groupByField(base, "lp_view", "referrerHost"),
      groupByField(base, "lp_cta_click", "planDays"),
      LandingLead.countDocuments({ createdAt: base.createdAt }),
    ]);
  const countMap = Object.fromEntries(totals.map(r => [r._id, r.count]));
  const days = new Map();
  for (const row of daily) {
    const date = row._id.day;
    const record = days.get(date) || { date, views: 0, ctaClicks: 0, storeClicks: 0 };
    if (row._id.event === "lp_view") record.views = row.count;
    if (row._id.event === "lp_cta_click") record.ctaClicks = row.count;
    if (row._id.event === "lp_store_click") record.storeClicks = row.count;
    days.set(date, record);
  }
  return {
    range: { from: period.from, to: period.to, days: period.days, timezone: "Asia/Riyadh" },
    kpis: {
      pageViews: countMap.lp_view || 0,
      leadSubmissions: countMap.lp_lead_submitted || 0,
      uniqueLeads,
      sessions: uniques[0]?.count || 0,
      ctaClicks: countMap.lp_cta_click || 0,
      storeClicks: countMap.lp_store_click || 0,
      sectionViews: countMap.lp_section_view || 0,
      navClicks: countMap.lp_nav_click || 0,
      faqOpens: countMap.lp_faq_open || 0,
      reelClicks: countMap.lp_reel_click || 0,
      storeClickRate: (countMap.lp_view || 0) ? Number((100 * (countMap.lp_store_click || 0) / countMap.lp_view).toFixed(1)) : 0,
    },
    daily: [...days.values()],
    sources: flattenGroups(sources), campaigns: flattenGroups(campaigns),
    devices: flattenGroups(devices), ctas: flattenGroups(ctas),
    sections: flattenGroups(sections), stores: flattenGroups(stores),
    reels: flattenGroups(reels), referrers: flattenGroups(referrers),
    plans: flattenGroups(plans),
    note: "Sessions are browser-tab session identifiers, not unique people. Store clicks are intent, not installs or paid subscriptions.",
    generatedAt: new Date().toISOString(),
  };
}
module.exports = { parseEvent, recordEvent, buildLandingAnalyticsReport };
