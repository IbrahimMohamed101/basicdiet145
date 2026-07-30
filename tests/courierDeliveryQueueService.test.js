"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const {
  buildOneTimeOrderQuery,
  canonicalPersistedDeliveryStatus,
  deliveryStatusFromOrder,
  deliveryStatusFromSubscriptionDay,
  isVisibleDeliveryDayStatus,
  makeQueueRowReadOnly,
  resolveBusinessDate,
  resolveDayZoneName,
  resolveOrderDeliveryStatus,
  resolveSubscriptionDeliveryStatus,
} = require("../src/services/courierDeliveryQueueService");

(function run() {
  assert.strictEqual(resolveBusinessDate("2026-07-30"), "2026-07-30");
  assert.throws(
    () => resolveBusinessDate("2026-02-30"),
    (error) => error && error.code === "INVALID_DATE" && error.status === 400
  );
  assert.throws(
    () => resolveBusinessDate("30-07-2026"),
    (error) => error && error.code === "INVALID_DATE" && error.status === 400
  );

  const orderQuery = buildOneTimeOrderQuery("2026-07-30");
  assert(Array.isArray(orderQuery.$and), "date and delivery-mode clauses must coexist under $and");
  assert.strictEqual(orderQuery.$and.length, 2);
  assert.deepStrictEqual(orderQuery.$and[0], {
    $or: [{ fulfillmentDate: "2026-07-30" }, { deliveryDate: "2026-07-30" }],
  });
  assert.deepStrictEqual(orderQuery.$and[1], {
    $or: [{ fulfillmentMethod: "delivery" }, { deliveryMode: "delivery" }],
  });

  for (const status of [
    "open",
    "locked",
    "in_preparation",
    "ready_for_delivery",
    "out_for_delivery",
    "fulfilled",
    "delivery_canceled",
  ]) {
    assert.strictEqual(isVisibleDeliveryDayStatus(status), true, `${status} must remain visible`);
  }
  for (const status of ["frozen", "skipped", "no_show", "canceled_at_branch"]) {
    assert.strictEqual(isVisibleDeliveryDayStatus(status), false, `${status} is not a delivery queue row`);
  }

  assert.strictEqual(canonicalPersistedDeliveryStatus("fulfilled"), "delivered");
  assert.strictEqual(canonicalPersistedDeliveryStatus("delivery_canceled"), "canceled");
  assert.strictEqual(canonicalPersistedDeliveryStatus("in_preparation"), "preparing");

  assert.strictEqual(deliveryStatusFromSubscriptionDay("open"), "preparing");
  assert.strictEqual(deliveryStatusFromSubscriptionDay("locked"), "preparing");
  assert.strictEqual(deliveryStatusFromSubscriptionDay("in_preparation"), "preparing");
  assert.strictEqual(deliveryStatusFromSubscriptionDay("ready_for_delivery"), "ready_for_delivery");
  assert.strictEqual(deliveryStatusFromSubscriptionDay("out_for_delivery"), "out_for_delivery");
  assert.strictEqual(deliveryStatusFromSubscriptionDay("fulfilled"), "delivered");
  assert.strictEqual(deliveryStatusFromSubscriptionDay("delivery_canceled"), "canceled");

  assert.strictEqual(deliveryStatusFromOrder("confirmed"), "preparing");
  assert.strictEqual(deliveryStatusFromOrder("in_preparation"), "preparing");
  assert.strictEqual(deliveryStatusFromOrder("out_for_delivery"), "out_for_delivery");
  assert.strictEqual(deliveryStatusFromOrder("fulfilled"), "delivered");
  assert.strictEqual(deliveryStatusFromOrder("cancelled"), "canceled");

  assert.strictEqual(
    resolveSubscriptionDeliveryStatus({ status: "fulfilled" }, { status: "scheduled" }),
    "delivered",
    "the canonical day state must prevent a fulfilled row from falling back to preparing"
  );
  assert.strictEqual(
    resolveSubscriptionDeliveryStatus({ status: "in_preparation" }, { status: "ready_for_delivery" }),
    "ready_for_delivery",
    "a persisted ready state must not regress to preparing"
  );
  assert.strictEqual(
    resolveSubscriptionDeliveryStatus({ status: "out_for_delivery" }, { status: "scheduled" }),
    "out_for_delivery"
  );

  assert.strictEqual(
    resolveOrderDeliveryStatus({ status: "out_for_delivery" }, null),
    "out_for_delivery",
    "orders without a Delivery row must still expose their real operational status"
  );
  assert.strictEqual(
    resolveOrderDeliveryStatus({ status: "confirmed" }, { status: "fulfilled" }),
    "delivered",
    "legacy persisted fulfilled aliases must remain terminal"
  );
  assert.strictEqual(
    resolveOrderDeliveryStatus({ status: "fulfilled" }, { status: "scheduled" }),
    "delivered"
  );

  assert.strictEqual(
    resolveDayZoneName(
      {},
      { deliveryZoneName: "", deliveryAddress: { district: "الروضة", city: "جدة" } },
      {},
      { district: "الروضة", city: "جدة" }
    ),
    "الروضة",
    "district must be available to the dashboard region filter when no zone record exists"
  );

  const historical = makeQueueRowReadOnly({
    id: "delivery-1",
    canCourierPickup: true,
    canMarkArrivingSoon: true,
    canMarkDelivered: true,
    canCancel: true,
    allowedActions: [{ id: "fulfill" }],
    allowedActionIds: ["fulfill"],
  });
  assert.strictEqual(historical.canCourierPickup, false);
  assert.strictEqual(historical.canMarkArrivingSoon, false);
  assert.strictEqual(historical.canMarkDelivered, false);
  assert.strictEqual(historical.canCancel, false);
  assert.deepStrictEqual(historical.allowedActions, []);
  assert.deepStrictEqual(historical.allowedActionIds, []);

  console.log("Courier delivery queue service checks passed.");
})();
