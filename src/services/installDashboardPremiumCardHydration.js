"use strict";

const dashboardMealBuilderService = require("./subscription/dashboardMealPlannerDashboardService");
const premiumUpgradeConfigService = require("./subscription/premiumUpgradeConfigService");

const STATE_KEY = Symbol.for(
  "basicdiet.dashboardPremiumCardHydration.state"
);
const WRAPPED_KEY = Symbol.for(
  "basicdiet.dashboardPremiumCardHydration.wrapped"
);
const SYSTEM_PREMIUM_CARD_TYPE = "system_premium";
const PREMIUM_SOURCE = "premium_upgrade_configs";
const PREMIUM_SELECTION_TYPES = new Set([
  "premium",
  "premium_meal",
  "premium_large_salad",
]);

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function looksLikeSection(value = {}) {
  return (
    isPlainObject(value) &&
    Boolean(value.key || value.sectionKey) &&
    (Object.prototype.hasOwnProperty.call(value, "sectionType") ||
      Object.prototype.hasOwnProperty.call(value, "sourceKind") ||
      Object.prototype.hasOwnProperty.call(value, "selectedProductIds") ||
      Object.prototype.hasOwnProperty.call(value, "selectedOptionIds") ||
      Object.prototype.hasOwnProperty.call(value, "titleOverride"))
  );
}

function isSystemPremiumSection(section = {}) {
  return (
    token(section.key || section.sectionKey) === "premium" ||
    token(section.sourceKind) === "premium_visual" ||
    token(section.metadata?.visualRole) === "premium" ||
    token(section.cardType || section.metadata?.cardType) ===
      SYSTEM_PREMIUM_CARD_TYPE ||
    section.systemManaged === true ||
    PREMIUM_SELECTION_TYPES.has(token(section.selectionType))
  );
}

function premiumDashboardItem(row = {}) {
  const priceHalala = Number(
    row.priceHalala ?? row.upgradeDeltaHalala ?? 0
  );
  const configId = String(row.configId || row.id || "");
  const premiumKey = String(row.premiumKey || row.key || "");
  const kind = token(row.kind) === "product" ? "product" : "option";

  return {
    id: configId || String(row.sourceId || premiumKey),
    configId: configId || null,
    key: premiumKey,
    premiumKey,
    name:
      row.name && typeof row.name === "object"
        ? { ar: String(row.name.ar || ""), en: String(row.name.en || "") }
        : { ar: "", en: "" },
    kind,
    type: kind,
    sourceId: row.sourceId ? String(row.sourceId) : null,
    sourceType:
      row.sourceType || (kind === "product" ? "menu_product" : "menu_option"),
    sourceProductId: row.sourceProductId
      ? String(row.sourceProductId)
      : null,
    sourceGroupId: row.sourceGroupId ? String(row.sourceGroupId) : null,
    selectionType: String(row.selectionType || ""),
    priceHalala,
    upgradeDeltaHalala: priceHalala,
    priceSar: Number(row.priceSar ?? priceHalala / 100),
    currency: String(row.currency || "SAR"),
    status: String(row.status || "active"),
    health: String(row.health || "ready"),
    issueCode: row.issueCode || null,
    sortOrder: Number(row.sortOrder || 0),
    revision: Number(row.revision || 1),
    automatic: true,
    selected: true,
    isPremium: true,
    available:
      String(row.status || "active") === "active" &&
      String(row.health || "ready") === "ready",
    requiresPremiumBalance: true,
  };
}

function normalizePremiumItems(items = []) {
  const byKey = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = premiumDashboardItem(item);
    const identity = normalized.configId || normalized.premiumKey || normalized.id;
    if (!identity) continue;
    byKey.set(String(identity), normalized);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
      String(left.premiumKey || left.id).localeCompare(
        String(right.premiumKey || right.id)
      )
  );
}

function findExistingPremiumItems(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findExistingPremiumItems(entry);
      if (found.length) return found;
    }
    return [];
  }
  if (!isPlainObject(value)) return [];

  if (Array.isArray(value.premiumSection?.items)) {
    const items = normalizePremiumItems(value.premiumSection.items);
    if (items.length) return items;
  }
  for (const entry of Object.values(value)) {
    const found = findExistingPremiumItems(entry);
    if (found.length) return found;
  }
  return [];
}

