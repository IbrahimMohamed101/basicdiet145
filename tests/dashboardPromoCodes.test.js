process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "promo-app-test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "promo-dashboard-test-secret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const { JWT_SECRET } = require("../src/middleware/auth");
const PromoCode = require("../src/models/PromoCode");
const PromoUsage = require("../src/models/PromoUsage");
const User = require("../src/models/User");

let mongoServer;

function expectStatus(response, status, label) {
  assert.strictEqual(
    response.status,
    status,
    `${label}: expected ${status}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

async function main() {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(`dashboard_promo_codes_${Date.now()}`));

  try {
    const api = request(createApp());
    const { headers: adminHeaders, user: admin } = await dashboardAuth("admin", "promo-codes");
    const { headers: cashierHeaders } = await dashboardAuth("cashier", "promo-codes");

    let response = await api.get("/api/dashboard/promo-codes").set(cashierHeaders);
    expectStatus(response, 403, "promo administration is admin-only");

    response = await api.get("/api/dashboard/promo-codes/app-selection").set(adminHeaders);
    expectStatus(response, 200, "app promo selection starts empty");
    assert.deepStrictEqual(response.body.data, {
      promoCodeId: null,
      promoCode: null,
      promoOffer: null,
      isPubliclyDisplayable: false,
      issues: [],
    });

    response = await api.put("/api/dashboard/promo-codes/app-selection").set(adminHeaders).send({});
    expectStatus(response, 400, "selection requires an explicit promoCodeId or null");
    response = await api.put("/api/dashboard/promo-codes/app-selection").set(adminHeaders).send({
      promoCodeId: 0,
    });
    expectStatus(response, 400, "selection rejects ambiguous non-string values");

    response = await api.post("/api/dashboard/promo-codes").set(adminHeaders).send({
      code: "WELCOME10",
      name: { ar: "خصم الترحيب", en: "Welcome discount" },
      discountType: "percentage",
      discountValue: 10,
      usageLimitTotal: 100,
      usageLimitPerUser: 1,
      startsAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      appliesTo: "subscription",
      isActive: true,
      appDisplay: {
        isVisible: true,
        showOnHome: true,
        showOnPlans: true,
        priority: 20,
        title: { ar: "وفّر على اشتراكك", en: "Save on your subscription" },
        description: { ar: "انسخ الكود", en: "Copy the code" },
        homeMessage: { ar: "اعرض الخطط", en: "View plans" },
      },
    });
    expectStatus(response, 201, "create canonical promo DTO");
    const welcomeId = response.body.data.id;
    assert.strictEqual(response.body.data.usageLimitTotal, 100);
    assert.strictEqual(response.body.data.appliesTo, "subscription");
    assert.deepStrictEqual(response.body.data.appDisplay, {
      isVisible: true,
      showOnHome: true,
      showOnPlans: true,
      priority: 20,
      title: { ar: "وفّر على اشتراكك", en: "Save on your subscription" },
      description: { ar: "انسخ الكود", en: "Copy the code" },
      homeMessage: { ar: "اعرض الخطط", en: "View plans" },
    });

    response = await api.post("/api/dashboard/promo-codes").set(adminHeaders).send({
      code: "FIXED500",
      name: { ar: "خصم ثابت" },
      discountType: "fixed_amount",
      discountValue: 500,
      endsAt: "2027-02-01T00:00:00.000Z",
      appliesTo: "all",
    });
    expectStatus(response, 201, "create accepts fixed_amount and endsAt aliases");
    const fixedId = response.body.data.id;
    assert.strictEqual(response.body.data.discountType, "fixed");
    assert.strictEqual(response.body.data.appDisplay.isVisible, false);
    assert.strictEqual(new Date(response.body.data.expiresAt).toISOString(), "2027-02-01T00:00:00.000Z");

    response = await api.post("/api/dashboard/promo-codes").set(adminHeaders).send({
      code: "SUMMER20",
      name: { ar: "عرض الصيف" },
      discountType: "percentage",
      discountValue: 20,
      appliesTo: "subscription",
    });
    expectStatus(response, 201, "create searchable promo");
    const summerId = response.body.data.id;

    response = await api.put("/api/dashboard/promo-codes/app-selection").set(adminHeaders).send({
      promoCodeId: welcomeId,
    });
    expectStatus(response, 200, "select the exact app promo");
    assert.strictEqual(response.body.data.promoCodeId, welcomeId);
    assert.strictEqual(response.body.data.promoCode.code, "WELCOME10");
    assert.strictEqual(response.body.data.promoOffer.code, "WELCOME10");
    assert.strictEqual(response.body.data.promoCode.appDisplay.isVisible, true);
    assert.strictEqual(response.body.data.isPubliclyDisplayable, true);

    response = await api.get("/api/plans");
    expectStatus(response, 200, "public plans exposes only the selected promo");
    assert.strictEqual(response.body.promoOffer.code, "WELCOME10");

    response = await api.put("/api/dashboard/promo-codes/app-selection").set(adminHeaders).send({
      promoCodeId: summerId,
    });
    expectStatus(response, 200, "replace the selected app promo atomically");
    assert.strictEqual(response.body.data.promoCode.code, "SUMMER20");
    response = await api.get("/api/plans");
    expectStatus(response, 200, "public plans follows the changed selection");
    assert.strictEqual(response.body.promoOffer.code, "SUMMER20");

    response = await api.get("/api/dashboard/promo-codes?q=summer&page=1&limit=10").set(adminHeaders);
    expectStatus(response, 200, "search promo list");
    assert.strictEqual(response.body.data.length, 1);
    assert.strictEqual(response.body.data[0].code, "SUMMER20");
    assert.strictEqual(response.body.meta.total, 1);

    response = await api.get("/api/dashboard/promo-codes?page=2&limit=1").set(adminHeaders);
    expectStatus(response, 200, "paginate promo list");
    assert.strictEqual(response.body.data.length, 1);
    assert.strictEqual(response.body.meta.currentPage, 2);
    assert.strictEqual(response.body.meta.limit, 1);
    assert.strictEqual(response.body.meta.total, 3);
    assert.strictEqual(response.body.meta.totalPages, 3);

    response = await api.get("/api/dashboard/promo-codes?page=0&limit=101").set(adminHeaders);
    expectStatus(response, 400, "reject invalid pagination");

    response = await api.put(`/api/dashboard/promo-codes/${welcomeId}`).set(adminHeaders).send({
      code: "WELCOME10",
      name: { ar: "خصم ترحيب محدث" },
      discountType: "fixed_amount",
      discountValue: 750,
      endsAt: "2027-03-01T00:00:00.000Z",
      appliesTo: "subscription",
      isActive: true,
    });
    expectStatus(response, 200, "update accepts supported aliases");
    assert.strictEqual(response.body.data.discountType, "fixed");
    assert.strictEqual(response.body.data.discountValue, 750);

    response = await api.patch(`/api/dashboard/promo-codes/${welcomeId}/toggle`).set(adminHeaders);
    expectStatus(response, 200, "toggle promo");
    assert.strictEqual(response.body.data.isActive, false);
    await PromoCode.updateOne({ _id: welcomeId }, { $set: { isActive: true } });

    response = await api.post("/api/dashboard/promo-codes/validate").set(adminHeaders).send({
      promoCode: "WELCOME10",
      userId: String(admin._id),
      subtotalHalala: 10000,
    });
    expectStatus(response, 200, "validate subscription promo");
    assert.strictEqual(response.body.data.valid, true);
    assert.strictEqual(response.body.data.breakdown.discountHalala, 750);

    await PromoUsage.create({
      promoCodeId: welcomeId,
      userId: admin._id,
      checkoutDraftId: new mongoose.Types.ObjectId(),
      code: "WELCOME10",
      discountAmountHalala: 750,
      status: "consumed",
      orderType: "subscription_checkout",
    });
    response = await api.get(`/api/dashboard/promo-codes/${welcomeId}`).set(adminHeaders);
    expectStatus(response, 200, "promo detail with recent usage");
    assert.strictEqual(response.body.data.recentUsage.length, 1);
    assert.strictEqual(response.body.data.recentUsage[0].discountAmountHalala, 750);
    assert(response.body.data.recentUsage[0].checkoutDraftId);

    await PromoCode.updateOne(
      { _id: welcomeId },
      { $set: { usageLimitTotal: 1, currentUsageCount: 1 } }
    );
    response = await api.get(`/api/dashboard/promo-codes/${welcomeId}`).set(adminHeaders);
    expectStatus(response, 200, "exhausted promo detail");
    assert.strictEqual(response.body.data.state.isUsageExhausted, true);
    assert.strictEqual(response.body.data.state.isCurrentlyValid, false);

    response = await api.delete(`/api/dashboard/promo-codes/${welcomeId}`).set(adminHeaders);
    expectStatus(response, 409, "promo with usage cannot be archived");

    response = await api.put("/api/dashboard/promo-codes/app-selection").set(adminHeaders).send({
      promoCodeId: fixedId,
    });
    expectStatus(response, 200, "select an unused promo before archiving it");

    response = await api.delete(`/api/dashboard/promo-codes/${fixedId}`).set(adminHeaders);
    expectStatus(response, 200, "unused promo is soft archived");
    assert(response.body.data.deletedAt);
    assert.strictEqual(response.body.data.isActive, false);

    response = await api.get("/api/dashboard/promo-codes/app-selection").set(adminHeaders);
    expectStatus(response, 200, "archiving the selected promo clears the singleton selection");
    assert.strictEqual(response.body.data.promoCodeId, null);
    response = await api.get("/api/plans");
    expectStatus(response, 200, "public plans hides the promo after selection is cleared");
    assert.strictEqual(response.body.promoOffer, null);

    response = await api.get("/api/dashboard/promo-codes?q=FIXED500&page=1&limit=10").set(adminHeaders);
    expectStatus(response, 200, "archived promos excluded by default");
    assert.strictEqual(response.body.meta.total, 0);
    response = await api.get("/api/dashboard/promo-codes?q=FIXED500&includeDeleted=true&page=1&limit=10").set(adminHeaders);
    expectStatus(response, 200, "includeDeleted returns archived promos");
    assert.strictEqual(response.body.meta.total, 1);
    assert.strictEqual(response.body.data[0].state.isDeleted, true);

    response = await api.get("/api/dashboard/promo-codes").set(adminHeaders);
    expectStatus(response, 200, "unpaginated compatibility response");
    assert(Array.isArray(response.body.data));
    assert(response.body.meta);

    const appUser = await User.create({
      phone: `+9665${Date.now().toString().slice(-8)}`,
      name: "Promo order test",
      role: "client",
      isActive: true,
    });
    const appToken = jwt.sign(
      { userId: String(appUser._id), role: "client", tokenType: "app_access" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    response = await api.post("/api/orders/checkout")
      .set({ Authorization: `Bearer ${appToken}`, "Idempotency-Key": "promo-one-time-unchanged" })
      .send({ promoCode: "WELCOME10" });
    expectStatus(response, 400, "one-time checkout still rejects promo codes");
    assert.strictEqual(response.body.error.code, "PROMO_NOT_APPLICABLE_TO_ORDER_TYPE");

    console.log("dashboardPromoCodes.test.js: PASS");
  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
