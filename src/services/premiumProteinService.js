const BuilderProtein = require("../models/BuilderProtein");

const SYSTEM_CURRENCY = "SAR";

function normalizeProteinId(value) {
  return value ? String(value) : "";
}

function getProteinExtraFeeHalala(protein) {
  const parsed = Number(protein && protein.extraFeeHalala);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function getProteinCurrency(protein) {
  const currency = String(protein && protein.currency ? protein.currency : SYSTEM_CURRENCY).trim().toUpperCase();
  return currency || SYSTEM_CURRENCY;
}

async function loadPremiumProteinsById(proteinIds, { session } = {}) {
  const ids = Array.from(new Set((Array.isArray(proteinIds) ? proteinIds : []).map(normalizeProteinId).filter(Boolean)));
  if (!ids.length) return new Map();

  let query = BuilderProtein.find({ _id: { $in: ids }, isActive: true, isPremium: true });
  if (session) query = query.session(session);
  const docs = await query.lean();
  return new Map(docs.map((doc) => [String(doc._id), doc]));
}

function buildPremiumSelectionFromProtein(protein, overrides = {}) {
  return {
    proteinId: normalizeProteinId(protein && protein._id ? protein._id : overrides.proteinId),
    unitExtraFeeHalala: getProteinExtraFeeHalala(protein),
    currency: getProteinCurrency(protein),
    premiumSource: overrides.premiumSource || 'paid',
    baseSlotKey: overrides.baseSlotKey || null,
    consumedAt: overrides.consumedAt || new Date(),
  };
}

module.exports = {
  SYSTEM_CURRENCY,
  normalizeProteinId,
  getProteinExtraFeeHalala,
  getProteinCurrency,
  loadPremiumProteinsById,
  buildPremiumSelectionFromProtein,
};
