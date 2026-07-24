"use strict";

const crypto = require("crypto");

const MealBuilderConfig = require("../models/MealBuilderConfig");
const { MEAL_SELECTION_TYPES } = require("../config/mealPlannerContract");
const mealBuilderConfigService = require("./subscription/mealBuilderConfigService");
const dashboardMealBuilderService = require("./subscription/dashboardMealPlannerDashboardService");
const {
  loadLiveDirectMeals,
} = require("./installDynamicDirectMealCatalogPolicy");

const STATE_KEY = Symbol.for(
  "basicdiet.canonicalDynamicDirectMealSectionPolicy.state"
);
const WRAPPER_MARKER = "__canonicalDynamicDirectMealSectionPolicy";
const SECTION_KEY = "sandwich";

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function stableHash(payload) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")}`;
}

function sectionKey(section = {}) {
  return token(section.key || section.sectionKey);
}

function isDirectProductSection(section = {}) {
  const type = token(
    section.sectionType || section.type || section.builderSectionType
  );
  const selectionType = token(section.selectionType);
  const cardType = token(section.cardType || section.metadata?.cardType);
  const hasDirectProduct = [
    ...(Array.isArray(section.products) ? section.products : []),
    ...(Array.isArray(section.items) ? section.items : []),
  ].some(
    (item) =>
      token(item?.selectionType) === MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT ||
      token(item?.selectionType) === MEAL_SELECTION_TYPES.SANDWICH ||
      item?.action?.type === "direct_add" ||
      item?.action?.treatAsFullMeal === true
  );
  return (
    type === "product_list" ||
    selectionType === MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT ||
    selectionType === MEAL_SELECTION_TYPES.SANDWICH ||
    cardType === "direct_product" ||
    hasDirectProduct
  );
}

function canonicalConfigSection(shell = {}, liveProductIds = []) {
  return {
    ...shell,
    key: SECTION_KEY,
    sectionType: "product_list",
    sourceKind: "product_list",
    includeMode: "selected",
    selectedProductIds: [...liveProductIds],
    selectedOptionIds: [],
    sourceGroupId: null,
    sourceCategoryId: null,
    productContextId: null,
    selectionType: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
    titleOverride:
      shell.titleOverride || shell.title || { ar: "الوجبات", en: "Meals" },
    sortOrder: Number(shell.sortOrder ?? 20),
    required: false,
    minSelections: 0,
    maxSelections: 1,
    multiSelect: false,
    visible: shell.visible !== false,
    availableFor: ["subscription"],
    metadata: {
      ...(shell.metadata || {}),
      cardType: "direct_product",
      cardKind: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
      requiresBuilder: false,
      treatAsFullMeal: true,
      membershipSource: "live_catalog",
      systemManaged: true,
    },
    rules: {
      ...(shell.rules || {}),
      carbsRequired: false,
    },
  };
}

function chooseShell(directSections = []) {
  return (
    directSections.find((section) => sectionKey(section) === SECTION_KEY) ||
    directSections[0] ||
    {}
  );
}

