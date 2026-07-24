"use strict";

const MenuProduct = require("../models/MenuProduct");
const compatibilityService = require("./subscription/dashboardMealPlannerCompatibilityService");
const dashboardMealBuilderService = require("./subscription/dashboardMealPlannerDashboardService");
const {
  isProductionDirectProduct,
} = require("./catalog/mealProductClassificationService");

const STATE_KEY = Symbol.for(
  "basicdiet.dashboardDirectPickerClassificationGuard.state"
);
const WRAPPER_MARKER = "__dashboardDirectPickerClassificationGuard";
const AUTHORITY = "meal_product_classification.v1";
const MAX_PICKER_LIMIT = 1000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function candidateId(candidate = {}) {
  return String(candidate.productId || candidate.id || "").trim();
}

function recalculateMeta(rows, page, limit, previousMeta = {}) {
  const total = rows.length;
  return {
    ...previousMeta,
    page,
    limit,
    total,
    pages: total === 0 ? 0 : Math.ceil(total / limit),
    catalogTotal: total,
    selectedInCurrentCard: rows.filter((row) => row.selected).length,
    assignedToOtherCards: rows.filter(
      (row) => row.state === "assigned_elsewhere"
    ).length,
    unassigned: rows.filter((row) => row.state === "eligible").length,
    unavailable: rows.filter((row) => row.state === "unavailable").length,
  };
}

function normalizeClassificationAuthority(result) {
  if (!result || result.candidateType !== "product") return result;
  return {
    ...result,
    rules: {
      ...(result.rules || {}),
      classificationAuthority: AUTHORITY,
    },
  };
}

async function filterDirectCandidates(result, options = {}) {
  if (!result || result.candidateType !== "product") return result;

  const ids = (result.candidates || []).map(candidateId).filter(Boolean);
  const products = ids.length
    ? await MenuProduct.find({ _id: { $in: ids } })
        .select({ _id: 1, itemType: 1, isCustomizable: 1, ui: 1 })
        .lean()
    : [];
  const allowedIds = new Set(
    products
      .filter((product) => isProductionDirectProduct(product))
      .map((product) => String(product._id))
  );
  const rows = (result.candidates || []).filter((candidate) =>
    allowedIds.has(candidateId(candidate))
  );

  const page = positiveInteger(options.page, 1);
  const limit = Math.min(
    MAX_PICKER_LIMIT,
    positiveInteger(options.limit, 100)
  );
  const skip = (page - 1) * limit;

  return normalizeClassificationAuthority({
    ...result,
    candidates: rows.slice(skip, skip + limit),
    meta: recalculateMeta(rows, page, limit, result.meta || {}),
  });
}

function wrapCompatibilityPicker() {
  const original = compatibilityService.getDirectProductPicker;
  if (typeof original !== "function") {
    throw new Error("Missing dashboard direct product picker");
  }
  if (original[WRAPPER_MARKER]) return;

  const wrapped = async function classifiedDashboardDirectPicker(options = {}) {
    const requestedPage = positiveInteger(options.page, 1);
    const requestedLimit = Math.min(
      MAX_PICKER_LIMIT,
      positiveInteger(options.limit, 100)
    );
    const complete = await original.call(compatibilityService, {
      ...options,
      page: 1,
      limit: MAX_PICKER_LIMIT,
    });
    return filterDirectCandidates(complete, {
      ...options,
      page: requestedPage,
      limit: requestedLimit,
    });
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  compatibilityService.getDirectProductPicker = wrapped;
}

function wrapFinalDashboardPicker() {
  const original = dashboardMealBuilderService.getSectionPicker;
  if (typeof original !== "function") {
    throw new Error("Missing final dashboard Meal Builder picker");
  }
  if (original[WRAPPER_MARKER]) return;

  const wrapped = async function canonicalDashboardPickerAuthority(options = {}) {
    return normalizeClassificationAuthority(
      await original.call(dashboardMealBuilderService, options)
    );
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  dashboardMealBuilderService.getSectionPicker = wrapped;
}

function installDashboardDirectPickerClassificationGuard() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;

  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;

  try {
    wrapCompatibilityPicker();
    wrapFinalDashboardPicker();

    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      classificationAuthority: AUTHORITY,
      preservesGenericStandaloneProducts: true,
      excludesNonMealAndBuilderProducts: true,
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode =
      error.code || "DASHBOARD_DIRECT_PICKER_CLASSIFICATION_GUARD_FAILED";
    state.errorMessage = error.message;
    throw error;
  }
}

installDashboardDirectPickerClassificationGuard();

module.exports = {
  filterDirectCandidates,
  installDashboardDirectPickerClassificationGuard,
  normalizeClassificationAuthority,
};