async function loadActivePremiumItems() {
  const response = await premiumUpgradeConfigService.getConfigs({
    status: "active",
    health: "ready",
    page: 1,
    limit: 100,
  });
  return normalizePremiumItems(response?.data || []);
}

function hydratePremiumCardsDeep(value, premiumItems) {
  if (Array.isArray(value)) {
    return value.map((entry) => hydratePremiumCardsDeep(entry, premiumItems));
  }
  if (!isPlainObject(value)) return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = hydratePremiumCardsDeep(entry, premiumItems);
  }

  if (looksLikeSection(output) && isSystemPremiumSection(output)) {
    return {
      ...output,
      cardType: SYSTEM_PREMIUM_CARD_TYPE,
      systemManaged: true,
      itemEntity: "PremiumUpgradeConfig",
      completeByItself: false,
      items: premiumItems,
      premiumItems,
      itemCount: premiumItems.length,
      configuredItemCount: premiumItems.length,
      selectedItemCount: premiumItems.length,
      metadata: {
        ...(output.metadata || {}),
        cardType: SYSTEM_PREMIUM_CARD_TYPE,
        systemManaged: true,
        automatic: true,
        source: PREMIUM_SOURCE,
        itemCount: premiumItems.length,
      },
    };
  }

  if (Object.prototype.hasOwnProperty.call(output, "premiumSection")) {
    output.premiumSection = {
      ...(isPlainObject(output.premiumSection) ? output.premiumSection : {}),
      automatic: true,
      source: PREMIUM_SOURCE,
      items: premiumItems,
      itemCount: premiumItems.length,
      total: premiumItems.length,
    };
  }

  return output;
}

async function hydrateDashboardPremiumCards(value) {
  const existing = findExistingPremiumItems(value);
  try {
    const premiumItems = existing.length
      ? existing
      : await loadActivePremiumItems();
    return hydratePremiumCardsDeep(value, premiumItems);
  } catch (error) {
    console.error(
      "Dashboard Premium card hydration failed:",
      error?.code || error?.message || error
    );
    return existing.length
      ? hydratePremiumCardsDeep(value, existing)
      : value;
  }
}

function wrapAsyncResult(methodName) {
  const original = dashboardMealBuilderService[methodName];
  if (typeof original !== "function" || original[WRAPPED_KEY]) return;

  const wrapped = async function dashboardPremiumCardHydrationBoundary(...args) {
    const result = await original.apply(dashboardMealBuilderService, args);
    return hydrateDashboardPremiumCards(result);
  };
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  dashboardMealBuilderService[methodName] = wrapped;
}

function installDashboardPremiumCardHydration() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;

  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;

  try {
    for (const methodName of [
      "getDashboardState",
      "openWorkingDraft",
      "resetDraftToPublished",
      "getHydratedDraft",
      "createDraft",
      "updateDraft",
      "createProductSection",
      "updateProductSection",
      "deleteProductSection",
      "addProductsToSection",
      "removeProductFromSection",
      "replaceSectionItems",
      "addOptionsToSection",
      "removeOptionFromSection",
      "publishDraft",
    ]) {
      wrapAsyncResult(methodName);
    }

    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      source: PREMIUM_SOURCE,
      hydratesSystemPremiumSections: true,
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode =
      error?.code || "DASHBOARD_PREMIUM_CARD_HYDRATION_INSTALL_FAILED";
    state.errorMessage = error?.message || String(error);
    throw error;
  }
}

installDashboardPremiumCardHydration();

module.exports = {
  STATE_KEY,
  SYSTEM_PREMIUM_CARD_TYPE,
  findExistingPremiumItems,
  hydrateDashboardPremiumCards,
  hydratePremiumCardsDeep,
  installDashboardPremiumCardHydration,
  isSystemPremiumSection,
  normalizePremiumItems,
  premiumDashboardItem,
};
