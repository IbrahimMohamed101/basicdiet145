"use strict";

const MEAL_TYPES = new Set(["standard_meal", "premium_meal"]);
const DIRECT_TYPES = new Set(["sandwich", "full_meal_product", "product", "basic_meal", "basic_salad", "premium_large_salad"]);

function hasArabic(value) {
  return typeof value === "string" && /[\u0600-\u06FF]/.test(value.trim());
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function fail(path, message, value) {
  const error = new Error(`${message} at ${path}`);
  error.code = "KITCHEN_ARABIC_RESPONSE_CONTRACT_MISMATCH";
  error.path = path;
  error.value = value;
  throw error;
}

function assertArabic(value, path) {
  if (!hasArabic(value)) fail(path, "Arabic text is required", value);
  if (/\[object Object\]/i.test(value)) fail(path, "Object coercion is forbidden", value);
}

function validateCard(card, path) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    fail(path, "Kitchen card must be an object", card);
  }

  const type = String(card.type || "");
  const titleAr = card.titleI18n && card.titleI18n.ar;
  assertArabic(titleAr || card.title, `${path}.titleI18n.ar`);

  const components = card.components && typeof card.components === "object" ? card.components : {};
  if (MEAL_TYPES.has(type)) {
    if (!components.protein || typeof components.protein !== "object") {
      fail(`${path}.components.protein`, "Meal protein is required", components.protein);
    }
    assertArabic(
      (components.protein.nameI18n && components.protein.nameI18n.ar) || components.protein.name,
      `${path}.components.protein.nameI18n.ar`
    );
    if (!positiveNumber(components.protein.grams)) {
      fail(`${path}.components.protein.grams`, "Positive protein grams are required", components.protein.grams);
    }

    const carbs = Array.isArray(components.carbs) ? components.carbs : [];
    for (let index = 0; index < carbs.length; index += 1) {
      const carb = carbs[index];
      assertArabic(
        (carb.nameI18n && carb.nameI18n.ar) || carb.name,
        `${path}.components.carbs[${index}].nameI18n.ar`
      );
      if (!positiveNumber(carb.grams)) {
        fail(`${path}.components.carbs[${index}].grams`, "Positive carb grams are required", carb.grams);
      }
    }
  }

  if (DIRECT_TYPES.has(type) && components.product) {
    assertArabic(
      (components.product.nameI18n && components.product.nameI18n.ar) || components.product.name,
      `${path}.components.product.nameI18n.ar`
    );
  }

  const lines = Array.isArray(card.lines) ? card.lines : [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    if (/\[object Object\]/i.test(line)) {
      fail(`${path}.lines[${index}]`, "Object coercion is forbidden", line);
    }
  }

  return card;
}

function validateAddonGroup(group, path) {
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    fail(path, "Add-on group must be an object", group);
  }
  assertArabic(
    (group.labelI18n && group.labelI18n.ar) || group.label,
    `${path}.labelI18n.ar`
  );
  const items = Array.isArray(group.items) ? group.items : [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    assertArabic(
      (item.nameI18n && item.nameI18n.ar) || item.name,
      `${path}.items[${index}].nameI18n.ar`
    );
    if (!item.productId && item.name !== "لم يتم تحديد منتج الإضافة") {
      fail(`${path}.items[${index}].productId`, "Missing add-on product must be explicit", item.productId);
    }
  }
  return group;
}

function validateKitchenOperation(operation, path = "operation") {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    fail(path, "Operation must be an object", operation);
  }
  const kitchen = operation.kitchen;
  if (!kitchen || typeof kitchen !== "object" || Array.isArray(kitchen)) {
    fail(`${path}.kitchen`, "Canonical kitchen object is required", kitchen);
  }
  if (kitchen.version !== "v2") {
    fail(`${path}.kitchen.version`, "Kitchen v2 is required", kitchen.version);
  }
  const cards = Array.isArray(kitchen.cards) ? kitchen.cards : [];
  cards.forEach((card, index) => validateCard(card, `${path}.kitchen.cards[${index}]`));
  const addonGroups = Array.isArray(kitchen.addonGroups) ? kitchen.addonGroups : [];
  addonGroups.forEach((group, index) => validateAddonGroup(group, `${path}.kitchen.addonGroups[${index}]`));
  return operation;
}

function validateKitchenOperationsResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    fail("response", "Response must be an object", response);
  }
  if (response.status !== true) fail("response.status", "Successful status is required", response.status);
  if (!Array.isArray(response.data)) fail("response.data", "Response data must be an array", response.data);
  response.data.forEach((operation, index) => validateKitchenOperation(operation, `response.data[${index}]`));
  return response;
}

module.exports = {
  validateKitchenOperation,
  validateKitchenOperationsResponse,
};
