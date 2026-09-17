"use strict";

function normalizePromoCodeInput(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPromoCodeLookupFilter(value, { excludeId = null } = {}) {
  const normalizedCode = normalizePromoCodeInput(value);
  if (!normalizedCode) return null;

  const filter = {
    deletedAt: null,
    $or: [
      { codeNormalized: normalizedCode },
      { code: new RegExp(`^${escapeRegex(normalizedCode)}$`, "i") },
    ],
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  return filter;
}

module.exports = {
  normalizePromoCodeInput,
  buildPromoCodeLookupFilter,
};
