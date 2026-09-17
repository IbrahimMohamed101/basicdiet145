"use strict";

const assert = require("assert");
const {
  buildPublicMenuV2,
  normalizeOneTimeMenuPayload,
} = require("../src/services/orders/orderMenuService");

function carbOption({ id, key, ar, en, sortOrder }) {
  return {
    id,
    optionId: id,
    groupId: "group-carbs",
    key,
    name: ar,
    nameI18n: { ar, en },
    displayCategoryKey: "standard_carbs",
    sortOrder,
  };
}

function main() {
  const source = {
    source: "one_time_order",
    fulfillmentMethod: "pickup",
    currency: "SAR",
    categories: [
      {
        id: "category-meals",
        key: "meals",
        name: "الوجبات",
        products: [
          {
            id: "product-beef-steak",
            key: "beef_steak",
            name: "بيف ستيك",
            isCustomizable: true,
            optionGroups: [
              {
                id: "group-carbs",
                groupId: "group-carbs",
                key: "carbs",
                sourceKey: "carbs",
                name: "نشويات",
                nameI18n: { ar: "نشويات", en: "Carbs" },
                options: [
                  carbOption({
                    id: "white-rice-a",
                    key: "carbs_white_rice",
                    ar: "رز أبيض",
                    en: "White Rice",
                    sortOrder: 10,
                  }),
                  carbOption({
                    id: "red-pasta-a",
                    key: "red_sauce_pasta",
                    ar: "مكرونة حمراء",
                    en: "Red Sauce Pasta",
                    sortOrder: 20,
                  }),
                  carbOption({
                    id: "white-rice-a",
                    key: "carbs_white_rice",
                    ar: "رز أبيض",
                    en: "White Rice",
                    sortOrder: 10,
                  }),
                ],
              },
              {
                id: "group-standard-carbs",
                groupId: "group-standard-carbs",
                key: "standard_carbs",
                sourceKey: "standard_carbs",
                name: "النشويات",
                nameI18n: { ar: "النشويات", en: "Carbohydrates" },
                options: [
                  carbOption({
                    id: "white-rice-b",
                    key: "white_rice",
                    ar: "رز أبيض",
                    en: "White Rice",
                    sortOrder: 10,
                  }),
                  carbOption({
                    id: "red-pasta-b",
                    key: "carbs_red_sauce_pasta",
                    ar: "مكرونة حمراء",
                    en: "Red Sauce Pasta",
                    sortOrder: 20,
                  }),
                  carbOption({
                    id: "sweet-potato",
                    key: "sweet_potato",
                    ar: "بطاطا حلوة",
                    en: "Sweet Potato",
                    sortOrder: 30,
                  }),
                ],
              },
              {
                id: "group-proteins",
                groupId: "group-proteins",
                key: "proteins",
                sourceKey: "proteins",
                name: "البروتين",
                options: [
                  {
                    id: "beef-steak-option",
                    optionId: "beef-steak-option",
                    key: "beef_steak",
                    name: "بيف ستيك",
                    sortOrder: 10,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    standardMeals: {
      carbs: [
        { id: "legacy-white-a", key: "carbs_white_rice", name: "رز أبيض" },
        { id: "legacy-white-b", key: "white_rice", name: "رز أبيض" },
      ],
    },
  };

  const normalized = normalizeOneTimeMenuPayload(source);
  const product = normalized.categories[0].products[0];
  const carbGroups = product.optionGroups.filter((group) => (
    String(group.key || "").includes("carb")
    || String(group.name || "").includes("نشويات")
  ));

  assert.strictEqual(carbGroups.length, 1, "duplicate carb groups must merge into one group");
  assert.deepStrictEqual(
    carbGroups[0].options.map((option) => option.name),
    ["رز أبيض", "مكرونة حمراء", "بطاطا حلوة"],
    "same carb must appear once even when ids and key prefixes differ"
  );
  assert.strictEqual(product.optionGroups.length, 2, "unrelated protein group must remain");
  assert.strictEqual(normalized.standardMeals.carbs.length, 1, "legacy one-time carbs must also be unique");
  assert.strictEqual(source.categories[0].products[0].optionGroups.length, 3, "normalization must not mutate source data");

  const publicV2 = buildPublicMenuV2(normalized);
  const v2Product = publicV2.sections[0].products[0];
  assert.strictEqual(v2Product.optionGroups.length, 2);
  assert.strictEqual(v2Product.optionGroups[0].options.length, 3);

  console.log("oneTimeMenuDeduplication.test.js passed");
}

main();
