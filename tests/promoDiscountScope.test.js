"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const PromoCode = require("../src/models/PromoCode");
const {
  applyPromoCodeToSubscriptionQuote,
} = require("../src/services/promoCodeService");

const userId = new mongoose.Types.ObjectId();

function buildQuote() {
  return {
    plan: {
      _id: new mongoose.Types.ObjectId(),
      daysCount: 7,
    },
    mealsPerDay: 1,
    breakdown: {
      basePlanPriceHalala: 70000,
      premiumTotalHalala: 5000,
      addonsTotalHalala: 10000,
      deliveryFeeHalala: 2000,
      vatPercentage: 16,
      currency: "SAR",
    },
  };
}

async function run() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  try {
    await mongoose.connect(replSet.getUri(`promo_scope_${Date.now()}`));

    await PromoCode.create({
      code: "SAVE15",
      title: "خصم 15%",
      discountType: "percentage",
      discountValue: 15,
      appliesTo: "subscription",
      isActive: true,
    });

    const result = await applyPromoCodeToSubscriptionQuote({
      promoCode: "SAVE15",
      userId,
      quote: buildQuote(),
    });

    assert.strictEqual(
      result.appliedPromo.discountAmountHalala,
      10500,
      "15% must be calculated from the base plan only (70,000 x 15%)"
    );
    assert.strictEqual(
      result.quote.breakdown.discountHalala,
      10500,
      "breakdown must persist the plan-only discount"
    );
    assert.strictEqual(
      result.quote.breakdown.grossTotalHalala,
      87000,
      "gross total must remain the pre-discount invoice total"
    );
    assert.strictEqual(
      result.quote.breakdown.totalHalala,
      76500,
      "final total must be plan-after-discount + full premium + full add-ons + full delivery"
    );
    assert.strictEqual(
      result.quote.breakdown.premiumTotalHalala,
      5000,
      "premium charges must remain unchanged"
    );
    assert.strictEqual(
      result.quote.breakdown.addonsTotalHalala,
      10000,
      "add-ons must remain unchanged"
    );
    assert.strictEqual(
      result.quote.breakdown.deliveryFeeHalala,
      2000,
      "delivery fee must remain unchanged"
    );
    assert.strictEqual(
      result.quote.breakdown.basePlanNetHalala,
      51293,
      "base plan net must be recalculated from the discounted plan amount"
    );

    await PromoCode.create({
      code: "FIXED80K",
      title: "خصم ثابت",
      discountType: "fixed",
      discountValue: 80000,
      appliesTo: "subscription",
      isActive: true,
    });

    const capped = await applyPromoCodeToSubscriptionQuote({
      promoCode: "FIXED80K",
      userId,
      quote: buildQuote(),
    });

    assert.strictEqual(
      capped.appliedPromo.discountAmountHalala,
      70000,
      "fixed promo must never discount more than the base plan"
    );
    assert.strictEqual(
      capped.quote.breakdown.totalHalala,
      17000,
      "a fully discounted plan still keeps premium, add-ons, and delivery"
    );

    console.log("promoDiscountScope.test.js: PASS");
  } finally {
    await mongoose.disconnect();
    await replSet.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
