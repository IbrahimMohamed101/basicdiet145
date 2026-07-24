"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenAddonProductIdentityGuard.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenAddonProductIdentityGuard.wrapped");

function idText(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value.toHexString === "function") {
    try {
      return String(value.toHexString());
    } catch (_) {
      return null;
    }
  }
  if (value && typeof value === "object") {
    return idText(value._id || value.id);
  }
  return String(value).trim() || null;
}

function hasPlanProductIdentityCollision(addon = {}) {
  const addonPlanId = idText(addon.addonPlanId);
  const productId = idText(addon.productId || addon.id);
  return Boolean(addonPlanId && productId && addonPlanId === productId);
}

function repairAddonProductIdentity(addon = {}) {
  if (!addon || typeof addon !== "object" || Array.isArray(addon)) return addon;
  if (!hasPlanProductIdentityCollision(addon)) return addon;

  return {
    ...addon,
    id: null,
    productId: null,
    key: null,
    name: "لم يتم تحديد منتج الإضافة",
    nameI18n: {
      ar: "لم يتم تحديد منتج الإضافة",
      en: "Addon product not selected",
    },
    productIdentityResolved: false,
    productIdentityReason: "ADDON_PLAN_IS_NOT_A_PRODUCT",
  };
}

function repairKitchenDetails(details = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return details;
  return {
    ...details,
    addons: (Array.isArray(details.addons) ? details.addons : []).map(repairAddonProductIdentity),
  };
}

function wrapBuilder(service, method) {
  const original = service[method];
  if (typeof original !== "function" || original[WRAPPED_MARK]) return;

  const wrapped = function buildKitchenDetailsWithDistinctAddonProductIdentity(...args) {
    return repairKitchenDetails(original.apply(this, args));
  };
  wrapped[WRAPPED_MARK] = true;
  service[method] = wrapped;
}

function installKitchenAddonProductIdentityGuard() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];

  const service = require("./opsPayloadService");
  wrapBuilder(service, "buildKitchenDetailsPayload");
  wrapBuilder(service, "buildOrderKitchenDetailsPayload");

  const verification = Object.freeze({
    installed: true,
    addonPlanProductIdentitySeparated: true,
    unresolvedProductIsExplicit: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenAddonProductIdentityGuard();

// Compose persistence, DTO recovery, preparation bridging, and a final serializer
// guard before the preparation contract captures these service methods.
require("../orders/installOrderPreparationWeightLifecycle");
require("./installKitchenWeightResponseContract");
require("./installKitchenWeightPreparationBridge");
require("./installKitchenFinalResponsePolish");

module.exports = {
  hasPlanProductIdentityCollision,
  installKitchenAddonProductIdentityGuard,
  repairAddonProductIdentity,
  repairKitchenDetails,
};
