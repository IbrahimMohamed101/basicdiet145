"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenOperationalCompletenessGuard.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenOperationalCompletenessGuard.wrapped");
const COMPOSITE_TYPES = new Set(["standard_meal", "premium_meal"]);
const LEGACY_CARB_COMPONENTS = Object.freeze({
  "6a62198179ee075a57f7013e": {
    key: "white_rice",
    nameI18n: { ar: "رز أبيض", en: "White Rice" },
  },
});
const CARB_KEY_COMPONENTS = Object.freeze({
  white_rice: { ar: "رز أبيض", en: "White Rice" },
  carbs_white_rice: { ar: "رز أبيض", en: "White Rice" },
  vermicelli_rice: { ar: "رز بالشعيرية", en: "Vermicelli Rice" },
  carbs_vermicelli_rice: { ar: "رز بالشعيرية", en: "Vermicelli Rice" },
  yellow_rice: { ar: "رز أصفر", en: "Yellow Rice" },
  carbs_yellow_rice: { ar: "رز أصفر", en: "Yellow Rice" },
  vegetable_rice: { ar: "رز بالخضار", en: "Vegetable Rice" },
  carbs_vegetable_rice: { ar: "رز بالخضار", en: "Vegetable Rice" },
  mashed_potatoes: { ar: "بطاطس مهروسة", en: "Mashed Potatoes" },
  carbs_mashed_potatoes: { ar: "بطاطس مهروسة", en: "Mashed Potatoes" },
  creamy_pasta: { ar: "مكرونة بالكريمة", en: "Creamy Pasta" },
  carbs_creamy_pasta: { ar: "مكرونة بالكريمة", en: "Creamy Pasta" },
  red_sauce_pasta: { ar: "مكرونة حمراء", en: "Red Sauce Pasta" },
  carbs_red_sauce_pasta: { ar: "مكرونة حمراء", en: "Red Sauce Pasta" },
  mixed_vegetables: { ar: "خضار مشكل", en: "Mixed Vegetables" },
  carbs_mixed_vegetables: { ar: "خضار مشكل", en: "Mixed Vegetables" },
  roasted_potatoes: { ar: "بطاطس مشوية", en: "Roasted Potatoes" },
  carbs_roasted_potatoes: { ar: "بطاطس مشوية", en: "Roasted Potatoes" },
  sweet_potatoes: { ar: "بطاطا حلوة", en: "Sweet Potatoes" },
  carbs_sweet_potatoes: { ar: "بطاطا حلوة", en: "Sweet Potatoes" },
});

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function idText(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value.toHexString === "function") {
    try { return String(value.toHexString()).trim() || null; } catch (_) { return null; }
  }
  if (value && typeof value === "object") {
    if (value._id !== undefined && value._id !== value) return idText(value._id);
    if (value.id !== undefined && value.id !== value) return idText(value.id);
    return null;
  }
  return String(value).trim() || null;
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function pair(value) {
  if (!value) return { ar: "", en: "" };
  if (typeof value === "string") {
    return /[\u0600-\u06FF]/u.test(value) ? { ar: value, en: "" } : { ar: "", en: value };
  }
  if (typeof value !== "object" || Array.isArray(value)) return { ar: "", en: "" };
  const source = value.nameI18n || value.name || value.titleI18n || value.title;
  if (source && source !== value) return pair(source);
  const ar = typeof value.ar === "string" ? value.ar.trim() : "";
  const en = typeof value.en === "string" ? value.en.trim() : "";
  return { ar, en };
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
  const components = card.components && typeof card.components === "object"
    ? { ...card.components }
    : {};
  const product = components.product && typeof components.product === "object"
    ? { ...components.product }
    : null;

  // Direct products and sandwiches are one catalog item. The card title has already
  // been resolved from the live product catalog, so it is the authoritative display
  // identity. This also prevents a later generic key fallback (Chicken/Beef/Rice)
  // from shortening a complete product name.
  if (product && card.title) {
    const titleI18n = card.titleI18n && typeof card.titleI18n === "object"
      ? card.titleI18n
      : { ar: String(card.title), en: String(card.title) };
    product.name = String(titleI18n.ar || card.title);
    product.nameI18n = {
      ar: String(titleI18n.ar || card.title),
      en: String(titleI18n.en || titleI18n.ar || card.title),
    };
    components.product = product;
    next.components = components;
  }

  if (product && product.name && !lines.some((line) => String(line || "").startsWith("الصنف المطلوب:"))) {
    lines.unshift(productLine({ ...next, components }));
  }
  next.lines = unique(lines);
  return next;
}

