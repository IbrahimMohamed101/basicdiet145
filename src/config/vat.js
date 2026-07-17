/**
 * System-owned VAT configuration.
 *
 * VAT is NOT configurable via the database. It is fixed in code.
 * Even if the database is wiped or has no vat_percentage setting,
 * VAT will always be 15% inclusive.
 *
 * Formula: VAT is INCLUDED inside the displayed total.
 *   vatHalala = Math.round(totalHalala * VAT_PERCENTAGE / (100 + VAT_PERCENTAGE))
 *   netHalala = totalHalala - vatHalala
 *
 * Example (total = 1000):
 *   vatHalala = round(1000 * 15 / 115) = 130
 *   netHalala = 1000 - 130 = 870
 *   customerPays = 1000 (same as displayed — VAT is extracted, not added)
 */

"use strict";

const VAT_PERCENTAGE = 15;
const VAT_INCLUDED = true;

/**
 * Returns the system VAT percentage.
 * Always returns 15 — never reads from the database.
 *
 * @returns {number} 15
 */
function getSystemVatPercentage() {
  return VAT_PERCENTAGE;
}

/**
 * Calculates an inclusive VAT breakdown from a total that already includes VAT.
 *
 * @param {number|string} totalHalala - The inclusive total in halala (already includes VAT)
 * @returns {{
 *   vatIncluded: boolean,
 *   vatPercentage: number,
 *   totalHalala: number,
 *   subtotalExcludingVatHalala: number,
 *   vatHalala: number,
 *   totalIncludingVatHalala: number
 * }}
 */
function calculateVatBreakdownFromInclusiveTotal(totalHalala) {
  const safeTotal = Number.isFinite(Number(totalHalala))
    ? Math.max(0, Math.round(Number(totalHalala)))
    : 0;

  const vatHalala = Math.round((safeTotal * VAT_PERCENTAGE) / (100 + VAT_PERCENTAGE));
  const netHalala = safeTotal - vatHalala;

  return {
    vatIncluded: true,
    vatPercentage: VAT_PERCENTAGE,
    totalHalala: safeTotal,
    subtotalExcludingVatHalala: netHalala,
    vatHalala,
    totalIncludingVatHalala: safeTotal,
  };
}

module.exports = {
  VAT_PERCENTAGE,
  VAT_INCLUDED,
  getSystemVatPercentage,
  calculateVatBreakdownFromInclusiveTotal,
};