"use strict";

require("./installPickupEntitlementClosure");

const Subscription = require("../models/Subscription");
const { getRestaurantBusinessDate } = require("./restaurantHoursService");
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

async function releaseExpiredForPickupSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const subscription = await Subscription.findById(subscriptionId)
    .select("_id deliveryMode")
    .lean();
  if (!subscription || subscription.deliveryMode !== "pickup") return null;
  return authority.releaseExpiredReservationsForSubscription({
    subscriptionId: subscription._id,
  });
}

async function releaseExpiredForPickupUser(userId) {
  if (!userId) return null;
  const subscription = await Subscription.findOne({
    userId,
    status: "active",
    deliveryMode: "pickup",
  })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();
  if (!subscription) return null;
  return authority.releaseExpiredReservationsForSubscription({
    subscriptionId: subscription._id,
  });
}

async function reconcileCurrentPickupDay(subscriptionId, date) {
  if (!subscriptionId || !date) return null;
  const businessDate = await getRestaurantBusinessDate();
  if (String(date) !== String(businessDate)) return null;
  return authority.reconcileConfirmedDayAllocations({
    subscriptionId,
    date,
  });
}

function balanceEventForStatus(status) {
  if (status === "fulfilled") return "pickup_fulfilled_consumed";
  if (status === "no_show" || status === "canceled") return "pickup_uncollected_returned";
  return "pickup_reserved_pending_fulfillment";
}

function attachLifecycleBalance(payload, wallet) {
  if (!payload || typeof payload !== "object") return payload;
  return {
    ...payload,
    entitlementWallet: wallet,
    balanceChange: {
      event: balanceEventForStatus(String(payload.status || "")),
      remainingMeals: wallet.remainingMeals,
      reservedMeals: wallet.reservedMeals,
      consumedMeals: wallet.consumedMeals,
      forfeitedMeals: wallet.forfeitedMeals,
      sourceOfTruth: wallet.sourceOfTruth,
      consumptionAppliedAtFulfillment: true,
    },
  };
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
    await releaseExpiredForPickupSubscription(args.subscriptionId);
    await reconcileCurrentPickupDay(args.subscriptionId, args.date);
    const result = await original(args);
    const wallet = await authority.readWallet(args.subscriptionId);
    return authority.attachWalletToAvailability(result, wallet);
  });

  wrapExport(service, "createSubscriptionPickupRequestForClient", (original) => async function authoritativeCreate(args = {}) {
    await releaseExpiredForPickupSubscription(args.subscriptionId);
    await reconcileCurrentPickupDay(args.subscriptionId, args.date);
    const result = await original(args);
    const wallet = await authority.readWallet(args.subscriptionId);
    return authority.attachWalletToPickupCreateResult(result, wallet);
  });

  wrapExport(service, "getSubscriptionPickupRequestStatusForClient", (original) => async function authoritativeStatus(args = {}) {
    await releaseExpiredForPickupSubscription(args.subscriptionId);
    const result = await original(args);
    const wallet = await authority.readWallet(args.subscriptionId);
    return attachLifecycleBalance(result, wallet);
  });

  wrapExport(service, "listSubscriptionPickupRequestsForClient", (original) => async function authoritativeList(args = {}) {
    await releaseExpiredForPickupSubscription(args.subscriptionId);
    const result = await original(args);
    const wallet = await authority.readWallet(args.subscriptionId);
    return {
      ...result,
      entitlementWallet: wallet,
      requests: Array.isArray(result && result.requests)
        ? result.requests.map((request) => attachLifecycleBalance(request, wallet))
        : [],
    };
  });
}

function patchOverviewService() {
  const service = require("./subscription/subscriptionClientOverviewService");
  wrapExport(service, "buildCurrentSubscriptionOverview", (original) => async function authoritativeOverview(args = {}) {
    await releaseExpiredForPickupUser(args.userId);
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
  attachLifecycleBalance,
  installPickupMultiCyclePolicy,
  patchOpsTransitionService,
  patchOverviewService,
  patchPickupRequestService,
  patchPlanningService,
  reconcileCurrentPickupDay,
  releaseExpiredForPickupSubscription,
  releaseExpiredForPickupUser,
};
