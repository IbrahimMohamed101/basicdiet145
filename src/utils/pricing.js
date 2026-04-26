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

function computeVatBreakdown({
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

function normalizeStoredVatBreakdown({
  basePriceHalala,
  subtotalHalala,
  vatPercentage,
  vatHalala,
  totalPriceHalala,
  totalHalala,
} = {}) {
  const normalizedBasePriceHalala = normalizeHalala(
    basePriceHalala !== undefined ? basePriceHalala : subtotalHalala
  );
  const normalizedVatPercentage = normalizeVatPercentage(vatPercentage);
  const computed = computeVatBreakdown({
    basePriceHalala: normalizedBasePriceHalala,
    vatPercentage: normalizedVatPercentage,
  });

  const normalizedVatHalala = vatHalala === undefined ? computed.vatHalala : normalizeHalala(vatHalala);
  const normalizedTotalPriceHalala = totalPriceHalala !== undefined
    ? normalizeHalala(totalPriceHalala)
    : (totalHalala !== undefined ? normalizeHalala(totalHalala) : normalizedBasePriceHalala + normalizedVatHalala);

  return {
    basePriceHalala: normalizedBasePriceHalala,
    subtotalHalala: normalizedBasePriceHalala,
    vatPercentage: normalizedVatPercentage,
    vatHalala: normalizedVatHalala,
    totalPriceHalala: normalizedTotalPriceHalala,
    totalHalala: normalizedTotalPriceHalala,
  };
}

function buildMoneySummary({
  basePriceHalala = 0,
  vatPercentage = DEFAULT_VAT_PERCENTAGE,
  vatHalala = 0,
  totalPriceHalala = 0,
  currency = "SAR",
} = {}) {
  return {
    basePriceHalala: normalizeHalala(basePriceHalala),
    basePriceSar: normalizeHalala(basePriceHalala) / 100,
    vatPercentage: normalizeVatPercentage(vatPercentage),
    vatHalala: normalizeHalala(vatHalala),
    vatSar: normalizeHalala(vatHalala) / 100,
    totalPriceHalala: normalizeHalala(totalPriceHalala),
    totalPriceSar: normalizeHalala(totalPriceHalala) / 100,
    currency: String(currency || "SAR").trim().toUpperCase() || "SAR",
  };
}

module.exports = {
  computeVatBreakdown,
  normalizeStoredVatBreakdown,
  buildMoneySummary,
  normalizeVatPercentage,
  normalizeHalala,
};
