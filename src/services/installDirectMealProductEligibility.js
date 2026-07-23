"use strict";

const MenuProduct = require("../models/MenuProduct");
const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");
const baseService = require("./subscription/mealBuilderConfigService");
const {
  isProductionDirectProduct,
} = require("./catalog/mealProductClassificationService");

const MAX_PICKER_LIMIT = 1000;
let installed = false;

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizePagination({ page, limit } = {}) {
  const normalizedPage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const normalizedLimit = Math.min(
    MAX_PICKER_LIMIT,
    Math.max(1, Number.parseInt(limit || "100", 10) || 100)
  );
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
}

function normalizeIds(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
}

function directProductError(products) {
  const err = new baseService.MealBuilderError(
    "Only direct meal products can be added to a direct Meal Planner card",
    "MEAL_BUILDER_PRODUCT_TYPE_INVALID",
    422,
    {
      products,
      excludedKinds: ["composed_meal", "non_meal"],
    }
  );
  return err;
}

async function assertDirectProductIds(productIds) {
  const ids = normalizeIds(productIds);
  if (!ids.length) return;
  const products = await MenuProduct.find({ _id: { $in: ids } })
    .select("_id key itemType ui.cardVariant")
    .lean();
  const invalid = products
    .filter((product) => !isProductionDirectProduct(product))
    .map((product) => ({
      id: String(product._id),
      key: product.key || "",
      itemType: product.itemType || "",
      cardVariant: String(product?.ui?.cardVariant || ""),
    }));
  if (invalid.length) throw directProductError(invalid);
}

async function directCandidateIds(candidates = []) {
  const ids = normalizeIds(candidates.map((candidate) => candidate.productId || candidate.id));
  if (!ids.length) return new Set();
  const products = await MenuProduct.find({ _id: { $in: ids } })
    .select("_id itemType ui.cardVariant")
    .lean();
  return new Set(
    products
      .filter(isProductionDirectProduct)
      .map((product) => String(product._id))
  );
}

function rebuildPickerResponse(response, rows, pagination) {
  const total = rows.length;
  const candidates = rows.slice(
    pagination.skip,
    pagination.skip + pagination.limit
  );
  return {
    ...response,
    candidates,
    meta: {
      ...(response.meta || {}),
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
      catalogTotal: rows.length,
      selectedInCurrentCard: rows.filter((row) => row.selected).length,
      assignedToOtherCards: rows.filter(
        (row) => row.state === "assigned_elsewhere"
      ).length,
      unassigned: rows.filter((row) => row.state === "eligible").length,
      unavailable: rows.filter((row) => row.state === "unavailable").length,
    },
  };
}

async function filterDirectPicker(original, options = {}) {
  const pagination = normalizePagination(options);
  const includeUnavailable = normalizeBoolean(options.includeUnavailable, false);
  const unassignedOnly = normalizeBoolean(options.unassignedOnly, true);
  const complete = await original({
    ...options,
    includeUnavailable: true,
    unassignedOnly: false,
    page: 1,
    limit: MAX_PICKER_LIMIT,
  });
  if (!complete || complete.candidateType !== "product") return complete;

  const allowedIds = await directCandidateIds(complete.candidates || []);
  const catalogRows = (complete.candidates || []).filter((candidate) => {
    const id = String(candidate.productId || candidate.id || "");
    if (!allowedIds.has(id)) return false;
    return candidate.selected || includeUnavailable || candidate.available !== false;
  });
  const rows = unassignedOnly
    ? catalogRows.filter(
        (candidate) => candidate.selected || candidate.assignable === true
      )
    : catalogRows;
  return rebuildPickerResponse(complete, rows, pagination);
}

function installDirectMealProductEligibility() {
  if (installed) return;
  installed = true;

  const originalGetDirectProductPicker =
    mealBuilderService.getDirectProductPicker.bind(mealBuilderService);
  const originalGetSectionPicker =
    mealBuilderService.getSectionPicker.bind(mealBuilderService);
  const originalCreateProductSection =
    mealBuilderService.createProductSection.bind(mealBuilderService);
  const originalUpdateProductSection =
    mealBuilderService.updateProductSection.bind(mealBuilderService);
  const originalAddProductsToSection =
    mealBuilderService.addProductsToSection.bind(mealBuilderService);

  mealBuilderService.getDirectProductPicker = (options = {}) =>
    filterDirectPicker(originalGetDirectProductPicker, options);

  mealBuilderService.getSectionPicker = async (options = {}) => {
    const response = await originalGetSectionPicker(options);
    if (!response || response.candidateType !== "product") return response;
    const pagination = normalizePagination(options);
    const includeUnavailable = normalizeBoolean(options.includeUnavailable, false);
    const unassignedOnly = normalizeBoolean(options.unassignedOnly, true);
    const allowedIds = await directCandidateIds(response.candidates || []);
    const catalogRows = (response.candidates || []).filter((candidate) => {
      const id = String(candidate.productId || candidate.id || "");
      if (!allowedIds.has(id)) return false;
      return candidate.selected || includeUnavailable || candidate.available !== false;
    });
    const rows = unassignedOnly
      ? catalogRows.filter(
          (candidate) => candidate.selected || candidate.assignable === true
        )
      : catalogRows;
    return rebuildPickerResponse(response, rows, pagination);
  };

  mealBuilderService.createProductSection = async (args = {}) => {
    await assertDirectProductIds(
      args?.section?.selectedProductIds || args?.section?.productIds
    );
    return originalCreateProductSection(args);
  };

  mealBuilderService.updateProductSection = async (args = {}) => {
    const patch = args.patch || {};
    if (
      Object.prototype.hasOwnProperty.call(patch, "selectedProductIds") ||
      Object.prototype.hasOwnProperty.call(patch, "productIds")
    ) {
      await assertDirectProductIds(
        patch.selectedProductIds || patch.productIds
      );
    }
    return originalUpdateProductSection(args);
  };

  mealBuilderService.addProductsToSection = async (args = {}) => {
    await assertDirectProductIds(args.productIds);
    return originalAddProductsToSection(args);
  };
}

installDirectMealProductEligibility();

module.exports = {
  assertDirectProductIds,
  installDirectMealProductEligibility,
};
