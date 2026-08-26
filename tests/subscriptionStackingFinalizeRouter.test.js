"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const {
  createFinalizeSubscriptionDraftPaymentWrapper,
} = require("../src/services/subscription/subscriptionStackingFinalizeRouterService");

function ids() {
  const userId = new mongoose.Types.ObjectId();
  return {
    userId,
    draft: {
      _id: new mongoose.Types.ObjectId(),
      userId,
      status: "pending_payment",
      subscriptionId: null,
    },
    payment: {
      _id: new mongoose.Types.ObjectId(),
      userId,
      status: "paid",
    },
  };
}

function transactionalSession() {
  return {
    supportsTransactions: true,
    inTransaction: () => true,
  };
}

function markAdditive(draft, parentId = new mongoose.Types.ObjectId()) {
  draft.stackingFinalization = {
    version: "subscription_stacking.finalization.v1",
    mode: "additive_existing_parent",
    expectedParentSubscriptionId: parentId,
    decidedAt: new Date("2026-08-06T09:00:00+03:00"),
  };
  return parentId;
}

function markInitial(draft) {
  draft.stackingFinalization = {
    version: "subscription_stacking.finalization.v1",
    mode: "standard_initial",
    expectedParentSubscriptionId: null,
    decidedAt: new Date("2026-08-06T09:00:00+03:00"),
  };
}

async function testDisabledRouterDelegatesUnchanged() {
  const { draft, payment } = ids();
  const calls = [];
  const original = async (...args) => {
    calls.push(args);
    return { applied: true, subscriptionId: "legacy" };
  };
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(original, {
    writeEnabledForUser: () => false,
  });
  const result = await wrapper({ draft, payment, session: null }, { marker: true });

  assert.deepStrictEqual(result, { applied: true, subscriptionId: "legacy" });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0].draft, draft);
  assert.deepStrictEqual(calls[0][1], { marker: true });
}

async function testAllowlistedSessionUsesStackingPath() {
  const { draft, payment } = ids();
  const expectedParentSubscriptionId = markAdditive(draft);
  let originalCalled = false;
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => {
      originalCalled = true;
      return { applied: true, subscriptionId: "legacy" };
    },
    {
      writeEnabledForUser: () => true,
      getBusinessDate: async () => "2026-08-06",
      applyStack: async (args) => {
        assert.strictEqual(args.draft, draft);
        assert.strictEqual(args.payment, payment);
        assert.strictEqual(args.businessDate, "2026-08-06");
        assert.strictEqual(args.session.inTransaction(), true);
        assert.strictEqual(
          String(args.expectedParentSubscriptionId),
          String(expectedParentSubscriptionId)
        );
        return {
          outcome: "stacked_into_existing_container",
          applied: true,
          subscriptionId: "container-1",
          idempotent: false,
        };
      },
    }
  );
  const result = await wrapper({
    draft,
    payment,
    session: transactionalSession(),
  });

  assert.strictEqual(originalCalled, false);
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.subscriptionId, "container-1");
  assert.strictEqual(result.stacking.applied, true);
}

async function testAdditiveRouteNeverFallsThroughToLegacy() {
  const { draft, payment } = ids();
  markAdditive(draft);
  let originalCalled = false;
  const original = async () => {
    originalCalled = true;
    return { applied: true, subscriptionId: "new-standard-sub" };
  };
  const activeSession = transactionalSession();
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(original, {
    writeEnabledForUser: () => true,
    getBusinessDate: async () => "2026-08-06",
    applyStack: async () => ({ outcome: "delegate_to_standard_activation" }),
  });
  await assert.rejects(
    () => wrapper({ draft, payment, session: activeSession }),
    (err) => Boolean(
      err && err.code === "STACKING_FINALIZATION_ROUTE_FELL_THROUGH"
    )
  );
  assert.strictEqual(originalCalled, false);
}

async function testRouterOwnsTransactionWhenCallerHasNone() {
  const { draft, payment } = ids();
  markAdditive(draft);
  const events = [];
  const activeSession = {
    supportsTransactions: true,
    inTransaction: () => true,
    withTransaction: async (fn) => {
      events.push("transaction:start");
      await fn();
      events.push("transaction:commit");
    },
    endSession: async () => {
      events.push("session:end");
    },
  };
  const draftInSession = { ...draft };
  const paymentInSession = { ...payment };
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => {
      throw new Error("legacy path should not run");
    },
    {
      writeEnabledForUser: () => true,
      startSession: async () => activeSession,
      findDraftById: async (id, session) => {
        assert.strictEqual(String(id), String(draft._id));
        assert.strictEqual(session, activeSession);
        events.push("draft:loaded");
        return draftInSession;
      },
      findPaymentById: async (id, session) => {
        assert.strictEqual(String(id), String(payment._id));
        assert.strictEqual(session, activeSession);
        events.push("payment:loaded");
        return paymentInSession;
      },
      getBusinessDate: async () => "2026-08-06",
      applyStack: async ({ session }) => {
        assert.strictEqual(session, activeSession);
        events.push("stack:applied");
        return {
          outcome: "stacked_into_existing_container",
          applied: true,
          subscriptionId: "container-2",
          idempotent: true,
        };
      },
    }
  );

  const result = await wrapper({ draft, payment, session: null });
  assert.strictEqual(result.subscriptionId, "container-2");
  assert(events.includes("transaction:start"));
  assert(events.includes("draft:loaded"));
  assert(events.includes("payment:loaded"));
  assert(events.includes("stack:applied"));
  assert(events.includes("transaction:commit"));
  assert.strictEqual(events[events.length - 1], "session:end");
}

