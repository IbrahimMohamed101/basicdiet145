"use strict";

const MealBuilderConfig = require("../models/MealBuilderConfig");
const CatalogService = require("./catalog/CatalogService");
const mealBuilderConfigService = require("./subscription/mealBuilderConfigService");
const dashboardMealBuilderService = require("./subscription/dashboardMealPlannerDashboardService");

const STATE_KEY = Symbol.for("basicdiet.retiredSubscriptionSandwichCard.state");
const WRAPPED_KEY = Symbol.for("basicdiet.retiredSubscriptionSandwichCard.wrapped");
const RETIRED_SECTION_KEY = "sandwich";
const RETIRED_SELECTION_TYPE = "sandwich";

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function isRetiredSandwichSection(section = {}) {
  if (!section || typeof section !== "object" || Array.isArray(section)) return false;
  const key = token(section.key || section.sectionKey);
  const selectionType = token(section.selectionType);
  return key === RETIRED_SECTION_KEY || selectionType === RETIRED_SELECTION_TYPE;
}

function stripRetiredSections(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .filter((section) => !isRetiredSandwichSection(section))
    .map((section) => stripRetiredSandwichCardDeep(section));
}

function stripRetiredSandwichCardDeep(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    return value.map((entry) => stripRetiredSandwichCardDeep(entry, seen));
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);

  const output = {};
  for (const [key, current] of Object.entries(value)) {
    output[key] = key === "sections" && Array.isArray(current)
      ? stripRetiredSections(current)
      : stripRetiredSandwichCardDeep(current, seen);
  }
  seen.delete(value);
  return output;
}

function copyFunctionProperties(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    if (["name", "length", "prototype", "arguments", "caller", "__original"].includes(String(key))) continue;
    if (key === WRAPPED_KEY) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor) Object.defineProperty(target, key, descriptor);
    } catch (_error) {
      // Function metadata is best-effort. Runtime behavior remains authoritative.
    }
  }
}

function retiredCardError() {
  const error = new Error("The legacy automatic sandwich card has been retired. Create a dashboard-managed direct product card instead.");
  error.code = "MEAL_BUILDER_SANDWICH_CARD_RETIRED";
  error.status = 422;
  return error;
}

function assertWriteDoesNotTargetRetiredCard(methodName, args = []) {
  const payload = args[0] && typeof args[0] === "object" ? args[0] : {};
  const section = payload.section && typeof payload.section === "object" ? payload.section : null;
  const patch = payload.patch && typeof payload.patch === "object" ? payload.patch : null;
  const sectionKey = token(payload.sectionKey || (section && (section.key || section.sectionKey)));

  if (section && isRetiredSandwichSection(section)) throw retiredCardError();
  if (patch && (sectionKey === RETIRED_SECTION_KEY || token(patch.selectionType) === RETIRED_SELECTION_TYPE)) {
    throw retiredCardError();
  }
  if (["getSectionPicker", "replaceSectionItems", "addProductsToSection", "removeProductFromSection"].includes(methodName)
    && sectionKey === RETIRED_SECTION_KEY) {
    throw retiredCardError();
  }
}

async function purgeRetiredSectionsFromCurrentConfigs() {
  await MealBuilderConfig.updateMany(
    {
      isCurrent: true,
      status: { $in: ["draft", "published"] },
      sections: {
        $elemMatch: {
          $or: [
            { key: RETIRED_SECTION_KEY },
            { selectionType: RETIRED_SELECTION_TYPE },
          ],
        },
      },
    },
    {
      $pull: {
        sections: {
          $or: [
            { key: RETIRED_SECTION_KEY },
            { selectionType: RETIRED_SELECTION_TYPE },
          ],
        },
      },
    }
  );
}

function sanitizeArgs(args = []) {
  if (!args.length) return args;
  return [stripRetiredSandwichCardDeep(args[0]), ...args.slice(1)];
}

