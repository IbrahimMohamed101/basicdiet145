"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const { createApp } = require("../src/app");
const DashboardUser = require("../src/models/DashboardUser");
const opsReadServiceV2 = require("../src/services/dashboard/opsReadServiceV2");
const dashboardDtoService = require("../src/services/dashboard/dashboardDtoService");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");

const IDS = Object.freeze({
  dashboardUser: "507f191e810c19729de88001",
  customer: "507f191e810c19729de88002",
  subscription: "507f191e810c19729de88003",
  day: "507f191e810c19729de88004",
  protein: "6a62197579ee075a57f70112",
  carb: "6a62197f79ee075a57f70138",
});

const protein = {
  _id: IDS.protein,
  key: "chicken",
  proteinFamilyKey: "chicken",
  name: { ar: "دجاج", en: "Chicken" },
};
const carb = {
  _id: IDS.carb,
  key: "white_rice",
  name: { ar: "أرز أبيض", en: "White Rice" },
};
const maps = {
  proteinById: new Map([[IDS.protein, protein]]),
  proteinByKey: new Map([[protein.key, protein]]),
  carbById: new Map([[IDS.carb, carb]]),
  carbByKey: new Map([[carb.key, carb]]),
  optionById: new Map([[IDS.protein, protein], [IDS.carb, carb]]),
  optionByKey: new Map([[protein.key, protein], [carb.key, carb]]),
  productById: new Map(),
  productByKey: new Map(),
  sandwichById: new Map(),
  sandwichByKey: new Map(),
  saladItemById: new Map(),
  saladItemByKey: new Map(),
  addonById: new Map(),
  addonByKey: new Map(),
  addonPlanById: new Map(),
};

const rawDay = {
  _id: IDS.day,
  subscriptionId: IDS.subscription,
  date: "2026-07-25",
  status: "locked",
  createdAt: new Date("2026-07-25T08:00:00.000Z"),
  updatedAt: new Date("2026-07-25T08:05:00.000Z"),
  mealSlots: [{
    slotIndex: 1,
    slotKey: "slot_1",
    status: "complete",
    selectionType: "standard_meal",
    productName: "chicken",
    productNameI18n: { ar: "chicken", en: "chicken" },
    proteinId: IDS.protein,
    proteinKey: "chicken",
    proteinFamilyKey: "chicken",
    proteinName: "chicken",
    proteinNameI18n: { ar: "chicken", en: "chicken" },
    confirmationSnapshot: { protein: { name: "chicken" } },
    carbs: [{ carbId: IDS.carb, name: "", grams: 150 }],
  }],
  addonSelections: [],
};

const subscription = {
  _id: IDS.subscription,
  userId: IDS.customer,
  status: "active",
  deliveryMode: "pickup",
  selectedGrams: 100,
  selectedMealsPerDay: 1,
  pickupLocationId: "main",
  planId: {
    _id: "507f191e810c19729de88005",
    name: { ar: "اشتراك اختبار", en: "Test Subscription" },
  },
};
const customer = {
  _id: IDS.customer,
  name: "عميل الاختبار",
  phone: "+966500000000",
};

function buildDto(lang) {
  const dto = dashboardDtoService.mapSubscriptionDayToDTO(
    rawDay,
    null,
    subscription,
    customer,
    "kitchen",
    lang,
    maps
  );
  dto.ui.label = lang === "ar" ? "مغلق" : "Locked";
  dto.statusLabel = dto.ui.label;
  return dto;
}

function assertArabicResponse(body, requestLabel) {
  assert.strictEqual(body.status, true, `${requestLabel}: status`);
  assert(Array.isArray(body.data) && body.data.length === 1, `${requestLabel}: one operation expected`);
  const card = body.data[0].kitchen.cards[0];
  assert.strictEqual(card.title, "دجاج + أرز أبيض", `${requestLabel}: Arabic title`);
  assert.strictEqual(card.titleI18n.ar, "دجاج + أرز أبيض", `${requestLabel}: titleI18n.ar`);
  assert.strictEqual(card.titleI18n.en, "Chicken + White Rice", `${requestLabel}: titleI18n.en`);
  assert.strictEqual(card.components.protein.name, "دجاج", `${requestLabel}: protein`);
  assert.strictEqual(card.components.protein.grams, 100, `${requestLabel}: protein grams`);
  assert.strictEqual(card.components.carbs[0].name, "أرز أبيض", `${requestLabel}: carb`);
  assert.strictEqual(card.components.carbs[0].grams, 150, `${requestLabel}: carb grams`);
  assert(card.lines.includes("البروتين المطلوب: دجاج - 100 جم"), `${requestLabel}: protein line`);
  assert(card.lines.includes("الكارب: أرز أبيض - 150 جم"), `${requestLabel}: carb line`);
  const serialized = JSON.stringify(body.data[0].kitchen);
  assert(!serialized.includes("[object Object]"), `${requestLabel}: object coercion`);
  assert(!serialized.includes('"ar":"chicken"'), `${requestLabel}: English must not leak into Arabic`);
}

(async function run() {
  const originalFindById = DashboardUser.findById;
  const originalListOperations = opsReadServiceV2.listOperations;

  DashboardUser.findById = () => ({
    select() { return this; },
    async lean() {
      return {
        _id: IDS.dashboardUser,
        role: "kitchen",
        isActive: true,
        passwordChangedAt: null,
      };
    },
  });
  opsReadServiceV2.listOperations = async ({ lang }) => [buildDto(lang)];

  const token = jwt.sign({
    userId: IDS.dashboardUser,
    role: "kitchen",
    tokenType: "dashboard_access",
  }, DASHBOARD_JWT_SECRET, { expiresIn: "1h" });

  const app = createApp();
  const api = request(app);
  const auth = { Authorization: `Bearer ${token}` };

  try {
    const arPrimary = await api
      .get("/api/dashboard/ops/list?date=2026-07-25")
      .set({ ...auth, "Accept-Language": "ar" });
    assert.strictEqual(arPrimary.status, 200, JSON.stringify(arPrimary.body));
    assertArabicResponse(arPrimary.body, "Arabic primary route");

    const arAlias = await api
      .get("/api/dashboard/operations/list?date=2026-07-25")
      .set({ ...auth, "Accept-Language": "ar-SA" });
    assert.strictEqual(arAlias.status, 200, JSON.stringify(arAlias.body));
    assertArabicResponse(arAlias.body, "Arabic alias route");

    const enPrimary = await api
      .get("/api/dashboard/ops/list?date=2026-07-25")
      .set({ ...auth, "Accept-Language": "en" });
    assert.strictEqual(enPrimary.status, 200, JSON.stringify(enPrimary.body));
    const enCard = enPrimary.body.data[0].kitchen.cards[0];
    assert.strictEqual(enCard.titleI18n.ar, "دجاج + أرز أبيض");
    assert.strictEqual(enCard.titleI18n.en, "Chicken + White Rice");
    assert.strictEqual(enCard.components.carbs[0].grams, 150);

    const missingDate = await api
      .get("/api/dashboard/ops/list")
      .set({ ...auth, "Accept-Language": "ar" });
    assert.strictEqual(missingDate.status, 400);
    assert.strictEqual(missingDate.body.ok, false);

    console.log("Staging kitchen API requests passed: 4 requests");
  } finally {
    DashboardUser.findById = originalFindById;
    opsReadServiceV2.listOperations = originalListOperations;
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
