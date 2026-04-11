"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { listKitchenOperations } = require("../src/services/kitchenOperations/KitchenOperationsListService");
const { getKitchenOperationsSummary } = require("../src/services/kitchenOperations/KitchenOperationsSummaryService");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createRuntime({ subscriptionDays = [], orders = [], mealNames = {}, addonNames = {} } = {}) {
  return {
    async fetchSubscriptionDaysByDate() {
      return subscriptionDays;
    },
    async fetchOrdersByDate() {
      return orders;
    },
    async fetchMealNameMap() {
      return new Map(Object.entries(mealNames));
    },
    async fetchAddonNameMap() {
      return new Map(Object.entries(addonNames));
    },
  };
}

test("Kitchen operations list maps pickup subscription rows into a unified frontend DTO", async () => {
  const subscriptionId = objectId();
  const dayId = objectId();

  const runtime = createRuntime({
    subscriptionDays: [
      {
        _id: dayId,
        subscriptionId: {
          _id: subscriptionId,
          deliveryMode: "pickup",
          deliveryWindow: "09:00-12:00",
          pickupLocationId: "branch-1",
          userId: {
            _id: objectId(),
            name: "أحمد",
            phone: "966500000000",
          },
        },
        date: "2026-04-07",
        status: "ready_for_pickup",
        selections: [],
        premiumSelections: [],
        recurringAddons: [{ addonId: "addon-1", name: "صوص خاص" }],
        customSalads: [],
        customMeals: [],
        assignedByKitchen: true,
        pickupRequested: true,
        pickupCode: "123456",
        createdAt: new Date("2026-04-07T07:30:00.000Z"),
        lockedSnapshot: {
          deliveryMode: "pickup",
          deliveryWindow: "09:00-12:00",
          pickupLocationId: "branch-1",
          customerName: "اسم قديم يجب تجاهله",
          planning: {
            baseMealSlots: [{ slotKey: "base_1", mealId: "meal-1" }],
          },
        },
      },
    ],
    mealNames: {
      "meal-1": { ar: "دجاج مشوي" },
    },
    addonNames: {
      "addon-1": { ar: "صوص خاص" },
    },
  });

  const response = await listKitchenOperations(
    { date: "2026-04-07", tab: "branch_pickup", page: 1, limit: 10 },
    { runtime }
  );

  assert.equal(response.rows.length, 1);
  assert.equal(response.rows[0].entityType, "pickup_day");
  assert.equal(response.rows[0].customer.name, "أحمد");
  assert.equal(response.rows[0].status, "ready_for_pickup");
  assert.deepEqual(
    response.rows[0].items.map((item) => ({ name: item.name, kind: item.kind })),
    [
      { name: "دجاج مشوي", kind: "meal" },
      { name: "صوص خاص", kind: "addon" },
    ]
  );
  assert.deepEqual(
    response.rows[0].actions.map((action) => action.key),
    ["verify_pickup", "fulfill_pickup", "pickup_no_show", "cancel_at_branch"]
  );
  assert.equal(response.rows[0].actions[0].enabled, true);
  assert.equal(response.rows[0].actions[1].enabled, false);
  assert.equal(response.rows[0].verification.status, "not_verified");
  assert.equal(response.rows[0].ui.layout, "card");
  assert.ok(response.rows[0].timing.createdAtLabel);
  assert.equal(response.rows[0].timeWindow.label, "09:00 - 12:00");
});

test("Kitchen operations list normalizes order rows and exposes kitchen actions without frontend inference", async () => {
  const preparingOrderId = objectId();
  const confirmedOrderId = objectId();

  const runtime = createRuntime({
    orders: [
      {
        _id: confirmedOrderId,
        userId: { _id: objectId(), name: "سارة", phone: "966511111111" },
        status: "confirmed",
        deliveryMode: "delivery",
        deliveryDate: "2026-04-07",
        deliveryWindow: "13:00 - 16:00",
        createdAt: new Date("2026-04-07T08:15:00.000Z"),
        items: [{ mealId: "meal-10", quantity: 1, name: "" }],
        customSalads: [],
        customMeals: [],
      },
      {
        _id: preparingOrderId,
        userId: { _id: objectId(), name: "ليلى", phone: "966522222222" },
        status: "preparing",
        deliveryMode: "pickup",
        deliveryDate: "2026-04-07",
        deliveryWindow: "18:00-20:00",
        createdAt: new Date("2026-04-07T09:10:00.000Z"),
        items: [{ mealId: "meal-20", quantity: 2, name: "" }],
        customSalads: [],
        customMeals: [],
      },
    ],
    mealNames: {
      "meal-10": { ar: "ستيك" },
      "meal-20": { ar: "باستا" },
    },
  });

  const response = await listKitchenOperations(
    { date: "2026-04-07", tab: "orders", sortBy: "reference" },
    { runtime }
  );

  assert.equal(response.rows.length, 2);

  const confirmedRow = response.rows.find((row) => row.meta.orderId === String(confirmedOrderId));
  assert.equal(confirmedRow.status, "open");
  assert.deepEqual(confirmedRow.actions.map((action) => action.key), ["start_preparation"]);
  assert.equal(confirmedRow.ui.layout, "table");
  assert.ok(confirmedRow.timing.createdAt);

  const preparingRow = response.rows.find((row) => row.meta.orderId === String(preparingOrderId));
  assert.equal(preparingRow.status, "in_preparation");
  assert.deepEqual(preparingRow.actions.map((action) => action.key), ["ready_for_pickup", "fulfilled"]);
  assert.equal(preparingRow.items[0].name, "باستا x2");
  assert.equal(preparingRow.verification.status, "not_verified");

  const sortedByCreatedAt = await listKitchenOperations(
    { date: "2026-04-07", tab: "orders", sortBy: "createdAt", sortOrder: "desc" },
    { runtime }
  );
  assert.equal(sortedByCreatedAt.rows[0].meta.orderId, String(preparingOrderId));
});