function wrapAsync(service, methodName, options = {}) {
  const original = service && service[methodName];
  if (typeof original !== "function" || original[WRAPPED_KEY]) return original;

  const wrapped = async function retiredSubscriptionSandwichCardBoundary(...args) {
    if (options.assertWrite) assertWriteDoesNotTargetRetiredCard(methodName, args);
    const nextArgs = options.sanitizeInput ? sanitizeArgs(args) : args;
    if (options.purgeBefore) await purgeRetiredSectionsFromCurrentConfigs();
    const result = await original.apply(this, nextArgs);
    if (options.purgeAfter) await purgeRetiredSectionsFromCurrentConfigs();
    return stripRetiredSandwichCardDeep(result);
  };

  copyFunctionProperties(original, wrapped);
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__retiredSubscriptionSandwichCard", { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  service[methodName] = wrapped;
  return wrapped;
}

function installCoreBoundaries() {
  for (const methodName of [
    "buildPlannerCatalogFromPublishedBuilder",
    "buildPublishedContract",
    "buildPublishedMembership",
    "getDashboardState",
    "getHydratedDraft",
    "getReadinessReport",
  ]) {
    wrapAsync(mealBuilderConfigService, methodName);
  }

  for (const methodName of ["validateConfigObject", "validatePayload"]) {
    wrapAsync(mealBuilderConfigService, methodName, { sanitizeInput: true });
  }

  wrapAsync(mealBuilderConfigService, "createDraft", {
    sanitizeInput: true,
    purgeAfter: true,
  });
  wrapAsync(mealBuilderConfigService, "updateDraft", {
    sanitizeInput: true,
    purgeAfter: true,
  });
  wrapAsync(mealBuilderConfigService, "publishDraft", { purgeBefore: true });
  wrapAsync(mealBuilderConfigService, "openWorkingDraft", { purgeAfter: true });
  wrapAsync(mealBuilderConfigService, "resetDraftToPublished", { purgeAfter: true });
}

function installDashboardBoundaries() {
  for (const methodName of [
    "getDashboardState",
    "getHydratedDraft",
    "getReadinessReport",
  ]) {
    wrapAsync(dashboardMealBuilderService, methodName);
  }

  for (const methodName of ["validatePayload", "createDraft", "updateDraft"]) {
    wrapAsync(dashboardMealBuilderService, methodName, {
      sanitizeInput: true,
      purgeAfter: methodName !== "validatePayload",
    });
  }

  wrapAsync(dashboardMealBuilderService, "publishDraft", { purgeBefore: true });

  for (const methodName of [
    "createProductSection",
    "updateProductSection",
    "getSectionPicker",
    "replaceSectionItems",
    "addProductsToSection",
    "removeProductFromSection",
  ]) {
    wrapAsync(dashboardMealBuilderService, methodName, { assertWrite: true });
  }
}

function installCatalogBoundaries() {
  for (const methodName of [
    "getSubscriptionBuilderCatalogWithV2",
    "getSubscriptionBuilderCatalog",
  ]) {
    wrapAsync(CatalogService, methodName);
  }
}

function installRetiredSubscriptionSandwichCard() {
  const current = globalThis[STATE_KEY];
  if (current && current.status === "installed") return current;

  const state = {
    status: "installing",
    installedAt: null,
    retiredSectionKey: RETIRED_SECTION_KEY,
    retiredSelectionType: RETIRED_SELECTION_TYPE,
  };
  globalThis[STATE_KEY] = state;

  try {
    installCoreBoundaries();
    installDashboardBoundaries();
    installCatalogBoundaries();
    state.status = "installed";
    state.installedAt = new Date();
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode = error && error.code || "RETIRED_SUBSCRIPTION_SANDWICH_CARD_INSTALL_FAILED";
    state.errorMessage = error && error.message || "Failed to retire the subscription sandwich card";
    throw error;
  }
}

installRetiredSubscriptionSandwichCard();

module.exports = {
  RETIRED_SECTION_KEY,
  RETIRED_SELECTION_TYPE,
  STATE_KEY,
  WRAPPED_KEY,
  installRetiredSubscriptionSandwichCard,
  isRetiredSandwichSection,
  purgeRetiredSectionsFromCurrentConfigs,
  stripRetiredSandwichCardDeep,
  stripRetiredSections,
};
