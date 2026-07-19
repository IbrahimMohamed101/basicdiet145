"use strict";

const MenuProduct = require("../models/MenuProduct");
const {
  MEAL_SELECTION_TYPES,
} = require("../config/mealPlannerContract");
const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");
const {
  classifyMealProduct,
} = require("./catalog/mealProductClassificationService");

let installed = false;

function mealBuilderError(message, code, status = 400, details) {
  return new mealBuilderService.MealBuilderError(message, code, status, details);
}

function normalizeProductIds(value = []) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    ),
  ];
}

function sectionKeyOf(section = {}) {
  return String(section.key || section.sectionKey || "").trim().toLowerCase();
}

function selectedProductIdsOf(section = {}) {
  return normalizeProductIds(section.selectedProductIds || section.productIds || []);
}

async function currentDraftSections() {
  const state = await mealBuilderService.getDashboardState({ lang: "en" });
  return state?.draft?.sections || state?.published?.sections || [];
}

async function canonicalizeSandwichCardProducts(rows = []) {
  const productIds = rows
    .filter(
      (row) =>
        row.classification.directSelectionType === MEAL_SELECTION_TYPES.SANDWICH &&
        row.itemType !== "cold_sandwich" &&
        row.cardVariant === "sandwich_card"
    )
    .map((row) => row.id);
  if (!productIds.length) return;

  await MenuProduct.updateMany(
    { _id: { $in: productIds } },
    { $set: { itemType: "cold_sandwich" } }
  );
}

async function inferDirectCardSelectionType(productIds, requestedSelectionType = "") {
  const ids = normalizeProductIds(productIds);
  if (!ids.length) {
    throw mealBuilderError(
      "A direct product card must contain at least one product",
      "MEAL_BUILDER_CARD_PRODUCTS_REQUIRED",
      422
    );
  }

  const products = await MenuProduct.find({ _id: { $in: ids } })
    .select("key itemType ui.cardVariant")
    .lean();
  const productsById = new Map(
    products.map((product) => [String(product._id), product])
  );
  const missingProductIds = ids.filter((id) => !productsById.has(id));
  if (missingProductIds.length) {
    throw mealBuilderError(
      "Some products do not exist",
      "MEAL_BUILDER_PRODUCT_NOT_FOUND",
      404,
      { productIds: missingProductIds }
    );
  }

  const rows = ids.map((id) => {
    const product = productsById.get(id);
    const classification = classifyMealProduct(product);
    return {
      id,
      key: product.key || "",
      itemType: product.itemType || "",
      cardVariant: product?.ui?.cardVariant || "",
      classification,
    };
  });

  const invalidProducts = rows
    .filter((row) => !row.classification.directCompatible)
    .map((row) => ({
      id: row.id,
      key: row.key,
      itemType: row.itemType,
      cardVariant: row.cardVariant,
      classification: row.classification.kind,
    }));
  if (invalidProducts.length) {
    throw mealBuilderError(
      "Only canonical direct meal products can be added to this card",
      "MEAL_BUILDER_PRODUCT_TYPE_INVALID",
      422,
      { products: invalidProducts }
    );
  }

  const inferredTypes = [
    ...new Set(rows.map((row) => row.classification.directSelectionType)),
  ];
  if (inferredTypes.length !== 1) {
    throw mealBuilderError(
      "Sandwiches and full-meal products must be placed in separate Meal Builder cards",
      "MEAL_BUILDER_DIRECT_CARD_MIXED_TYPES",
      422,
      {
        selectionTypes: inferredTypes,
        products: rows.map((row) => ({
          id: row.id,
          key: row.key,
          selectionType: row.classification.directSelectionType,
        })),
      }
    );
  }

  const inferred = inferredTypes[0];
  const requested = String(requestedSelectionType || "").trim();
  if (
    requested &&
    ![MEAL_SELECTION_TYPES.SANDWICH, MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT].includes(
      requested
    )
  ) {
    throw mealBuilderError(
      "Direct product cards only support sandwich or full_meal_product selection types",
      "MEAL_BUILDER_DIRECT_CARD_SELECTION_TYPE_INVALID",
      422,
      { requestedSelectionType: requested }
    );
  }
  if (requested && requested !== inferred) {
    throw mealBuilderError(
      "The card selection type does not match its selected products",
      "MEAL_BUILDER_DIRECT_CARD_SELECTION_TYPE_MISMATCH",
      422,
      {
        requestedSelectionType: requested,
        inferredSelectionType: inferred,
      }
    );
  }

  await canonicalizeSandwichCardProducts(rows);
  return inferred;
}

