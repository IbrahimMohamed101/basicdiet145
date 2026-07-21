"use strict";

const mongoose = require("mongoose");
const SubscriptionDay = require("../models/SubscriptionDay");

let installed = false;

function addSelectionType(documentArrayPathName, selectionType) {
  const documentArrayPath = SubscriptionDay.schema.path(documentArrayPathName);
  const nestedSchema = documentArrayPath && documentArrayPath.schema;
  const selectionTypePath = nestedSchema && nestedSchema.path("selectionType");

  if (!selectionTypePath) {
    throw new Error(
      `SubscriptionDay.${documentArrayPathName}.selectionType schema path is missing`
    );
  }

  if (!selectionTypePath.enumValues.includes(selectionType)) {
    selectionTypePath.enum(selectionType);
  }

  return nestedSchema;
}

function installSubscriptionDayFullMealCompatibility() {
  if (installed) return;
  installed = true;

  addSelectionType("mealSlots", "full_meal_product");
  const materializedMealSchema = addSelectionType(
    "materializedMeals",
    "full_meal_product"
  );

  // Direct MenuProduct cards are persisted canonically through productId. Keep
  // sandwichId for old mobile payloads while preserving the real MenuProduct
  // identity for confirmation, kitchen projection, and subsequent reads.
  if (!materializedMealSchema.path("productId")) {
    materializedMealSchema.add({
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "MenuProduct",
        default: null,
      },
    });
  }
}

installSubscriptionDayFullMealCompatibility();
require("./installPickupCanonicalRuntimeGuard");
require("./installPickupCanonicalQueryGuard");

module.exports = {
  installSubscriptionDayFullMealCompatibility,
};
