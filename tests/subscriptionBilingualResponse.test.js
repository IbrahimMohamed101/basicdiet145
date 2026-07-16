process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  normalizeSubscriptionBilingualResponse,
  requestedLanguage,
} = require("../src/utils/subscriptionBilingualResponse");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function testAddonChoicesDefaultToArabicAndKeepEnglish() {
  const payload = {
    status: true,
    data: {
      dessert: {
        category: "dessert",
        choices: [{
          id: "1",
          name: "Chocolate Ice Cream",
          nameAr: "آيس كريم شوكولاتة",
          nameI18n: { ar: "آيس كريم شوكولاتة", en: "Chocolate Ice Cream" },
          description: "Chocolate dessert",
          descriptionI18n: { ar: "حلوى بالشوكولاتة", en: "Chocolate dessert" },
        }],
      },
    },
  };

  const result = normalizeSubscriptionBilingualResponse(clone(payload), {
    originalUrl: "/api/subscriptions/addon-choices",
    query: {},
    headers: {},
  });
  const group = result.data.dessert;
  const choice = group.choices[0];

  assert.strictEqual(group.label, "الحلويات");
  assert.deepStrictEqual(group.labelI18n, { ar: "الحلويات", en: "Desserts" });
  assert.strictEqual(choice.name, "آيس كريم شوكولاتة");
  assert.strictEqual(choice.nameAr, "آيس كريم شوكولاتة");
  assert.strictEqual(choice.nameEn, "Chocolate Ice Cream");
  assert.deepStrictEqual(choice.nameI18n, { ar: "آيس كريم شوكولاتة", en: "Chocolate Ice Cream" });
  assert.strictEqual(choice.description, "حلوى بالشوكولاتة");
  assert.strictEqual(choice.descriptionEn, "Chocolate dessert");
}

function testExplicitEnglishStillWorks() {
  const payload = {
    data: {
      snack: {
        category: "snack",
        choices: [{ nameI18n: { ar: "سناك بروتين", en: "Protein Snack" } }],
      },
    },
  };
  const result = normalizeSubscriptionBilingualResponse(clone(payload), {
    originalUrl: "/api/subscriptions/addon-choices?lang=en",
    query: { lang: "en" },
    headers: {},
  });
  assert.strictEqual(result.data.snack.label, "Snacks");
  assert.strictEqual(result.data.snack.choices[0].name, "Protein Snack");
  assert.strictEqual(result.data.snack.choices[0].nameAr, "سناك بروتين");
}

function testPickupAvailabilityGetsFlatBilingualCompatibilityFields() {
  const payload = {
    status: true,
    data: {
      pickupItems: [{
        title: { ar: "كرات لحم وباستا ألفريدو", en: "Meatballs / Alfredo Pasta" },
        subtitle: { ar: "إضافة مدفوعة", en: "Paid add-on" },
        product: {
          name: { ar: "آيس كريم شوكولاتة", en: "Chocolate Ice Cream" },
          description: { ar: "", en: "" },
        },
      }],
    },
  };
  const result = normalizeSubscriptionBilingualResponse(clone(payload), {
    originalUrl: "/api/subscriptions/507f1f77bcf86cd799439011/pickup-availability",
    query: {},
    headers: {},
  });
  const item = result.data.pickupItems[0];
  assert.strictEqual(item.titleText, "كرات لحم وباستا ألفريدو");
  assert.strictEqual(item.titleAr, "كرات لحم وباستا ألفريدو");
  assert.strictEqual(item.titleEn, "Meatballs / Alfredo Pasta");
  assert.strictEqual(item.subtitleText, "إضافة مدفوعة");
  assert.deepStrictEqual(item.title, { ar: "كرات لحم وباستا ألفريدو", en: "Meatballs / Alfredo Pasta" });
}

function testUnrelatedEndpointsAreUntouched() {
  const payload = { data: { nameI18n: { ar: "عربي", en: "English" }, name: "English" } };
  const result = normalizeSubscriptionBilingualResponse(clone(payload), {
    originalUrl: "/api/dashboard/menu/products",
    query: {},
    headers: {},
  });
  assert.deepStrictEqual(result, payload);
}

function run() {
  assert.strictEqual(requestedLanguage({ query: {}, headers: {} }), "ar");
  testAddonChoicesDefaultToArabicAndKeepEnglish();
  testExplicitEnglishStillWorks();
  testPickupAvailabilityGetsFlatBilingualCompatibilityFields();
  testUnrelatedEndpointsAreUntouched();
  console.log("subscription bilingual response checks passed");
}

run();