function directCardMetadata(metadata = {}, selectionType) {
  return {
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    requiresBuilder: false,
    treatAsFullMeal: true,
    classificationAuthority: "meal_product_classification.v1",
    dashboardManaged: true,
    cardKind:
      selectionType === MEAL_SELECTION_TYPES.SANDWICH
        ? "sandwich"
        : "full_meal_product",
  };
}

function directCardRules(rules = {}) {
  return {
    ...(rules && typeof rules === "object" ? rules : {}),
    carbsRequired: false,
  };
}

function installDashboardMealBuilderDirectCardTypeInference() {
  if (installed) return;
  installed = true;

  const originalCreateProductSection =
    mealBuilderService.createProductSection.bind(mealBuilderService);
  const originalUpdateProductSection =
    mealBuilderService.updateProductSection.bind(mealBuilderService);
  const originalAddProductsToSection =
    mealBuilderService.addProductsToSection.bind(mealBuilderService);

  mealBuilderService.createProductSection = async function inferredCreateProductSection(
    args = {}
  ) {
    const section = args.section || {};
    const selectionType = await inferDirectCardSelectionType(
      section.selectedProductIds || section.productIds || [],
      section.selectionType
    );
    return originalCreateProductSection({
      ...args,
      section: {
        ...section,
        selectionType,
        metadata: directCardMetadata(section.metadata, selectionType),
        rules: directCardRules(section.rules),
      },
    });
  };

  mealBuilderService.updateProductSection = async function inferredUpdateProductSection(
    args = {}
  ) {
    const patch = args.patch || {};
    const hasProductPatch =
      Object.prototype.hasOwnProperty.call(patch, "selectedProductIds") ||
      Object.prototype.hasOwnProperty.call(patch, "productIds");
    const hasSelectionTypePatch = Object.prototype.hasOwnProperty.call(
      patch,
      "selectionType"
    );
    if (!hasProductPatch && !hasSelectionTypePatch) {
      return originalUpdateProductSection(args);
    }

    const sections = await currentDraftSections();
    const key = String(args.sectionKey || "").trim().toLowerCase();
    const current = sections.find((section) => sectionKeyOf(section) === key);
    if (!current) return originalUpdateProductSection(args);

    const productIds = hasProductPatch
      ? patch.selectedProductIds || patch.productIds || []
      : selectedProductIdsOf(current);
    const selectionType = await inferDirectCardSelectionType(
      productIds,
      hasSelectionTypePatch ? patch.selectionType : current.selectionType
    );

    return originalUpdateProductSection({
      ...args,
      patch: {
        ...patch,
        selectionType,
        metadata: directCardMetadata(
          { ...(current.metadata || {}), ...(patch.metadata || {}) },
          selectionType
        ),
        rules: directCardRules({
          ...(current.rules || {}),
          ...(patch.rules || {}),
        }),
      },
    });
  };

  mealBuilderService.addProductsToSection = async function inferredAddProductsToSection(
    args = {}
  ) {
    const sections = await currentDraftSections();
    const key = String(args.sectionKey || "").trim().toLowerCase();
    const current = sections.find((section) => sectionKeyOf(section) === key);
    if (current) {
      await inferDirectCardSelectionType(
        [...selectedProductIdsOf(current), ...normalizeProductIds(args.productIds)],
        current.selectionType
      );
    }
    return originalAddProductsToSection(args);
  };
}

installDashboardMealBuilderDirectCardTypeInference();

module.exports = {
  canonicalizeSandwichCardProducts,
  inferDirectCardSelectionType,
  installDashboardMealBuilderDirectCardTypeInference,
};
