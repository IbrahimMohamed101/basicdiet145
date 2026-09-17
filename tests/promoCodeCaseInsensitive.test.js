"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const express = require("express");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const promoCodeController = require("../src/controllers/promoCodeController");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const PromoCode = require("../src/models/PromoCode");
const PromoUsage = require("../src/models/PromoUsage");
const {
  applyPromoCodeToSubscriptionQuote,
  reservePromoCodeUsageForCheckout,
} = require("../src/services/promoCodeService");

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createPromoTestApp() {
  const app = express();
  app.use(express.json());
  app.post("/promo-codes", asyncRoute(promoCodeController.createPromoCodeAdmin));
  app.put("/promo-codes/:id", asyncRoute(promoCodeController.updatePromoCodeAdmin));
  app.post("/promo-codes/validate", asyncRoute(promoCodeController.validatePromoCodeAdmin));
  app.use((err, _req, res, _next) => {
    res.status(Number(err.status || 500)).json({
      status: false,
      error: { code: err.code || "INTERNAL", message: err.message },
    });
  });
  return app;
}

function expectStatus(response, status, label) {
  assert.strictEqual(
    response.status,
    status,
    `${label}: expected ${status}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

async function run() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  try {
    await mongoose.connect(replSet.getUri(`promo_case_insensitive_${Date.now()}`));
    await PromoCode.init();

    const api = request(createPromoTestApp());
    const userId = new mongoose.Types.ObjectId();

    let response = await api.post("/promo-codes").send({
      code: "1PASS",
      title: "Case-insensitive promo",
      discountType: "percentage",
      discountValue: 10,
      appliesTo: "subscription",
      isActive: true,
    });
    expectStatus(response, 201, "create canonical promo");
    const promoId = response.body.data.id;
    assert.strictEqual(response.body.data.code, "1PASS");

    // Exercise compatibility with an existing uppercase row created before
    // codeNormalized was populated, without touching any production data.
    await PromoCode.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(promoId) },
      { $unset: { codeNormalized: "" } }
    );

    const acceptedSpellings = ["1PASS", "1Pass", "1pass", "  1Pass  "];
    const discounts = [];
    for (const promoCode of acceptedSpellings) {
      response = await api.post("/promo-codes/validate").send({
        promoCode,
        userId: String(userId),
        subtotalHalala: 10000,
      });
      expectStatus(response, 200, `accept ${JSON.stringify(promoCode)}`);
      assert.strictEqual(response.body.data.valid, true);
      assert.strictEqual(response.body.data.promo.code, "1PASS");
      discounts.push(response.body.data.breakdown.discountHalala);
    }
    assert.deepStrictEqual(discounts, [1000, 1000, 1000, 1000]);

    response = await api.post("/promo-codes/validate").send({
      promoCode: "DOES-NOT-EXIST",
      userId: String(userId),
      subtotalHalala: 10000,
    });
    expectStatus(response, 400, "reject missing promo");
    assert.strictEqual(response.body.error.code, "PROMO_NOT_FOUND");

    response = await api.post("/promo-codes").send({
      code: "1pass",
      discountType: "percentage",
      discountValue: 99,
      appliesTo: "subscription",
    });
    expectStatus(response, 409, "reject differently-cased duplicate");
    assert.strictEqual(response.body.error.code, "CONFLICT");

    response = await api.post("/promo-codes").send({
      code: "SECOND",
      discountType: "fixed",
      discountValue: 100,
      appliesTo: "subscription",
    });
    expectStatus(response, 201, "create second promo for update collision");
    response = await api.put(`/promo-codes/${response.body.data.id}`).send({
      code: "  1pass ",
      discountType: "fixed",
      discountValue: 100,
      appliesTo: "subscription",
    });
    expectStatus(response, 409, "reject update to differently-cased duplicate");

    const baseQuote = {
      plan: { _id: new mongoose.Types.ObjectId(), daysCount: 7 },
      breakdown: {
        basePlanPriceHalala: 10000,
        premiumTotalHalala: 0,
        addonsTotalHalala: 0,
        deliveryFeeHalala: 0,
        vatPercentage: 0,
        currency: "SAR",
      },
    };
    const firstApplication = await applyPromoCodeToSubscriptionQuote({
      promoCode: "1Pass",
      userId,
      quote: baseQuote,
    });
    const repeatedApplication = await applyPromoCodeToSubscriptionQuote({
      promoCode: "  1pass ",
      userId,
      quote: firstApplication.quote,
    });
    assert.strictEqual(firstApplication.quote.breakdown.discountHalala, 1000);
    assert.strictEqual(repeatedApplication.quote.breakdown.discountHalala, 1000);
    assert.strictEqual(
      repeatedApplication.quote.breakdown.totalHalala,
      firstApplication.quote.breakdown.totalHalala,
      "re-applying the promo must not compound its discount"
    );

    const checkoutDraft = await CheckoutDraft.create({
      userId,
      planId: baseQuote.plan._id,
      daysCount: 7,
      grams: 200,
      mealsPerDay: 2,
      delivery: { type: "pickup", slot: { type: "pickup" } },
      breakdown: firstApplication.quote.breakdown,
    });
    const reservationArgs = {
      promo: firstApplication.promo,
      appliedPromo: firstApplication.appliedPromo,
      userId,
      checkoutDraftId: checkoutDraft._id,
    };
    await reservePromoCodeUsageForCheckout(reservationArgs);
    await reservePromoCodeUsageForCheckout(reservationArgs);

    assert.strictEqual(
      await PromoUsage.countDocuments({ promoCodeId: promoId, checkoutDraftId: checkoutDraft._id }),
      1,
      "a repeated checkout request must retain one usage record"
    );
    const idempotentPromo = await PromoCode.findById(promoId).lean();
    assert.strictEqual(
      idempotentPromo.currentUsageCount,
      1,
      "a repeated checkout request must increment usage only once"
    );

    console.log("promoCodeCaseInsensitive.test.js: PASS");
  } finally {
    await mongoose.disconnect();
    await replSet.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
