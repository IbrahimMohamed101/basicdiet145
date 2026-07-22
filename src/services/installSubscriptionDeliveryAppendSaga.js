"use strict";

const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { resolveEffectiveFulfillmentMode } = require("./subscription/subscriptionFulfillmentPolicyService");
const lockService = require("./subscription/subscriptionDayMutationLockService");
const deliveryAppendSaga = require("./subscription/subscriptionDeliveryAppendSagaService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionDeliveryAppendSaga.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionDeliveryAppendSaga.wrapped");
const INTERNAL_TOKEN_FIELD = "__dayMutationToken";

function errorResult(err) {
  return {
    ok: false,
    status: Number(err && err.status || 500),
    code: String(err && err.code || "DAY_MUTATION_FAILED"),
    message: String(err && err.message || "Day mutation failed"),
    details: err && err.details,
  };
}

function stripInternalToken(body = {}) {
  if (!body || typeof body !== "object" || !Object.prototype.hasOwnProperty.call(body, INTERNAL_TOKEN_FIELD)) {
    return body;
  }
  const copy = { ...body };
  delete copy[INTERNAL_TOKEN_FIELD];
  return copy;
}

function installSubscriptionDeliveryAppendSaga() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const planningService = require("./subscription/subscriptionPlanningClientService");
  const currentUpdate = planningService.updateDaySelectionForClient;
  const currentAppend = planningService.appendDayMealsForClient;

  if (typeof currentUpdate === "function" && !currentUpdate.__dayMutationLockAware) {
    const lockedUpdate = async function dayMutationLockAwareUpdate(args = {}) {
      const body = args.body || {};
      const token = body[INTERNAL_TOKEN_FIELD] || null;
      try {
        await lockService.assertDayMutationAllowed({
          subscriptionId: args.subscriptionId,
          date: args.date,
          token,
        });
      } catch (err) {
        return errorResult(err);
      }
      return currentUpdate({
        ...args,
        body: stripInternalToken(body),
      });
    };
    lockedUpdate[WRAPPED_KEY] = true;
    lockedUpdate.__original = currentUpdate;
    lockedUpdate.__dayMutationLockAware = true;
    planningService.updateDaySelectionForClient = lockedUpdate;
  }

  if (typeof currentAppend === "function" && !currentAppend.__deliveryAppendSaga) {
    const appendWithSaga = async function deliveryModeAwareAppendSaga(args = {}) {
      try {
        const [subscription, day] = await Promise.all([
          Subscription.findById(args.subscriptionId).lean(),
          SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).lean(),
        ]);
        if (!subscription || !day) return currentAppend(args);
        const effectiveMode = resolveEffectiveFulfillmentMode({
          subscription,
          day,
          date: args.date,
        });
        if (effectiveMode !== "delivery") return currentAppend(args);
        return deliveryAppendSaga.appendDeliveryMeals({
          args,
          updateSelectionFn: planningService.updateDaySelectionForClient,
        });
      } catch (err) {
        return errorResult(err);
      }
    };
    appendWithSaga[WRAPPED_KEY] = true;
    appendWithSaga.__original = currentAppend;
    appendWithSaga.__deliveryAppendSaga = true;
    planningService.appendDayMealsForClient = appendWithSaga;
  }
}

installSubscriptionDeliveryAppendSaga();

module.exports = {
  INTERNAL_TOKEN_FIELD,
  installSubscriptionDeliveryAppendSaga,
  stripInternalToken,
};
