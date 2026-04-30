require("dotenv").config();

const assert = require("assert");
const { buildMoneySummary } = require("../src/utils/pricing");

function assertEqual(actual, expected, message) {
  assert.strictEqual(actual, expected, `${message}: expected ${expected}, got ${actual}`);
}

function run() {
  console.log("Running VAT-inclusive response naming regression tests...");

  // Mock breakdown from the user's report
  // 15000 Gross, 15% VAT -> 13043 Net, 1957 VAT
  const breakdown = {
    basePlanPriceHalala: 15000,
    basePlanGrossHalala: 15000,
    basePlanNetHalala: 13043,
    subtotalBeforeVatHalala: 13043,
    subtotalHalala: 13043,
    vatPercentage: 15,
    vatHalala: 1957,
    totalHalala: 15000,
    currency: "SAR"
  };

  // This simulates the mapper in subscriptionController.js
  const pricingSummary = buildMoneySummary({
    basePlanPriceHalala: breakdown.basePlanPriceHalala,
    basePlanGrossHalala: breakdown.basePlanGrossHalala,
    basePlanNetHalala: breakdown.basePlanNetHalala,
    subtotalBeforeVatHalala: breakdown.subtotalBeforeVatHalala,
    subtotalHalala: breakdown.subtotalHalala,
    vatPercentage: breakdown.vatPercentage,
    vatHalala: breakdown.vatHalala,
    totalPriceHalala: breakdown.totalHalala,
    currency: breakdown.currency || "SAR",
  });

  console.log("Pricing Summary Output:", JSON.stringify(pricingSummary, null, 2));

  // Assertions as required by the USER
  assertEqual(pricingSummary.basePlanPriceHalala, 15000, "pricingSummary.basePlanPriceHalala should be 15000 (Gross)");
  assertEqual(pricingSummary.basePlanGrossHalala, 15000, "pricingSummary.basePlanGrossHalala should be 15000 (Gross)");
  assertEqual(pricingSummary.basePlanNetHalala, 13043, "pricingSummary.basePlanNetHalala should be 13043 (Net)");
  assertEqual(pricingSummary.basePriceHalala, 15000, "pricingSummary.basePriceHalala (backward compat) should be 15000 (Gross)");
  assertEqual(pricingSummary.vatHalala, 1957, "pricingSummary.vatHalala should be 1957");
  assertEqual(pricingSummary.totalPriceHalala, 15000, "pricingSummary.totalPriceHalala should be 15000 (Gross)");

  // Prevent current bug regressions
  assert.notStrictEqual(pricingSummary.basePlanPriceHalala, 13043, "pricingSummary.basePlanPriceHalala MUST NOT be 13043 (Net)");
  assert.notStrictEqual(pricingSummary.basePlanNetHalala, 0, "pricingSummary.basePlanNetHalala MUST NOT be 0");

  // SAR equivalents
  assertEqual(pricingSummary.basePlanPriceSar, 150, "basePlanPriceSar");
  assertEqual(pricingSummary.basePlanNetSar, 130.43, "basePlanNetSar");
  assertEqual(pricingSummary.subtotalSar, 130.43, "subtotalSar");
  assertEqual(pricingSummary.vatSar, 19.57, "vatSar");
  assertEqual(pricingSummary.totalPriceSar, 150, "totalPriceSar");
  assertEqual(pricingSummary.basePriceSar, 150, "basePriceSar");

  console.log("All VAT-inclusive naming regression checks passed!");
}

try {
  run();
} catch (err) {
  console.error("Test failed!");
  console.error(err);
  process.exit(1);
}
