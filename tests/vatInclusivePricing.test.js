require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const { computeInclusiveVatBreakdown } = require("../src/utils/pricing");
const {
  buildCanonicalSubscriptionCheckoutBreakdown,
} = require("../src/services/subscription/subscriptionCheckoutService");
const {
  activateSubscriptionFromCanonicalContract,
} = require("../src/services/subscription/subscriptionActivationService");
const {
  PHASE1_CONTRACT_VERSION,
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
} = require("../src/constants/phase1Contract");

function assertEqual(actual, expected, message) {
  assert.strictEqual(actual, expected, `${message}: expected ${expected}, got ${actual}`);
}

function buildContractSnapshot(pricing) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const resolvedPricing = {
    basePlanPriceHalala: 5000,
    premiumTotalHalala: 1000,
    addonsTotalHalala: 200,
    deliveryFeeHalala: 0,
    discountHalala: 0,
    grossTotalHalala: 6200,
    subtotalHalala: 5391,
    subtotalBeforeVatHalala: 5391,
    vatPercentage: 15,
    vatHalala: 809,
    totalHalala: 6200,
    currency: "SAR",
    ...pricing,
  };
  const premiumItems = resolvedPricing.premiumTotalHalala > 0
    ? [{ proteinId: null, premiumKey: "test_premium", qty: 1, unitExtraFeeHalala: resolvedPricing.premiumTotalHalala, currency: "SAR" }]
    : [];
  return {
    meta: { version: PHASE1_CONTRACT_VERSION, capturedAt: now.toISOString(), source: "test", mode: CONTRACT_MODES[0], completeness: CONTRACT_COMPLETENESS_VALUES[0] },
    origin: { actorRole: "client", actorUserId: String(new mongoose.Types.ObjectId()) },
    plan: {
      planId: String(new mongoose.Types.ObjectId()),
      planName: { ar: "Test", en: "Test" },
      daysCount: 1,
      selectedGrams: 300,
      mealsPerDay: 2,
      totalMeals: 2,
      currency: "SAR",
    },
    start: {
      requestedStartDate: "2026-01-02",
      resolvedStartDate: "2026-01-02T00:00:00.000Z",
      defaultedToTomorrow: false,
      timezone: "Asia/Riyadh",
    },
    pricing: resolvedPricing,
    entitlementContract: { premiumItems },
    premiumSelections: premiumItems,
    delivery: { mode: "pickup", address: null, slot: { type: "pickup", window: "", slotId: "" }, pickupLocationId: "" },
    contract: {
      contractVersion: PHASE1_CONTRACT_VERSION,
      contractMode: CONTRACT_MODES[0],
      contractCompleteness: CONTRACT_COMPLETENESS_VALUES[0],
      contractSource: CONTRACT_SOURCES[0],
    },
  };
}

async function run() {
  const inclusive = computeInclusiveVatBreakdown(6200, 15);
  assertEqual(inclusive.subtotalHalala, 5391, "inclusive subtotal");
  assertEqual(inclusive.vatHalala, 809, "inclusive vat");
  assertEqual(inclusive.totalHalala, 6200, "inclusive total");

  const rounded = computeInclusiveVatBreakdown(9999, 15);
  assertEqual(
    rounded.subtotalHalala + rounded.vatHalala,
    rounded.totalHalala,
    "rounding keeps subtotal + vat equal to total"
  );

  const planId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const quote = {
    plan: { _id: planId, daysCount: 1, currency: "SAR" },
    grams: 300,
    mealsPerDay: 2,
    startDate: new Date("2026-01-02T00:00:00.000Z"),
    delivery: { type: "pickup", slot: { type: "pickup", window: "", slotId: "" }, pickupLocationId: "" },
    premiumCount: 1,
    premiumUnitPriceHalala: 1000,
    premiumItems: [
      {
        premiumKey: "test_premium",
        qty: 1,
        unitExtraFeeHalala: 1000,
        currency: "SAR",
        name: "Test Premium",
      },
    ],
    addonItems: [],
    breakdown: {
      basePlanPriceHalala: 5000,
      premiumTotalHalala: 1000,
      addonsTotalHalala: 200,
      deliveryFeeHalala: 0,
      grossTotalHalala: 6200,
      subtotalHalala: 5391,
      subtotalBeforeVatHalala: 5391,
      vatPercentage: 15,
      vatHalala: 809,
      totalHalala: 6200,
      currency: "SAR",
    },
  };

  const { breakdown } = buildCanonicalSubscriptionCheckoutBreakdown(quote);
  const providerPayload = { amount: breakdown.totalHalala };
  assertEqual(providerPayload.amount, 6200, "provider amount remains inclusive total");
  assertEqual(breakdown.subtotalHalala, 5391, "checkout subtotal before VAT");
  assertEqual(breakdown.vatHalala, 809, "checkout VAT portion");
  assertEqual(breakdown.totalHalala, 6200, "checkout inclusive total");

  const activated = await activateSubscriptionFromCanonicalContract({
    userId,
    planId,
    contract: {
      contractVersion: PHASE1_CONTRACT_VERSION,
      contractMode: CONTRACT_MODES[0],
      contractCompleteness: CONTRACT_COMPLETENESS_VALUES[0],
      contractSource: CONTRACT_SOURCES[0],
      contractHash: "vat-inclusive-test",
      contractSnapshot: buildContractSnapshot({
        basePlanPriceHalala: 6200,
        premiumTotalHalala: 0,
        addonsTotalHalala: 0,
        grossTotalHalala: 6200,
      }),
    },
    persistence: {
      async createSubscription(payload) {
        return { _id: new mongoose.Types.ObjectId(), ...payload };
      },
      async countSubscriptionDays() { return 0; },
      async insertSubscriptionDays() {},
    },
  });

  assertEqual(activated.vatPercentage, 15, "stored subscription VAT percentage");
  assertEqual(activated.vatHalala, 809, "stored subscription VAT");
  assertEqual(activated.totalPriceHalala, 6200, "stored subscription total");
  assertEqual(activated.subtotalHalala, 5391, "stored subscription subtotal before VAT");

  console.log("vatInclusivePricing.test.js: all checks passed");
}

run().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
