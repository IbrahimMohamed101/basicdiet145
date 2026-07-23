"use strict";

const mealBuilderService = require("./subscription/dashboardMealPlannerDashboardService");

const CLASSIFICATION_AUTHORITY = "meal_product_classification.v1";
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
      },
    };
  };
}

installMealPlannerClassificationAuthority();

module.exports = {
  CLASSIFICATION_AUTHORITY,
  installMealPlannerClassificationAuthority,
};