async function testCompletedDraftUsesCanonicalIdempotencyPath() {
  const { draft, payment } = ids();
  draft.status = "completed";
  draft.subscriptionId = new mongoose.Types.ObjectId();
  markAdditive(draft, draft.subscriptionId);
  let stackCalled = false;
  let originalCalled = false;
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => {
      originalCalled = true;
      return { applied: false };
    },
    {
      writeEnabledForUser: () => true,
      applyStack: async () => {
        stackCalled = true;
        return null;
      },
    }
  );
  const result = await wrapper({ draft, payment, session: transactionalSession() });
  assert.strictEqual(result.subscriptionId, String(draft.subscriptionId));
  assert.strictEqual(stackCalled, false);
  assert.strictEqual(originalCalled, false);
  assert.strictEqual(result.stacking.idempotent, true);
}

async function testMissingReloadedDocumentFailsClosedAndEndsSession() {
  const { draft, payment } = ids();
  markAdditive(draft);
  let ended = false;
  const owned = {
    supportsTransactions: true,
    inTransaction: () => true,
    withTransaction: async (fn) => fn(),
    endSession: async () => { ended = true; },
  };
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => ({ applied: false }),
    {
      writeEnabledForUser: () => true,
      startSession: async () => owned,
      findDraftById: async () => null,
      findPaymentById: async () => payment,
    }
  );

  await assert.rejects(
    () => wrapper({ draft, payment, session: null }),
    (err) => Boolean(err && err.code === "STACKING_FINALIZE_DOCUMENT_MISSING")
  );
  assert.strictEqual(ended, true);
}

async function testInvalidStackResultFailsClosed() {
  const { draft, payment } = ids();
  markAdditive(draft);
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => ({ applied: true, subscriptionId: "legacy" }),
    {
      writeEnabledForUser: () => true,
      getBusinessDate: async () => "2026-08-06",
      applyStack: async () => ({
        outcome: "stacked_into_existing_container",
        applied: false,
      }),
    }
  );
  await assert.rejects(
    () => wrapper({ draft, payment, session: transactionalSession() }),
    (err) => Boolean(err && err.code === "STACKING_FINALIZE_RESULT_INVALID")
  );
}

async function testAllowlistedDraftWithoutAuthorityFailsClosed() {
  const { draft, payment } = ids();
  let originalCalled = false;
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => {
      originalCalled = true;
      return { applied: true, subscriptionId: "legacy" };
    },
    { writeEnabledForUser: () => true }
  );
  await assert.rejects(
    () => wrapper({ draft, payment, session: transactionalSession() }),
    (err) => Boolean(err && err.code === "STACKING_FINALIZATION_INTENT_MISSING")
  );
  assert.strictEqual(originalCalled, false);
}

async function testAdditiveDraftCannotBecomeLegacyAfterKillSwitch() {
  const { draft, payment } = ids();
  markAdditive(draft);
  let originalCalled = false;
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => {
      originalCalled = true;
      return { applied: true, subscriptionId: "legacy" };
    },
    { writeEnabledForUser: () => false }
  );
  await assert.rejects(
    () => wrapper({ draft, payment, session: transactionalSession() }),
    (err) => Boolean(
      err && err.code === "STACKING_FINALIZATION_DISABLED_AFTER_CHECKOUT"
    )
  );
  assert.strictEqual(originalCalled, false);
}

