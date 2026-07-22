"use strict";

require("./installPickupEntitlementClosure");

const authority = require("./subscription/subscriptionPickupCycleAuthorityService");

const INSTALL_KEY = Symbol.for("basicdiet.pickupMultiCyclePolicy.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.pickupMultiCyclePolicy.wrapped");

function wrapExport(target, name, factory) {
  const original = target && target[name];
  if (typeof original !== "function" || original[WRAPPED_KEY]) return;
  const wrapped = factory(original);
  wrapped[WRAPPED_KEY] = true;
  target[name] = wrapped;
}

function patchPlanningService() {
  const service = require("./subscription/subscriptionPlanningClientService");
  wrapExport(service, "appendDayMealsForClient", (original) => async function multiCycleAppend(args = {}) {
    return authority.appendMealsWithAuthority(args, original);
  });
}

function patchPickupRequestService() {
  const service = require("./subscription/subscriptionPickupRequestClientService");

  wrapExport(service, "getPickupAvailabilityForClient", (original) => async function authoritativeAvailability(args = {}) {
    await authority.releaseExpiredReservationsForSubscription({
      subscriptionId: args.subscriptionId,
    });
    await authority.reconcileConfirmedDayAllocations({
      subscriptionId: args.subscriptionId,
      date: args.date,
    });
    const result = await original(args);
    const wallet = await authority.readWallet(args.subscriptionId);
    return authority.attachWalletToAvailability(result, wallet);
  });

  wrapExport(service, "createSubscriptionPickupRequestForClient", (original) => async function authoritativeCreate(args = {}) {
    await authority.releaseExpiredReservationsForSubscription({
      subscriptionId: args.subscriptionId,
    });
    await authority.reconcileConfirmedDayAllocations({
      subscriptionId: args.subscriptionId,
      date: args.date,
    });
    const result = await original(args);
    const wallet = await authority.readWallet(args.subscriptionId);
    return authority.attachWalletToPickupCreateResult(result, wallet);
  });
}

function patchOverviewService() {
  const service = require("./subscription/subscriptionClientOverviewService");
  wrapExport(service, "buildCurrentSubscriptionOverview", (original) => async function authoritativeOverview(args = {}) {
    await authority.releaseExpiredReservationsForUser({ userId: args.userId });
    const result = await original(args);
    if (!result || !result.data || !result.data.subscriptionId) return result;
    const wallet = await authority.readWallet(result.data.subscriptionId);
    return authority.attachWalletToOverview(result, wallet);
  });
}

function normalizeAction(actionId) {
  if (actionId === "ready-for-pickup") return "ready_for_pickup";
  if (actionId === "start_preparation") return "prepare";
  return actionId;
}

function patchOpsTransitionService() {
  const service = require("./dashboard/opsTransitionService");
  wrapExport(service, "executeAction", (original) => async function authoritativePickupTransition(
    actionId,
    context = {}
  ) {
    const action = normalizeAction(actionId);
    if (context.entityType === "subscription_pickup_request" && action === "no_show") {
      const result = await authority.settlePickupRequestAsUncollected({
        requestId: context.entityId,
        userId: context.userId,
        reason: context.payload && context.payload.reason || "no_show",
      });
      return result.pickupRequest;
    }
    return original(actionId, context);
  });
}

function installPickupMultiCyclePolicy() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;
  patchPlanningService();
  patchPickupRequestService();
  patchOverviewService();
  patchOpsTransitionService();
}

installPickupMultiCyclePolicy();

module.exports = {
  installPickupMultiCyclePolicy,
  patchOpsTransitionService,
  patchOverviewService,
  patchPickupRequestService,
  patchPlanningService,
};
