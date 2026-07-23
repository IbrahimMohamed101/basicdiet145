"use strict";

const mealBuilderService = require("./subscription/dashboardMealPlannerDashboardService");

const CLASSIFICATION_AUTHORITY = "meal_product_classification.v1";
const CANONICAL_DIRECT_SELECTION_TYPE = "full_meal_product";
let installed = false;

function installMealPlannerClassificationAuthority() {
  if (installed) return;
  installed = true;

  const originalGetSectionPicker =
    mealBuilderService.getSectionPicker.bind(mealBuilderService);

  mealBuilderService.getSectionPicker = async (options = {}) => {
    const response = await originalGetSectionPicker(options);
    if (!response || response.candidateType !== "product") return response;
    return {
      ...response,
      rules: {
        ...(response.rules || {}),
        classificationAuthority: CLASSIFICATION_AUTHORITY,
        selectionTypeRequired: false,
        canonicalSelectionType: CANONICAL_DIRECT_SELECTION_TYPE,
      },
    };
  };
}

installMealPlannerClassificationAuthority();

module.exports = {
  CANONICAL_DIRECT_SELECTION_TYPE,
  CLASSIFICATION_AUTHORITY,
  installMealPlannerClassificationAuthority,
};
