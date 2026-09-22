"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const CheckoutDraft = require("../src/models/CheckoutDraft");
const PromoCode = require("../src/models/PromoCode");
const PromoUsage = require("../src/models/PromoUsage");
const {
  applyPromoCodeToSubscriptionQuote,
  reservePromoCodeUsageForCheckout,
} = require("../src/services/promoCodeService");
const {
  buildEligibilityQuote,
} = require("../src/services/installDashboardSubscriptionPromoFlow");

const userId = new mongoose.Types.ObjectId();

function buildQuote(daysCount, mealsPerDay) {
  return {
    plan: { _id: new mongoose.Types.ObjectId(), daysCount },
    mealsPerDay,
    breakdown: {
      basePlanPriceHalala: 10000,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 0,
      vatPercentage: 0,
      currency: "SAR",
    },
  };
}

async function expectBeskEligibility({ daysCount, mealsPerDay, eligible }) {
  try {
    const result = await applyPromoCodeToSubscriptionQuote({
      promoCode: "ksa96",
      userId,
      quote: buildQuote(daysCount, mealsPerDay),
    });
    assert.strictEqual(eligible, true, `${daysCount} days / ${mealsPerDay} meals must be rejected`);
    assert.strictEqual(result.appliedPromo.code, "KSA96");
    assert.strictEqual(result.quote.breakdown.discountHalala, 3000);
  } catch (error) {
    assert.strictEqual(eligible, false, `${daysCount} days / ${mealsPerDay} meals must be accepted`);
    assert.strictEqual(error.code, "PROMO_NOT_ELIGIBLE");
  }
}

async function run() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

    const dashboardEligibility = buildEligibilityQuote({
    contractSnapshot: {
      plan: { planId: "plan-1", daysCount: 26, mealsPerDay: 1 },
      pricing: {
        basePlanPriceHalala: 51600,
        premiumTotalHalala: 0,
        addonsTotalHalala: 0,
        deliveryFeeHalala: 0,
      },
    },
  });
  assert.strictEqual(dashboardEligibility.plan.daysCount, 26);
  assert.strictEqual(dashboardEligibility.plan.mealsPerDay, 1);

  try {
    await mongoose.connect(replSet.getUri(`ksa96_${Date.now()}`));
    await PromoCode.create({
      code: "KSA96",
      title: "KSA96 - خصم 30%",
      discountType: "percentage",
      discountValue: 30,
      appliesTo: "subscription",
      usageLimitPerUser: 1,
      isActive: true,
    });
    await PromoCode.create({
      code: "LEGACY10",
      discountType: "percentage",
      discountValue: 10,
      appliesTo: "subscription",
      isActive: true,
    });

    for (const scenario of [
      { daysCount: 7, mealsPerDay: 1, eligible: false },
      { daysCount: 7, mealsPerDay: 2, eligible: false },
      { daysCount: 26, mealsPerDay: 1, eligible: true },
      { daysCount: 26, mealsPerDay: 2, eligible: true },
      { daysCount: 26, mealsPerDay: 5, eligible: true },
      { daysCount: 30, mealsPerDay: 1, eligible: true },
      { daysCount: 30, mealsPerDay: 2, eligible: true },
      { daysCount: 30, mealsPerDay: 5, eligible: true },
    ]) {
      await expectBeskEligibility(scenario);
    }

    const legacyResult = await applyPromoCodeToSubscriptionQuote({
      promoCode: "LEGACY10",
      userId,
      quote: buildQuote(7, 1),
    });
    assert.strictEqual(legacyResult.quote.breakdown.discountHalala, 1000);

    const quoteWithoutPromo = buildQuote(26, 2);
    const noPromoResult = await applyPromoCodeToSubscriptionQuote({ userId, quote: quoteWithoutPromo });
    assert.strictEqual(noPromoResult.quote, quoteWithoutPromo);
    assert.strictEqual(noPromoResult.appliedPromo, null);

    const besk = await PromoCode.findOne({ code: "KSA96" });
    const draft = await CheckoutDraft.create({
      userId,
      planId: new mongoose.Types.ObjectId(),
      daysCount: 7,
      grams: 200,
      mealsPerDay: 1,
      delivery: { type: "pickup", slot: { type: "pickup" } },
      breakdown: {
        basePlanPriceHalala: 10000,
        premiumTotalHalala: 0,
        addonsTotalHalala: 0,
        deliveryFeeHalala: 0,
        vatHalala: 0,
        totalHalala: 7000,
        currency: "SAR",
      },
    });
    await assert.rejects(
      reservePromoCodeUsageForCheckout({
        promo: besk,
        appliedPromo: { discountAmountHalala: 3000 },
        userId,
        checkoutDraftId: draft._id,
      }),
      (error) => error && error.code === "PROMO_NOT_ELIGIBLE"
    );
    assert.strictEqual(await PromoUsage.countDocuments({ checkoutDraftId: draft._id }), 0);

    console.log("ksa96PromoEligibility.test.js: PASS");
  } finally {
    await mongoose.disconnect();
    await replSet.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
