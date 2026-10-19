"use strict";

// Source inference is for aggregated reporting only. Never overwrite raw UTM or
// referrer fields, and do not call traffic without evidence "direct".
const ALIASES = {
  ig: "instagram",
  insta: "instagram",
  fb: "facebook",
  meta: "meta",
  tt: "tiktok",
  g: "google",
};
const HOST_SOURCES = [
  ["instagram.com", "instagram"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["tiktok.com", "tiktok"],
  ["snapchat.com", "snapchat"],
  ["google.com", "google"],
  ["google.com.sa", "google"],
  ["google.co.uk", "google"],
  ["bing.com", "bing"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["pinterest.com", "pinterest"],
  ["linkedin.com", "linkedin"],
  ["lnkd.in", "linkedin"],
  ["wa.me", "whatsapp"],
  ["whatsapp.com", "whatsapp"],
];
function hostMatches(host, domain) {
  return host === domain || host.endsWith("." + domain);
}
function classifySource(source, referrerHost) {
  const tagged = typeof source === "string" ? source.trim().toLowerCase().slice(0, 64) : "";
  if (tagged) return { key: ALIASES[tagged] || tagged, method: "utm" };
  const host = typeof referrerHost === "string" ? referrerHost.trim().toLowerCase() : "";
  if (!host || hostMatches(host, "basicdietksa.com")
    || hostMatches(host, "basicdiet-landing-production.up.railway.app")) {
    return { key: "unattributed", method: "unattributed" };
  }
  for (const [domain, key] of HOST_SOURCES) {
    if (hostMatches(host, domain)) return { key, method: "referrer" };
  }
  return { key: "other_referral", method: "referrer" };
}
function summarizeSources(rows) {
  const totals = new Map();
  const attribution = { utm: 0, referrer: 0, unattributed: 0 };
  for (const row of rows || []) {
    const n = Number(row.count || 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    const cls = classifySource(row._id?.source, row._id?.referrerHost);
    totals.set(cls.key, (totals.get(cls.key) || 0) + n);
    attribution[cls.method] += n;
  }
  const views = attribution.utm + attribution.referrer + attribution.unattributed;
  return {
    rows: [...totals.entries()].map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 15),
    attribution: {
      ...attribution,
      total: views,
      knownRate: views ? Number((100 * (attribution.utm + attribution.referrer) / views).toFixed(1)) : 0,
    },
  };
}
module.exports = { classifySource, summarizeSources };
