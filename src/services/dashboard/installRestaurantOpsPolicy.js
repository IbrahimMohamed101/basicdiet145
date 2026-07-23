"use strict";

// The dashboard exposes restaurant as the unified branch role. For operations
// transitions it behaves like kitchen staff (including pickup fulfillment), not
// like a courier. Keep this adapter local to the operations policy instead of
// granting restaurant every route historically assigned to kitchen/cashier.
const opsActionPolicy = require("./opsActionPolicy");

if (!opsActionPolicy.__restaurantRoleInstalled) {
  const originalGetAllowedActions = opsActionPolicy.getAllowedActions;
  const originalValidateAction = opsActionPolicy.validateAction;

  function withOperationalRole(input = {}) {
    if (String(input.role || "").toLowerCase() !== "restaurant") return input;
    return { ...input, role: "kitchen" };
  }

  opsActionPolicy.getAllowedActions = function getAllowedActionsWithRestaurant(input) {
    return originalGetAllowedActions(withOperationalRole(input));
  };

  opsActionPolicy.validateAction = function validateActionWithRestaurant(input) {
    return originalValidateAction(withOperationalRole(input));
  };

  Object.defineProperty(opsActionPolicy, "__restaurantRoleInstalled", {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

module.exports = opsActionPolicy;
