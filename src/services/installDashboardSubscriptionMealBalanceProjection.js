"use strict";

const controller = require("../controllers/adminController");
const {
  projectDashboardSubscriptionResponse,
} = require("./subscription/subscriptionDashboardMealBalanceProjectionService");

const INSTALL_MARK = Symbol.for(
  "basicdiet.dashboardSubscriptionMealBalanceProjection.installed"
);
const WRAPPED_MARK = Symbol.for(
  "basicdiet.dashboardSubscriptionMealBalanceProjection.wrapped"
);

const DASHBOARD_READ_METHODS = Object.freeze([
  "listSubscriptionsAdmin",
  "getSubscriptionAdmin",
  "listAppUserSubscriptions",
  "exportSubscriptionsAdmin",
]);

function wrapDashboardReadMethod(methodName) {
  const original = controller[methodName];
  if (typeof original !== "function" || original[WRAPPED_MARK]) return false;

  const wrapped = async function projectedDashboardSubscriptionRead(
    req,
    res,
    ...rest
  ) {
    if (!res || typeof res.json !== "function") {
      return original.call(this, req, res, ...rest);
    }

    const originalJson = res.json;
    res.json = function projectDashboardJson(payload) {
      return originalJson.call(
        this,
        projectDashboardSubscriptionResponse(payload)
      );
    };

    try {
      return await original.call(this, req, res, ...rest);
    } finally {
      res.json = originalJson;
    }
  };

  wrapped[WRAPPED_MARK] = true;
  wrapped.__original = original;
  controller[methodName] = wrapped;
  return true;
}

function installDashboardSubscriptionMealBalanceProjection() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];

  const wrappedMethods = DASHBOARD_READ_METHODS.filter(
    wrapDashboardReadMethod
  );
  const state = Object.freeze({
    installed: true,
    wrappedMethods,
    writePathsChanged: false,
    databaseMutationAdded: false,
    flutterRoutesChanged: false,
  });
  globalThis[INSTALL_MARK] = state;
  return state;
}

installDashboardSubscriptionMealBalanceProjection();

module.exports = {
  DASHBOARD_READ_METHODS,
  installDashboardSubscriptionMealBalanceProjection,
  wrapDashboardReadMethod,
};
