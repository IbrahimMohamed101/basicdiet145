"use strict";

const menuCatalogService = require("./orders/menuCatalogService");

let installed = false;

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function isAddonPlanAuthoringContext(options = {}) {
  return (
    normalizedText(options.context) === "addon_plan" ||
    normalizedText(options.linkableFor) === "addon_plan" ||
    normalizedText(options.view) === "addon_plan_picker"
  );
}

function normalizeAddonAuthoringListOptions(options = {}) {
  if (!isAddonPlanAuthoringContext(options)) return options;

  const normalized = {
    ...options,
    includeInactive: true,
  };

  // Add-on administration is an authoring surface. Old dashboard builds sent
  // customer-visibility filters with the picker request, which silently hid
  // draft, disabled, hidden, unavailable, unpublished, or channel-specific
  // products and categories. Ignore only those lifecycle/channel filters in
  // this explicit admin context while preserving search, category, item type,
  // pagination, and all other caller-controlled fields.
  delete normalized.isActive;
  delete normalized.isVisible;
  delete normalized.isAvailable;
  delete normalized.published;
  delete normalized.availableFor;

  return normalized;
}

function wrap(methodName) {
  const original = menuCatalogService[methodName];
  if (typeof original !== "function" || original.__addonCatalogAuthoring === true) {
    return;
  }

  const wrapped = function dashboardAddonCatalogAuthoring(options = {}, ...args) {
    return original.call(
      menuCatalogService,
      normalizeAddonAuthoringListOptions(options),
      ...args
    );
  };

  wrapped.__addonCatalogAuthoring = true;
  wrapped.__original = original;
  menuCatalogService[methodName] = wrapped;
}

function installDashboardAddonCatalogAuthoring() {
  if (installed) return;
  installed = true;
  wrap("listProducts");
  wrap("listCategories");
}

installDashboardAddonCatalogAuthoring();

module.exports = {
  installDashboardAddonCatalogAuthoring,
  isAddonPlanAuthoringContext,
  normalizeAddonAuthoringListOptions,
};
