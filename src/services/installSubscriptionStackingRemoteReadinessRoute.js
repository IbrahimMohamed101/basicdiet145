"use strict";

const asyncHandler = require("../middleware/asyncHandler");
const subscriptionRouter = require("../routes/subscriptions");
const {
  buildSubscriptionStackingRemoteReadiness,
} = require("./subscription/subscriptionStackingRemoteReadinessService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingRemoteReadinessRoute.installed");

function installSubscriptionStackingRemoteReadinessRoute() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  subscriptionRouter.get(
    "/stacking/readiness",
    asyncHandler(async (req, res) => {
      const readiness = buildSubscriptionStackingRemoteReadiness({
        userId: req.userId,
        env: process.env,
        globalObject: globalThis,
      });
      return res.status(200).json({ status: true, data: readiness });
    })
  );

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    path: "/api/subscriptions/stacking/readiness",
    authenticated: true,
    readOnly: true,
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionStackingRemoteReadinessRoute();

module.exports = {
  INSTALL_KEY,
  installSubscriptionStackingRemoteReadinessRoute,
};
