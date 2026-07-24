"use strict";

const MenuProduct = require("../models/MenuProduct");
const dashboardMealBuilderService = require("./subscription/dashboardMealPlannerDashboardService");
const {
  hasExplicitDirectMealIdentity,
} = require("./installDynamicDirectMealCatalogPolicy");

const STATE_KEY = Symbol.for("basicdiet.dynamicDirectMealPickerPolicy.state");
const WRAPPER_MARKER = "__dynamicDirectMealPickerPolicy";
const MAX_LIMIT = 1000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function candidateId(candidate = {}) {
  return String(candidate.productId || candidate.id || "").trim();
}

function paginate(rows, options = {}) {
  const page = positiveInteger(options.page, 1);
  const limit = Math.min(MAX_LIMIT, positiveInteger(options.limit, 100));
  const start = (page - 1) * limit;
  return {
    page,
    limit,
    rows: rows.slice(start, start + limit),
  };
}

function pickerMeta(rows, page, limit, previousMeta = {}) {
  const total = rows.length;
  return {
    ...previousMeta,
    page,
    limit,
    total,
    pages: total === 0 ? 0 : Math.ceil(total / limit),
    catalogTotal: total,
    selectedInCurrentCard: rows.filter((row) => row.state === "selected").length,
    assignedToOtherCards: rows.filter(
      (row) => row.state === "assigned_elsewhere"
    ).length,
    unassigned: rows.filter((row) => row.state === "eligible").length,
    unavailable: rows.filter((row) => row.state === "unavailable").length,
  };
}

async function directProductIds() {
  const products = await MenuProduct.find({})
    .select({ _id: 1, key: 1, itemType: 1, ui: 1 })
    .lean();
  return new Set(
    products
      .filter(hasExplicitDirectMealIdentity)
      .map((product) => String(product._id))
  );
}

async function filterPickerResult(result, options = {}) {
  if (!result || result.candidateType !== "product") return result;
  const allowedIds = await directProductIds();
  const filteredRows = (result.candidates || []).filter((candidate) =>
    allowedIds.has(candidateId(candidate))
  );
  const pageResult = paginate(filteredRows, options);
  return {
    ...result,
    candidates: pageResult.rows,
    rules: {
      ...(result.rules || {}),
      source: "menu_products",
      classificationAuthority: "meal_product_classification.v1",
      membershipSource: "live_catalog",
      systemManagedMembership: true,
    },
    meta: pickerMeta(
      filteredRows,
      pageResult.page,
      pageResult.limit,
      result.meta || {}
    ),
  };
}

function wrapPicker(methodName) {
  const original = dashboardMealBuilderService[methodName];
  if (typeof original !== "function" || original[WRAPPER_MARKER]) return;
  const wrapped = async function dynamicDirectMealPicker(options = {}) {
    const requestedPage = positiveInteger(options.page, 1);
    const requestedLimit = Math.min(
      MAX_LIMIT,
      positiveInteger(options.limit, 100)
    );
    const unpagedResult = await original.call(dashboardMealBuilderService, {
      ...options,
      page: 1,
      limit: MAX_LIMIT,
    });
    return filterPickerResult(unpagedResult, {
      ...options,
      page: requestedPage,
      limit: requestedLimit,
    });
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  dashboardMealBuilderService[methodName] = wrapped;
}

function installDynamicDirectMealPickerPolicy() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;
  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;
  try {
    wrapPicker("getDirectProductPicker");
    wrapPicker("getSectionPicker");
    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      classificationAuthority: "meal_product_classification.v1",
      membershipSource: "live_catalog",
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode = error.code || "DYNAMIC_DIRECT_MEAL_PICKER_INSTALL_FAILED";
    state.errorMessage = error.message;
    throw error;
  }
}

installDynamicDirectMealPickerPolicy();

module.exports = {
  filterPickerResult,
  installDynamicDirectMealPickerPolicy,
};