test("Kitchen operations summary aggregates cards, tabs, and filter counts from normalized rows", async () => {
  const runtime = createRuntime({
    subscriptionDays: [
      {
        _id: objectId(),
        subscriptionId: {
          _id: objectId(),
          deliveryMode: "delivery",
          deliveryWindow: "09:00-12:00",
          userId: { _id: objectId(), name: "عميل 1", phone: "1" },
        },
        date: "2026-04-07",
        status: "open",
        selections: [],
        premiumSelections: [],
        recurringAddons: [],
        customSalads: [],
        customMeals: [],
      },
      {
        _id: objectId(),
        subscriptionId: {
          _id: objectId(),
          deliveryMode: "delivery",
          deliveryWindow: "12:00-15:00",
          userId: { _id: objectId(), name: "عميل 2", phone: "2" },
        },
        date: "2026-04-07",
        status: "locked",
        selections: ["meal-1"],
        premiumSelections: [],
        recurringAddons: [],
        customSalads: [],
        customMeals: [],
      },
      {
        _id: objectId(),
        subscriptionId: {
          _id: objectId(),
          deliveryMode: "pickup",
          deliveryWindow: "18:00-20:00",
          pickupLocationId: "branch-7",
          userId: { _id: objectId(), name: "عميل 3", phone: "3" },
        },
        date: "2026-04-07",
        status: "ready_for_pickup",
        selections: ["meal-2"],
        premiumSelections: [],
        recurringAddons: [],
        customSalads: [],
        customMeals: [],
        lockedSnapshot: {
          deliveryMode: "pickup",
          deliveryWindow: "18:00-20:00",
          pickupLocationId: "branch-7",
        },
      },
    ],
    orders: [
      {
        _id: objectId(),
        userId: { _id: objectId(), name: "طلب 1", phone: "4" },
        status: "created",
        deliveryMode: "delivery",
        deliveryDate: "2026-04-07",
        deliveryWindow: "10:00-12:00",
        items: [{ mealId: "meal-3", quantity: 1, name: "" }],
        customSalads: [],
        customMeals: [],
      },
      {
        _id: objectId(),
        userId: { _id: objectId(), name: "طلب 2", phone: "5" },
        status: "preparing",
        deliveryMode: "pickup",
        deliveryDate: "2026-04-07",
        deliveryWindow: "14:00-16:00",
        items: [{ mealId: "meal-4", quantity: 1, name: "" }],
        customSalads: [],
        customMeals: [],
      },
    ],
    mealNames: {
      "meal-1": { ar: "وجبة 1" },
      "meal-2": { ar: "وجبة 2" },
      "meal-3": { ar: "وجبة 3" },
      "meal-4": { ar: "وجبة 4" },
    },
  });

  const response = await getKitchenOperationsSummary(
    { date: "2026-04-07" },
    { runtime }
  );

  assert.equal(response.summary.subscriptionsToday, 3);
  assert.equal(response.summary.lockedDays, 1);
  assert.equal(response.summary.readyForPickup, 1);
  assert.equal(response.summary.inPreparation, 1);
  assert.equal(response.summary.individualOrders, 2);
  assert.equal(response.summary.receivedToday, 1);
  assert.equal(response.summary.notPrepared, 1);
  assert.equal(response.tabs.branchPickup, 1);
  assert.equal(response.subscriptionFilters.delivery, 2);
  assert.equal(response.subscriptionFilters.pickup, 1);
  assert.equal(response.subscriptionFilters.not_prepared, 1);
});

test("Kitchen operations list returns stable empty-state pagination", async () => {
  const runtime = createRuntime();

  const response = await listKitchenOperations(
    { date: "2026-04-07", tab: "orders", page: 1, limit: 20 },
    { runtime }
  );

  assert.deepEqual(response.rows, []);
  assert.deepEqual(response.pagination, {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
});
