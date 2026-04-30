const DEFAULT_VAT_PERCENTAGE = 0;

function normalizeHalala(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function normalizeVatPercentage(value, fallback = DEFAULT_VAT_PERCENTAGE) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const normalizedFallback = Number(fallback);
    return Number.isFinite(normalizedFallback) ? normalizedFallback : DEFAULT_VAT_PERCENTAGE;
  }
  return parsed;
}

function computeExclusiveVatBreakdown({
  basePriceHalala = 0,
  vatPercentage = DEFAULT_VAT_PERCENTAGE,
} = {}) {
  const normalizedBasePriceHalala = normalizeHalala(basePriceHalala);
  const normalizedVatPercentage = normalizeVatPercentage(vatPercentage);
  const vatHalala = Math.round((normalizedBasePriceHalala * normalizedVatPercentage) / 100);
  const totalPriceHalala = normalizedBasePriceHalala + vatHalala;

  return {
    basePriceHalala: normalizedBasePriceHalala,
    subtotalHalala: normalizedBasePriceHalala,
    vatPercentage: normalizedVatPercentage,
    vatHalala,
    totalPriceHalala,
    totalHalala: totalPriceHalala,
  };
}

function computeInclusiveVatBreakdown(totalInclusiveHalala = 0, vatPercentage = DEFAULT_VAT_PERCENTAGE) {
  const normalizedTotalInclusiveHalala = normalizeHalala(totalInclusiveHalala);
  const normalizedVatPercentage = normalizeVatPercentage(vatPercentage);
  const divisor = 1 + (normalizedVatPercentage / 100);
  const subtotalHalala = divisor > 0
    ? Math.round(normalizedTotalInclusiveHalala / divisor)
    : normalizedTotalInclusiveHalala;
  const vatHalala = normalizedTotalInclusiveHalala - subtotalHalala;

  return {
    basePriceHalala: subtotalHalala, // Keep for backward compatibility but it refers to net
    subtotalHalala,
    subtotalBeforeVatHalala: subtotalHalala,
    vatPercentage: normalizedVatPercentage,
    vatHalala,
    totalPriceHalala: normalizedTotalInclusiveHalala,
    totalHalala: normalizedTotalInclusiveHalala,
    netHalala: subtotalHalala,
    grossHalala: normalizedTotalInclusiveHalala,
  };
}

const computeVatBreakdown = computeExclusiveVatBreakdown;

function normalizeStoredVatBreakdown({
  basePriceHalala,
  basePlanPriceHalala,
  basePlanGrossHalala,
  basePlanNetHalala,
  subtotalHalala,
  subtotalBeforeVatHalala,
  vatPercentage,
  vatHalala,
  totalPriceHalala,
  totalHalala,
} = {}) {
  const normalizedVatPercentage = normalizeVatPercentage(vatPercentage);
  
  // Use explicit gross fields if available, otherwise fall back to basePlanPriceHalala or basePriceHalala.
  // DO NOT fall back to subtotalHalala for the gross price.
  const gross = normalizeHalala(
    basePlanGrossHalala !== undefined ? basePlanGrossHalala : (basePlanPriceHalala !== undefined ? basePlanPriceHalala : basePriceHalala)
  );

  const subtotal = normalizeHalala(
    subtotalBeforeVatHalala !== undefined ? subtotalBeforeVatHalala : subtotalHalala
  );

  const total = totalPriceHalala !== undefined
    ? normalizeHalala(totalPriceHalala)
    : (totalHalala !== undefined ? normalizeHalala(totalHalala) : (subtotal + normalizeHalala(vatHalala)));

  // If net is not provided, we use subtotal. Do NOT recompute from gross here to avoid double extraction.
  const net = basePlanNetHalala !== undefined ? normalizeHalala(basePlanNetHalala) : subtotal;

  return {
    basePriceHalala: gross,
    basePlanPriceHalala: gross,
    basePlanGrossHalala: gross,
    basePlanNetHalala: net,
    subtotalHalala: subtotal,
    subtotalBeforeVatHalala: subtotal,
    vatPercentage: normalizedVatPercentage,
    vatHalala: normalizeHalala(vatHalala),
    totalPriceHalala: total,
    totalHalala: total,
  };
}

function buildMoneySummary({
  basePlanPriceHalala,
  basePriceHalala,
  basePlanGrossHalala,
  basePlanNetHalala,
  subtotalHalala = 0,
  subtotalBeforeVatHalala,
  vatPercentage = DEFAULT_VAT_PERCENTAGE,
  vatHalala = 0,
  totalPriceHalala = 0,
  currency = "SAR",
} = {}) {
  // Directly use provided values. DO NOT recompute VAT or Net here.
  const gross = normalizeHalala(
    basePlanGrossHalala !== undefined ? basePlanGrossHalala : (basePlanPriceHalala !== undefined ? basePlanPriceHalala : basePriceHalala)
  );
  
  const subtotal = normalizeHalala(
    subtotalBeforeVatHalala !== undefined ? subtotalBeforeVatHalala : subtotalHalala
  );

  const net = basePlanNetHalala !== undefined ? normalizeHalala(basePlanNetHalala) : subtotal;
  const vat = normalizeHalala(vatHalala);
  const total = normalizeHalala(totalPriceHalala);

  return {
    basePlanPriceHalala: gross,
    basePlanPriceSar: gross / 100,
    basePlanGrossHalala: gross,
    basePlanGrossSar: gross / 100,
    basePlanNetHalala: net,
    basePlanNetSar: net / 100,
    subtotalHalala: subtotal,
    subtotalSar: subtotal / 100,
    vatPercentage: normalizeVatPercentage(vatPercentage),
    vatHalala: vat,
    vatSar: vat / 100,
    totalPriceHalala: total,
    totalPriceSar: total / 100,
    currency: String(currency || "SAR").trim().toUpperCase() || "SAR",
    // Backward compatibility
    basePriceHalala: gross,
    basePriceSar: gross / 100,
  };
}

module.exports = {
  computeVatBreakdown,
  computeExclusiveVatBreakdown,
  computeInclusiveVatBreakdown,
  normalizeStoredVatBreakdown,
  buildMoneySummary,
  normalizeVatPercentage,
  normalizeHalala,
};
