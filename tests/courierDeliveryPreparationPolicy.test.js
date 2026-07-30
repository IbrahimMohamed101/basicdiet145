"use strict";

const assert = require("assert");
const opsActionPolicy = require("../src/services/dashboard/opsActionPolicy");

function allowedActionIds(input) {
  return opsActionPolicy.getAllowedActions({
    lang: "en",
    ...input,
  }).map((action) => action.id);
}

(function run() {
  const courierSubscriptionOpen = {
    entityType: "subscription",
    status: "open",
    mode: "delivery",
    role: "courier",
  };
  assert(
    allowedActionIds(courierSubscriptionOpen).includes("prepare"),
    "courier must receive prepare for an open delivery subscription day"
  );
  assert.deepStrictEqual(
    opsActionPolicy.validateAction({
      ...courierSubscriptionOpen,
      actionId: "prepare",
    }),
    { allowed: true }
  );

  const courierSubscriptionPreparing = {
    entityType: "subscription",
    status: "in_preparation",
    mode: "delivery",
    role: "courier",
  };
  assert(
    allowedActionIds(courierSubscriptionPreparing).includes("ready_for_delivery"),
    "courier must receive ready_for_delivery after preparation"
  );
  assert.deepStrictEqual(
    opsActionPolicy.validateAction({
      ...courierSubscriptionPreparing,
      actionId: "ready_for_delivery",
    }),
    { allowed: true }
  );

  const courierDeliveryOrder = {
    entityType: "order",
    status: "confirmed",
    mode: "delivery",
    role: "courier",
  };
  assert(
    allowedActionIds(courierDeliveryOrder).includes("prepare"),
    "courier must receive prepare for confirmed one-time delivery orders"
  );

  const courierPickup = {
    entityType: "subscription",
    status: "open",
    mode: "pickup",
    role: "courier",
  };
  assert(
    !allowedActionIds(courierPickup).includes("prepare"),
    "courier preparation permission must remain limited to delivery mode"
  );
  assert.deepStrictEqual(
    opsActionPolicy.validateAction({
      ...courierPickup,
      actionId: "prepare",
    }),
    { allowed: false, reason: "INVALID_ROLE_FOR_MODE" }
  );

  const kitchenDelivery = {
    entityType: "subscription",
    status: "open",
    mode: "delivery",
    role: "kitchen",
  };
  assert(
    allowedActionIds(kitchenDelivery).includes("prepare"),
    "existing kitchen preparation permission must remain unchanged"
  );

  console.log("Courier delivery preparation policy checks passed.");
})();
