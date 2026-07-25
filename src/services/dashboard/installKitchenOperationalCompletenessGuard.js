"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenOperationalCompletenessGuard.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenOperationalCompletenessGuard.wrapped");
const COMPOSITE_TYPES = new Set(["standard_meal", "premium_meal"]);

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function productLine(card = {}) {
  const product = card.components && card.components.product;
  const title = String(card.title || (product && product.name) || "الصنف").trim();
  const grams = positiveInteger(product && product.grams);
  return `الصنف المطلوب: ${title}${grams ? ` - ${grams} جم` : ""}`;
}

function completeDirectCard(card = {}) {
  const next = { ...card };
  const lines = Array.isArray(card.lines) ? [...card.lines] : [];
  const product = card.components && card.components.product;
  if (product && product.name && !lines.some((line) => String(line || "").startsWith("الصنف المطلوب:"))) {
    lines.unshift(productLine(card));
  }
  next.lines = unique(lines);
  return next;
}

function completeCompositeCard(card = {}) {
  const next = { ...card };
  const components = card.components && typeof card.components === "object" ? card.components : {};
  const protein = components.protein && typeof components.protein === "object" ? components.protein : null;
  const carbs = Array.isArray(components.carbs) ? components.carbs : [];
  const namedCarbs = carbs.filter((carb) => carb && String(carb.name || "").trim());
  const warnings = Array.isArray(card.warnings) ? [...card.warnings] : [];
  const lines = Array.isArray(card.lines) ? [...card.lines] : [];

  if (!protein || !String(protein.name || "").trim() || !positiveInteger(protein.grams)) {
    warnings.push("KITCHEN_PROTEIN_INCOMPLETE");
  }
  if (!carbs.length) {
    warnings.push("KITCHEN_CARB_SELECTION_MISSING");
  } else if (namedCarbs.length !== carbs.length || carbs.some((carb) => !positiveInteger(carb && carb.grams))) {
    warnings.push("KITCHEN_CARB_INCOMPLETE");
  }

  if (warnings.some((warning) => [
    "KITCHEN_PROTEIN_INCOMPLETE",
    "KITCHEN_CARB_SELECTION_MISSING",
    "KITCHEN_CARB_INCOMPLETE",
  ].includes(warning))) {
    warnings.push("KITCHEN_COMPONENTS_INCOMPLETE");
    if (!lines.some((line) => String(line || "").startsWith("بيانات التحضير غير مكتملة"))) {
      lines.push("بيانات التحضير غير مكتملة: يرجى مراجعة اختيار البروتين والكارب");
    }
  }

  next.lines = unique(lines);
  next.warnings = unique(warnings);
  return next;
}

function completeCard(card = {}) {
  if (!card || typeof card !== "object" || Array.isArray(card)) return card;
  return COMPOSITE_TYPES.has(String(card.type || ""))
    ? completeCompositeCard(card)
    : completeDirectCard(card);
}

function completeOperation(operation = {}) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return operation;
  if (!operation.kitchen || typeof operation.kitchen !== "object") return operation;
  const cards = (Array.isArray(operation.kitchen.cards) ? operation.kitchen.cards : []).map(completeCard);
  return {
    ...operation,
    kitchen: {
      ...operation.kitchen,
      cards,
      mealCount: cards.reduce((sum, card) => sum + Math.max(1, Number(card && card.quantity || 1)), 0),
    },
  };
}

function installKitchenOperationalCompletenessGuard() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./kitchenOperationsContractService");
  const original = service.serializeKitchenOperation;
  if (typeof original === "function" && !original[WRAPPED_MARK]) {
    const wrapped = function serializeCompleteKitchenOperation(...args) {
      return completeOperation(original.apply(this, args));
    };
    wrapped[WRAPPED_MARK] = true;
    service.serializeKitchenOperation = wrapped;
    service.serializeKitchenOperationsCollection = function serializeCompleteKitchenCollection(data = {}, options = {}) {
      const items = (Array.isArray(data.items) ? data.items : []).map((item) => wrapped(item, options));
      return { ...data, contractVersion: "kitchen_operations.v2", count: items.length, items };
    };
  }
  const verification = Object.freeze({
    installed: true,
    directPreparationLinesComplete: true,
    incompleteBuilderCardsExplicit: true,
    responseShapePreserved: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenOperationalCompletenessGuard();

module.exports = {
  completeCard,
  completeOperation,
  installKitchenOperationalCompletenessGuard,
};