function collapseConfigSections(sections = [], liveProductIds = []) {
  const source = Array.isArray(sections) ? sections : [];
  const directSections = source.filter(isDirectProductSection);
  const nonDirectSections = source.filter(
    (section) => !isDirectProductSection(section)
  );
  if (liveProductIds.length) {
    nonDirectSections.push(
      canonicalConfigSection(chooseShell(directSections), liveProductIds)
    );
  }
  return nonDirectSections.sort(
    (left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
      sectionKey(left).localeCompare(sectionKey(right))
  );
}

function productId(product = {}) {
  return String(product.productId || product.id || "").trim();
}

function collapsePlannerSections(sections = [], liveProductIds = []) {
  const source = Array.isArray(sections) ? sections : [];
  const directSections = source.filter(isDirectProductSection);
  const nonDirectSections = source.filter(
    (section) => !isDirectProductSection(section)
  );
  if (!liveProductIds.length) return nonDirectSections;

  const allowed = new Set(liveProductIds);
  const shell = chooseShell(directSections);
  const productsById = new Map();
  for (const section of directSections) {
    for (const product of section.products || []) {
      const id = productId(product);
      if (id && allowed.has(id) && !productsById.has(id)) {
        productsById.set(id, product);
      }
    }
  }
  const products = liveProductIds
    .map((id) => productsById.get(id))
    .filter(Boolean);

  nonDirectSections.push({
    ...shell,
    key: SECTION_KEY,
    type: "product_list",
    sectionType: "product_list",
    builderSectionType: "product_list",
    selectionType: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
    source: { ...(shell.source || {}), kind: "live_catalog" },
    ui: {
      ...(shell.ui || {}),
      cardType: "direct_product",
      cardKind: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
      requiresBuilder: false,
      treatAsFullMeal: true,
      membershipSource: "live_catalog",
      systemManaged: true,
    },
    rules: { ...(shell.rules || {}), carbsRequired: false },
    products,
  });

  return nonDirectSections.sort(
    (left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
      sectionKey(left).localeCompare(sectionKey(right))
  );
}

async function liveState() {
  const products = await loadLiveDirectMeals();
  return {
    products,
    ids: products.map((product) => String(product._id)),
  };
}

function wrapPlannerCatalog() {
  const original = mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder;
  if (typeof original !== "function" || original[WRAPPER_MARKER]) return;
  const wrapped = async function canonicalDynamicPlannerCatalog(args = {}) {
    const [catalog, live] = await Promise.all([
      original.call(mealBuilderConfigService, args),
      liveState(),
    ]);
    if (!catalog || typeof catalog !== "object") return catalog;
    const sections = collapsePlannerSections(catalog.sections || [], live.ids);
    return {
      ...catalog,
      sections,
      catalogHash: stableHash({
        contractVersion: catalog.contractVersion || "meal_planner_menu.v3",
        currency: catalog.currency || "SAR",
        sections,
        rules: catalog.rules || {},
      }),
    };
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder = wrapped;
}

function validationSummary(validation = {}, extra = {}) {
  const errors = [...(validation.errors || [])];
  const warnings = [...(validation.warnings || [])];
  return {
    ...validation,
    status: errors.length ? "error" : warnings.length ? "warning" : "ok",
    ready: errors.length === 0,
    errors,
    warnings,
    checks: [...errors, ...warnings],
    summary: {
      ...(validation.summary || {}),
      errors: errors.length,
      warnings: warnings.length,
      ...extra,
    },
  };
}

function wrapDashboardMethods() {
  const originalValidate = dashboardMealBuilderService.validatePayload;
  const originalCreateDraft = dashboardMealBuilderService.createDraft;
  const originalUpdateDraft = dashboardMealBuilderService.updateDraft;
  const originalPublish = dashboardMealBuilderService.publishDraft;
  const originalState = dashboardMealBuilderService.getDashboardState;
  const originalHydrated = dashboardMealBuilderService.getHydratedDraft;

  dashboardMealBuilderService.validatePayload = async function canonicalValidate(
    payload = {}
  ) {
    const live = await liveState();
    return originalValidate.call(dashboardMealBuilderService, {
      ...payload,
      sections: collapseConfigSections(payload.sections || [], live.ids),
    });
  };

  if (typeof originalCreateDraft === "function") {
    dashboardMealBuilderService.createDraft = async function canonicalCreateDraft(
      args = {}
    ) {
      const live = await liveState();
      return originalCreateDraft.call(dashboardMealBuilderService, {
        ...args,
        sections: collapseConfigSections(args.sections || [], live.ids),
      });
    };
  }

  if (typeof originalUpdateDraft === "function") {
    dashboardMealBuilderService.updateDraft = async function canonicalUpdateDraft(
      args = {}
    ) {
      const live = await liveState();
      return originalUpdateDraft.call(dashboardMealBuilderService, {
        ...args,
        sections: collapseConfigSections(args.sections || [], live.ids),
      });
    };
  }

  dashboardMealBuilderService.publishDraft = async function canonicalPublish(
    args = {}
  ) {
    const [draft, live] = await Promise.all([
      MealBuilderConfig.findOne({ status: "draft", isCurrent: true })
        .sort({ updatedAt: -1 })
        .lean(),
      liveState(),
    ]);
    if (draft && typeof originalUpdateDraft === "function") {
      await originalUpdateDraft.call(dashboardMealBuilderService, {
        sections: collapseConfigSections(draft.sections || [], live.ids),
        notes: draft.notes,
        actor: args.actor || {},
      });
    }
    return originalPublish.call(dashboardMealBuilderService, args);
  };

  dashboardMealBuilderService.getDashboardState = async function canonicalState(
    options = {}
  ) {
    const [state, live] = await Promise.all([
      originalState.call(dashboardMealBuilderService, options),
      liveState(),
    ]);
    const output = { ...state };
    const validation = { ...(state.validation || {}) };
    for (const key of ["draft", "published"]) {
      if (!state[key]) continue;
      output[key] = {
        ...state[key],
        sections: collapseConfigSections(state[key].sections || [], live.ids),
      };
      validation[key] = validationSummary(
        await originalValidate.call(dashboardMealBuilderService, {
          sections: output[key].sections,
        })
      );
    }
    return {
      ...output,
      validation,
      dynamicDirectCatalog: {
        sectionKey: SECTION_KEY,
        membershipSource: "live_catalog",
        count: live.ids.length,
      },
    };
  };

  dashboardMealBuilderService.getHydratedDraft = async function canonicalHydrated(
    options = {}
  ) {
    const [response, live] = await Promise.all([
      originalHydrated.call(dashboardMealBuilderService, options),
      liveState(),
    ]);
    if (!response?.draft) return response;
    const sections = collapsePlannerSections(
      response.sections || response.draft.sections || [],
      live.ids
    );
    return {
      ...response,
      draft: { ...response.draft, sections },
      sections,
      dynamicDirectCatalog: {
        sectionKey: SECTION_KEY,
        membershipSource: "live_catalog",
        productIds: live.ids,
        count: live.ids.length,
      },
    };
  };

  dashboardMealBuilderService.getReadinessReport = async function canonicalReadiness() {
    const [draft, published, live] = await Promise.all([
      MealBuilderConfig.findOne({ status: "draft", isCurrent: true })
        .sort({ updatedAt: -1 })
        .lean(),
      mealBuilderConfigService.getCurrentPublishedConfig({
        allowVirtualFallback: true,
      }),
      liveState(),
    ]);
    const sections = collapseConfigSections(published?.sections || [], live.ids);
    const validation = validationSummary(
      await originalValidate.call(dashboardMealBuilderService, { sections }),
      {
        draft: Boolean(draft),
        published: Boolean(published),
        sections: sections.length,
        revisionHash: published?.revisionHash || "",
        route: "/api/dashboard/meal-builder/readiness",
        directMembershipSource: "live_catalog",
      }
    );
    const errors = [...validation.errors];
    const warnings = [...validation.warnings];
    if (!draft) {
      errors.unshift({
        level: "error",
        code: "MEAL_BUILDER_DRAFT_NOT_FOUND",
        message: "No current Meal Builder draft exists",
      });
    }
    if (!published) {
      errors.unshift({
        level: "error",
        code: "MEAL_BUILDER_PUBLISHED_NOT_FOUND",
        message: "No published Meal Builder configuration exists",
      });
    }
    if (!live.ids.length) {
      warnings.push({
        level: "warning",
        code: "MEAL_BUILDER_DIRECT_CATALOG_EMPTY",
        message: "No active standalone subscription meals are currently available",
        sectionKey: SECTION_KEY,
        membershipSource: "live_catalog",
      });
    }
    return validationSummary(
      { ...validation, errors, warnings },
      validation.summary || {}
    );
  };

  for (const method of [
    dashboardMealBuilderService.validatePayload,
    dashboardMealBuilderService.createDraft,
    dashboardMealBuilderService.updateDraft,
    dashboardMealBuilderService.publishDraft,
    dashboardMealBuilderService.getDashboardState,
    dashboardMealBuilderService.getHydratedDraft,
    dashboardMealBuilderService.getReadinessReport,
  ]) {
    if (typeof method === "function") {
      Object.defineProperty(method, WRAPPER_MARKER, { value: true });
    }
  }
}

function installCanonicalDynamicDirectMealSectionPolicy() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;
  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;
  try {
    wrapPlannerCatalog();
    wrapDashboardMethods();
    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      sectionKey: SECTION_KEY,
      membershipSource: "live_catalog",
      legacyDirectSectionsCollapsed: true,
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode =
      error.code || "CANONICAL_DYNAMIC_DIRECT_MEAL_SECTION_INSTALL_FAILED";
    state.errorMessage = error.message;
    throw error;
  }
}

installCanonicalDynamicDirectMealSectionPolicy();

module.exports = {
  collapseConfigSections,
  collapsePlannerSections,
  installCanonicalDynamicDirectMealSectionPolicy,
  isDirectProductSection,
};
