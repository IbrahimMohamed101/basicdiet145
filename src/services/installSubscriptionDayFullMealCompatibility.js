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
// Install pooled day capacity before route modules capture planner and response
// service exports. The mobile client can then spend any remaining subscription
// meal/add-on credits on one valid day without treating mealsPerDay as a hard cap.
require("./installSubscriptionPooledDayPlanningPolicy");
// Normalize catalog display names before route modules capture the catalog
// builder and before pickup serializers turn Mixed localized objects into text.
require("./installPickupLocalizedCatalogGuard");
// Keep the cycle/ObjectId guard until all historical Mixed snapshots have been
// migrated to plain canonical objects. The entitlement closure is installed
// before route modules capture service functions.
require("./installPickupCanonicalRuntimeGuard");
const pickupEntitlementClosure = require("./installPickupEntitlementClosure");
// Install the mutation-boundary guard after the atomic linked-claim primitive is
// composed, but before the client service captures the balance reserve export.
// Canonical Flutter pickup requests can therefore never fall back to a second
// standalone debit when a planned day's ledger is missing or mismatched.
require("./subscription/pickupLinkedDayMutationGuardService");
require("./installPickupCanonicalQueryGuard");
pickupEntitlementClosure.patchPickupClientService();

module.exports = {
  installSubscriptionDayFullMealCompatibility,
};
