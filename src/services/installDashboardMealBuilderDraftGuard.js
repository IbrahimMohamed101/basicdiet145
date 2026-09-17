"use strict";

const MealBuilderConfig = require("../models/MealBuilderConfig");
const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");

let installed = false;

async function ensureCompatibleWorkingDraft(actor = {}) {
  const exists = await MealBuilderConfig.exists({
    status: "draft",
    isCurrent: true,
  });
  if (!exists) {
    await mealBuilderService.createDraft({ actor });
  }
}

function wrapDraftAction(methodName) {
  const original = mealBuilderService[methodName];
  if (typeof original !== "function" || original.__compatibleDraftGuard === true) {
    return;
  }

  const wrapped = async function guardedMealBuilderAction(args = {}) {
    await ensureCompatibleWorkingDraft(args.actor || {});
    return original.call(mealBuilderService, args);
  };
  wrapped.__compatibleDraftGuard = true;
  mealBuilderService[methodName] = wrapped;
}

function installDashboardMealBuilderDraftGuard() {
  if (installed) return;
  installed = true;
  for (const methodName of [
    "createProductSection",
    "updateProductSection",
    "deleteProductSection",
    "replaceSectionItems",
    "addProductsToSection",
    "removeProductFromSection",
    "addOptionsToSection",
    "removeOptionFromSection",
  ]) {
    wrapDraftAction(methodName);
  }
}

installDashboardMealBuilderDraftGuard();

module.exports = {
  ensureCompatibleWorkingDraft,
  installDashboardMealBuilderDraftGuard,
};
