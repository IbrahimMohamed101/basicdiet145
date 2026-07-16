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

function testPickupAvailabilityGetsCompleteBilingualCompatibilityFields() {
  const payload = {
    status: true,
    data: {
      summary: {
        titleAr: "عناصر متاحة للاستلام",
        titleEn: "Items available for pickup",
        emptyTextAr: "لا توجد عناصر متاحة",
        emptyTextEn: "No items are available",
      },
      pickupItems: [{
        title: { ar: "كرات لحم وباستا ألفريدو", en: "Meatballs / Alfredo Pasta" },
        subtitle: { ar: "إضافة مدفوعة", en: "Paid add-on" },
        product: {
          name: { ar: "آيس كريم شوكولاتة", en: "Chocolate Ice Cream" },
          description: { ar: "وصف عربي", en: "English description" },
        },
        display: {
          titleAr: "آيس كريم شوكولاتة",
          titleEn: "Chocolate Ice Cream",
          statusTextAr: "متاح للاستلام",
          statusTextEn: "Available for pickup",
          selectionTextAr: "اختر هذا العنصر للاستلام",
          selectionTextEn: "Select this item for pickup",
          unavailableTextAr: "",
          unavailableTextEn: "",
          badgesAr: ["مدفوعة"],
          badgesEn: ["Paid"],
        },
        availability: {
          reasonLabel: { ar: "يجب إتمام الدفع أولاً", en: "Payment must be completed first" },
        },
        components: [{
          name: { ar: "دجاج", en: "Chicken" },
          groupName: { ar: "البروتين", en: "Protein" },
        }],
      }],
      sections: [{
        key: "addons",
        titleAr: "الإضافات",
        titleEn: "Add-ons",
      }],
    },
  };

  const result = normalizeSubscriptionBilingualResponse(clone(payload), {
    originalUrl: "/api/subscriptions/507f1f77bcf86cd799439011/pickup-availability",
    query: {},
    headers: {},
  });
  const item = result.data.pickupItems[0];
  const display = item.display;

  assert.strictEqual(result.data.summary.titleText, "عناصر متاحة للاستلام");
  assert.deepStrictEqual(result.data.summary.titleI18n, {
    ar: "عناصر متاحة للاستلام",
    en: "Items available for pickup",
  });
  assert.strictEqual(result.data.summary.emptyText, "لا توجد عناصر متاحة");
  assert.deepStrictEqual(result.data.summary.emptyTextI18n, {
    ar: "لا توجد عناصر متاحة",
    en: "No items are available",
  });

  assert.strictEqual(item.titleText, "كرات لحم وباستا ألفريدو");
  assert.strictEqual(item.titleAr, "كرات لحم وباستا ألفريدو");
  assert.strictEqual(item.titleEn, "Meatballs / Alfredo Pasta");
  assert.strictEqual(item.subtitleText, "إضافة مدفوعة");
  assert.deepStrictEqual(item.title, { ar: "كرات لحم وباستا ألفريدو", en: "Meatballs / Alfredo Pasta" });

  assert.strictEqual(display.titleText, "آيس كريم شوكولاتة");
  assert.strictEqual(display.statusText, "متاح للاستلام");
  assert.deepStrictEqual(display.statusTextI18n, { ar: "متاح للاستلام", en: "Available for pickup" });
  assert.strictEqual(display.selectionText, "اختر هذا العنصر للاستلام");
  assert.deepStrictEqual(display.selectionTextI18n, {
    ar: "اختر هذا العنصر للاستلام",
    en: "Select this item for pickup",
  });
  assert.deepStrictEqual(display.badges, ["مدفوعة"]);
  assert.deepStrictEqual(display.badgesI18n, [{ ar: "مدفوعة", en: "Paid" }]);

  assert.strictEqual(result.data.sections[0].titleText, "الإضافات");
  assert.deepStrictEqual(result.data.sections[0].titleI18n, { ar: "الإضافات", en: "Add-ons" });
  assert.deepStrictEqual(item.product.name, { ar: "آيس كريم شوكولاتة", en: "Chocolate Ice Cream" });
  assert.deepStrictEqual(item.components[0].name, { ar: "دجاج", en: "Chicken" });
}

function testPickupAvailabilityEnglishSelectionKeepsArabicPair() {
  const payload = {
    data: {
      summary: { titleAr: "متاح", titleEn: "Available" },
      pickupItems: [{
        title: { ar: "وجبة", en: "Meal" },
        display: {
          statusTextAr: "متاح للاستلام",
          statusTextEn: "Available for pickup",
          badgesAr: ["مميزة"],
          badgesEn: ["Premium"],
        },
      }],
    },
  };
  const result = normalizeSubscriptionBilingualResponse(clone(payload), {
    originalUrl: "/api/subscriptions/507f1f77bcf86cd799439011/pickup-availability?lang=en",
    query: { lang: "en" },
    headers: {},
  });
  assert.strictEqual(result.data.summary.titleText, "Available");
  assert.strictEqual(result.data.pickupItems[0].titleText, "Meal");
  assert.strictEqual(result.data.pickupItems[0].display.statusText, "Available for pickup");
  assert.deepStrictEqual(result.data.pickupItems[0].display.statusTextI18n, {
    ar: "متاح للاستلام",
    en: "Available for pickup",
  });
  assert.deepStrictEqual(result.data.pickupItems[0].display.badges, ["Premium"]);
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
  testPickupAvailabilityGetsCompleteBilingualCompatibilityFields();
  testPickupAvailabilityEnglishSelectionKeepsArabicPair();
  testUnrelatedEndpointsAreUntouched();
  console.log("subscription bilingual response checks passed");
}

run();