async function testInitialAuthorityUsesLegacyOnlyWhenNoParentExists() {
  const { draft, payment } = ids();
  markInitial(draft);
  let originalCalls = 0;
  let stackCalls = 0;
  let seedCalls = 0;
  const subscriptionId = new mongoose.Types.ObjectId();
  const finalDraft = { ...draft, status: "completed", subscriptionId };
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => {
      originalCalls += 1;
      return { applied: true, subscriptionId: String(subscriptionId) };
    },
    {
      writeEnabledForUser: () => true,
      findActiveContainer: async () => null,
      findDraftById: async () => finalDraft,
      findPaymentById: async () => payment,
      findSubscriptionById: async () => ({ _id: subscriptionId }),
      getBusinessDate: async () => "2026-08-06",
      seedInitialEntitlements: async (args) => {
        seedCalls += 1;
        assert.strictEqual(args.draft, finalDraft);
        assert.strictEqual(args.payment, payment);
        assert.strictEqual(String(args.containerSubscriptionId), String(subscriptionId));
        assert.strictEqual(args.businessDate, "2026-08-06");
        assert.strictEqual(args.session.inTransaction(), true);
        return { batch: { _id: new mongoose.Types.ObjectId() }, idempotent: false };
      },
      applyStack: async () => {
        stackCalls += 1;
        return null;
      },
    }
  );
  const result = await wrapper({
    draft,
    payment,
    session: transactionalSession(),
  });
  assert.strictEqual(result.subscriptionId, String(subscriptionId));
  assert.strictEqual(originalCalls, 1);
  assert.strictEqual(seedCalls, 1);
  assert.strictEqual(stackCalls, 0);
  assert.strictEqual(result.stacking.initialBatchCreated, true);
}

async function testInitialBatchFailureRejectsInsideCallerTransaction() {
  const { draft, payment } = ids();
  markInitial(draft);
  const subscriptionId = new mongoose.Types.ObjectId();
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => ({ applied: true, subscriptionId: String(subscriptionId) }),
    {
      writeEnabledForUser: () => true,
      findActiveContainer: async () => null,
      findDraftById: async () => ({ ...draft, status: "completed", subscriptionId }),
      findPaymentById: async () => payment,
      findSubscriptionById: async () => ({ _id: subscriptionId }),
      getBusinessDate: async () => "2026-08-06",
      seedInitialEntitlements: async () => {
        const err = new Error("seed failed");
        err.code = "SEED_FAILED";
        throw err;
      },
    }
  );
  await assert.rejects(
    () => wrapper({ draft, payment, session: transactionalSession() }),
    (err) => Boolean(err && err.code === "SEED_FAILED")
  );
}

async function testInitialAuthorityFallsBackOnStandaloneMongo() {
  const { draft, payment } = ids();
  markInitial(draft);
  const subscriptionId = new mongoose.Types.ObjectId();
  let seedCalls = 0;
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => ({ applied: true, subscriptionId: String(subscriptionId) }),
    {
      writeEnabledForUser: () => true,
      findActiveContainer: async () => null,
      getBusinessDate: async () => "2026-08-26",
      seedInitialEntitlements: async () => {
        seedCalls += 1;
        return { batch: { _id: new mongoose.Types.ObjectId() } };
      },
    }
  );
  const session = transactionalSession();
  session.supportsTransactions = false;
  const result = await wrapper({ draft, payment, session });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.subscriptionId, String(subscriptionId));
  assert.strictEqual(result.stacking.legacyFallback, true);
  assert.strictEqual(result.stacking.initialBatchCreated, false);
  assert.strictEqual(result.stacking.reason, "transactions_unsupported");
  assert.strictEqual(seedCalls, 0);
}

async function testInitialAuthorityCannotReplaceNewlyActiveParent() {
  const { draft, payment } = ids();
  markInitial(draft);
  let originalCalled = false;
  const wrapper = createFinalizeSubscriptionDraftPaymentWrapper(
    async () => {
      originalCalled = true;
      return { applied: true, subscriptionId: "legacy" };
    },
    {
      writeEnabledForUser: () => true,
      getBusinessDate: async () => "2026-08-26",
      findActiveContainer: async (userId, session, businessDate) => {
        assert.strictEqual(businessDate, "2026-08-26");
        return { _id: new mongoose.Types.ObjectId() };
      },
    }
  );
  await assert.rejects(
    () => wrapper({ draft, payment, session: transactionalSession() }),
    (err) => Boolean(
      err && err.code === "STACKING_INITIAL_FINALIZATION_CONFLICT"
    )
  );
  assert.strictEqual(originalCalled, false);
}

async function run() {
  await testDisabledRouterDelegatesUnchanged();
  await testAllowlistedSessionUsesStackingPath();
  await testAdditiveRouteNeverFallsThroughToLegacy();
  await testRouterOwnsTransactionWhenCallerHasNone();
  await testCompletedDraftUsesCanonicalIdempotencyPath();
  await testMissingReloadedDocumentFailsClosedAndEndsSession();
  await testInvalidStackResultFailsClosed();
  await testAllowlistedDraftWithoutAuthorityFailsClosed();
  await testAdditiveDraftCannotBecomeLegacyAfterKillSwitch();
  await testInitialAuthorityUsesLegacyOnlyWhenNoParentExists();
  await testInitialBatchFailureRejectsInsideCallerTransaction();
  await testInitialAuthorityFallsBackOnStandaloneMongo();
  await testInitialAuthorityCannotReplaceNewlyActiveParent();
  console.log("subscription stacking finalize router tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
