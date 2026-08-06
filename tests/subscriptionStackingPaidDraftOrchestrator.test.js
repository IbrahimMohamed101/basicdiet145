"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const {
  applyPaidDraftToSubscriptionStackTransactional,
} = require("../src/services/subscription/subscriptionStackingPaidDraftOrchestratorService");

function session() {
  return {
    supportsTransactions: true,
    inTransaction: () => true,
  };
}

function fixture() {
  const userId = new mongoose.Types.ObjectId();
  const draft = {
    _id: new mongoose.Types.ObjectId(),
    userId,
    status: "pending_payment",
  };
  const payment = {
    _id: new mongoose.Types.ObjectId(),
    userId,
    status: "paid",
  };
  const container = {
    _id: new mongoose.Types.ObjectId(),
    userId,
  };
  const purchaseBatch = {
    _id: new mongoose.Types.ObjectId(),
    effectiveStartDate: new Date("2026-08-06T00:00:00+03:00"),
    endDate: new Date("2026-08-31T00:00:00+03:00"),
  };
  return { draft, payment, container, purchaseBatch };
}

async function testHappyPathMaterializesDaysAfterActivation() {
  const { draft, payment, container, purchaseBatch } = fixture();
  const calls = [];
  const result = await applyPaidDraftToSubscriptionStackTransactional({
    draft,
    payment,
    businessDate: "2026-08-06",
    session: session(),
    runtime: {
      buildActivationPayload: async () => {
        calls.push("build");
        return { subscriptionPayload: { selectedMealsPerDay: 2 } };
      },
      activateIntoContainer: async () => {
        calls.push("activate");
        return {
          outcome: "stacked_into_existing_container",
          container,
          purchaseBatch,
          idempotent: false,
        };
      },
      materializeDays: async ({ container: receivedContainer, batch }) => {
        calls.push("days");
        assert.strictEqual(String(receivedContainer._id), String(container._id));
        assert.strictEqual(String(batch._id), String(purchaseBatch._id));
        return {
          requestedCount: 26,
          upsertedCount: 5,
          idempotent: false,
        };
      },
    },
  });

  assert.deepStrictEqual(calls, ["build", "activate", "days"]);
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.outcome, "stacked_into_existing_container");
  assert.strictEqual(result.subscriptionId, String(container._id));
  assert.strictEqual(result.dayMaterialization.requestedCount, 26);
  assert.strictEqual(result.idempotent, false);
}

async function testRepeatedActivationCanBeFullyIdempotent() {
  const { draft, payment, container, purchaseBatch } = fixture();
  const result = await applyPaidDraftToSubscriptionStackTransactional({
    draft,
    payment,
    businessDate: "2026-08-06",
    session: session(),
    runtime: {
      buildActivationPayload: async () => ({ subscriptionPayload: {} }),
      activateIntoContainer: async () => ({
        outcome: "stacked_into_existing_container",
        container,
        purchaseBatch,
        idempotent: true,
      }),
      materializeDays: async () => ({
        requestedCount: 26,
        upsertedCount: 0,
        idempotent: true,
      }),
    },
  });
  assert.strictEqual(result.idempotent, true);
}

async function testNoContainerDelegatesWithoutCreatingDays() {
  const { draft, payment } = fixture();
  let materializeCalled = false;
  const result = await applyPaidDraftToSubscriptionStackTransactional({
    draft,
    payment,
    businessDate: "2026-08-06",
    session: session(),
    runtime: {
      buildActivationPayload: async () => ({ subscriptionPayload: {} }),
      activateIntoContainer: async () => ({
        outcome: "delegate_to_standard_activation",
      }),
      materializeDays: async () => {
        materializeCalled = true;
        return {};
      },
    },
  });
  assert.strictEqual(result.outcome, "delegate_to_standard_activation");
  assert.strictEqual(result.applied, false);
  assert.strictEqual(materializeCalled, false);
}

async function testDayFailureRejectsWholeOrchestration() {
  const { draft, payment, container, purchaseBatch } = fixture();
  await assert.rejects(
    () => applyPaidDraftToSubscriptionStackTransactional({
      draft,
      payment,
      businessDate: "2026-08-06",
      session: session(),
      runtime: {
        buildActivationPayload: async () => ({ subscriptionPayload: {} }),
        activateIntoContainer: async () => ({
          outcome: "stacked_into_existing_container",
          container,
          purchaseBatch,
        }),
        materializeDays: async () => {
          const err = new Error("day upsert failed");
          err.code = "DAY_UPSERT_FAILED";
          throw err;
        },
      },
    }),
    (err) => Boolean(err && err.code === "DAY_UPSERT_FAILED")
  );
}

async function testInvalidIdentityAndTransactionAreRejected() {
  const { draft, payment } = fixture();
  await assert.rejects(
    () => applyPaidDraftToSubscriptionStackTransactional({
      draft,
      payment: { ...payment, userId: new mongoose.Types.ObjectId() },
      businessDate: "2026-08-06",
      session: session(),
      runtime: {},
    }),
    (err) => Boolean(err && err.code === "STACKING_DRAFT_PAYMENT_USER_MISMATCH")
  );

  await assert.rejects(
    () => applyPaidDraftToSubscriptionStackTransactional({
      draft,
      payment,
      businessDate: "2026-08-06",
      session: null,
      runtime: {},
    }),
    (err) => Boolean(err && err.code === "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED")
  );
}

async function testEmptyMaterializationFailsClosed() {
  const { draft, payment, container, purchaseBatch } = fixture();
  await assert.rejects(
    () => applyPaidDraftToSubscriptionStackTransactional({
      draft,
      payment,
      businessDate: "2026-08-06",
      session: session(),
      runtime: {
        buildActivationPayload: async () => ({ subscriptionPayload: {} }),
        activateIntoContainer: async () => ({
          outcome: "stacked_into_existing_container",
          container,
          purchaseBatch,
        }),
        materializeDays: async () => ({ requestedCount: 0 }),
      },
    }),
    (err) => Boolean(err && err.code === "STACKING_DAY_MATERIALIZATION_EMPTY")
  );
}

async function run() {
  await testHappyPathMaterializesDaysAfterActivation();
  await testRepeatedActivationCanBeFullyIdempotent();
  await testNoContainerDelegatesWithoutCreatingDays();
  await testDayFailureRejectsWholeOrchestration();
  await testInvalidIdentityAndTransactionAreRejected();
  await testEmptyMaterializationFailsClosed();
  console.log("subscription stacking paid draft orchestrator tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