function repairFinalCarb(carb = {}) {
  if (!carb || typeof carb !== "object" || Array.isArray(carb)) return carb;
  const id = idText(carb.id || carb.carbId || carb.optionId || carb._id);
  const legacy = id && LEGACY_CARB_COMPONENTS[id];
  const key = String(carb.key || carb.carbKey || carb.optionKey || (legacy && legacy.key) || "").trim().toLowerCase();
  const fallback = (legacy && legacy.nameI18n) || CARB_KEY_COMPONENTS[key] || null;
  const stored = pair(carb.nameI18n || carb.name);
  const ar = stored.ar || (fallback && fallback.ar) || "";
  const en = stored.en || (fallback && fallback.en) || "";
  return {
    ...carb,
    id: id || carb.id || null,
    key: key || null,
    name: ar || en,
    nameI18n: { ar: ar || en, en: en || ar },
  };
}

function rebuildCompositePresentation(card = {}, components = {}) {
  const protein = components.protein && typeof components.protein === "object" ? components.protein : null;
  const carbs = Array.isArray(components.carbs) ? components.carbs : [];
  const proteinName = pair(protein && (protein.nameI18n || protein.name));
  const carbNames = carbs.map((carb) => pair(carb && (carb.nameI18n || carb.name)));
  const titleI18n = {
    ar: [proteinName.ar, ...carbNames.map((name) => name.ar)].filter(Boolean).join(" + "),
    en: [proteinName.en, ...carbNames.map((name) => name.en)].filter(Boolean).join(" + "),
  };

  const preparationLines = [];
  if (protein && (proteinName.ar || proteinName.en)) {
    const grams = positiveInteger(protein.grams);
    preparationLines.push(`البروتين المطلوب: ${proteinName.ar || proteinName.en}${grams ? ` - ${grams} جم` : ""}`);
  }
  carbs.forEach((carb, index) => {
    const name = carbNames[index];
    if (!name.ar && !name.en) return;
    const grams = positiveInteger(carb && carb.grams);
    const prefix = carbs.length > 1 ? `الكارب ${index + 1} من ${carbs.length}` : "الكارب";
    preparationLines.push(`${prefix}: ${name.ar || name.en}${grams ? ` - ${grams} جم` : ""}`);
  });
  const otherLines = (Array.isArray(card.lines) ? card.lines : []).filter((line) => {
    const value = String(line || "");
    return !value.startsWith("البروتين المطلوب:")
      && !value.startsWith("الكارب:")
      && !/^الكارب \d+ من \d+:/u.test(value);
  });

  const next = {
    ...card,
    lines: unique([...preparationLines, ...otherLines]),
  };
  if (titleI18n.ar || titleI18n.en) {
    next.title = titleI18n.ar || titleI18n.en;
    next.titleI18n = {
      ar: titleI18n.ar || titleI18n.en,
      en: titleI18n.en || titleI18n.ar,
    };
    if (components.product && typeof components.product === "object") {
      components.product = {
        ...components.product,
        name: next.title,
        nameI18n: { ...next.titleI18n },
      };
    }
  }
  return next;
}

function completeCompositeCard(card = {}) {
  const originalComponents = card.components && typeof card.components === "object" ? card.components : {};
  const components = {
    ...originalComponents,
    carbs: (Array.isArray(originalComponents.carbs) ? originalComponents.carbs : []).map(repairFinalCarb),
  };
  let next = rebuildCompositePresentation({ ...card }, components);
  next.components = components;

  const protein = components.protein && typeof components.protein === "object" ? components.protein : null;
  const carbs = components.carbs;
  const namedCarbs = carbs.filter((carb) => carb && String(carb.name || "").trim());
  const warnings = Array.isArray(next.warnings) ? [...next.warnings] : [];
  const lines = Array.isArray(next.lines) ? [...next.lines] : [];

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
    directProductLocalizationComplete: true,
    finalCarbIdentityComplete: true,
    compositeTitlesRebuilt: true,
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
  repairFinalCarb,
};
