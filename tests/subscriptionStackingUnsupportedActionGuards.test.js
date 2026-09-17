"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  createUnsupportedActionWrappers,
  resolveGuardDecision,
} = require("../src/services/subscription/subscriptionStackingUnsupportedActionGuardService");

function originals(calls) {
  return {
    performSkipDay: async (args) => { calls.push(["skip", args]); return { source: "skip" }; },
    performUnskipDay: async (args) => { calls.push(["unskip", args]); return { source: "unskip" }; },
    performSkipRange: async (args) => { calls.push(["skip_range", args]); return { source: "skip_range" }; },
    freezeSubscriptionForClient: async (args) => { calls.push(["freeze", args]); return { source: "freeze" }; },
    unfreezeSubscriptionForClient: async (args) => { calls.push(["unfreeze", args]); return { source: "unfreeze" }; },
    cancelSubscriptionDomain: async (args) => { calls.push(["cancel", args]); return { outcome: "canceled" }; },
  };
}

function blockedRuntime(overrides = {}) {
  return {
    globallyEnabled: () => true,
    writeEnabledForUser: (userId) => userId === "allowed-user",
    findBatchOwner: async (subscriptionId) => ({
      userId: "allowed-user",
      containerSubscriptionId: subscriptionId,
    }),
    ...overrides,
  };
}

async function testGlobalDisableIsExactNoOpWithoutDatabaseRead() {
  const calls = [];
  let batchQueries = 0;
  const wrappers = createUnsupportedActionWrappers(originals(calls), {
    globallyEnabled: () => false,
    writeEnabledForUser: () => true,
    findBatchOwner: async () => {
      batchQueries += 1;
      throw new Error("batch query must not run");
    },
  });

  assert.strictEqual(
    (await wrappers.performSkipDay({ subscriptionId: "sub-1", userId: "allowed-user" })).source,
    "skip"
  );
  assert.strictEqual(
    (await wrappers.freezeSubscriptionForClient({ subscriptionId: "sub-1", userId: "allowed-user" })).source,
    "freeze"
  );
  assert.strictEqual(
    (await wrappers.cancelSubscriptionDomain({ subscriptionId: "sub-1", actor: { kind: "system" } })).outcome,
    "canceled"
  );
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(batchQueries, 0);
}

async function testNonAllowlistedUserDelegatesWithoutBatchQuery() {
  let batchQueries = 0;
  const calls = [];
  const wrappers = createUnsupportedActionWrappers(originals(calls), {
    globallyEnabled: () => true,
    writeEnabledForUser: () => false,
    findBatchOwner: async () => {
      batchQueries += 1;
      return null;
    },
  });

  const result = await wrappers.performSkipDay({
    subscriptionId: "sub-1",
    userId: "other-user",
  });
  assert.strictEqual(result.source, "skip");
  assert.strictEqual(batchQueries, 0);
}

async function testAllowlistedButNonStackedSubscriptionDelegates() {
  const calls = [];
  const wrappers = createUnsupportedActionWrappers(originals(calls), blockedRuntime({
    findBatchOwner: async () => null,
  }));
  const result = await wrappers.performUnskipDay({
    subscriptionId: "sub-standard",
    userId: "allowed-user",
  });
  assert.strictEqual(result.source, "unskip");
  assert.strictEqual(calls.length, 1);
}

async function testSkipVariantsThrowBeforeMutation() {
  const calls = [];
  const wrappers = createUnsupportedActionWrappers(originals(calls), blockedRuntime());

  await assert.rejects(
    () => wrappers.performSkipDay({ subscriptionId: "sub-stack", userId: "allowed-user" }),
    (err) => Boolean(err && err.code === "STACKING_SKIP_NOT_READY" && err.status === 503)
  );
  await assert.rejects(
    () => wrappers.performUnskipDay({ subscriptionId: "sub-stack", userId: "allowed-user" }),
    (err) => Boolean(err && err.code === "STACKING_UNSKIP_NOT_READY")
  );
  await assert.rejects(
    () => wrappers.performSkipRange({ subscriptionId: "sub-stack", userId: "allowed-user" }),
    (err) => Boolean(err && err.code === "STACKING_SKIP_RANGE_NOT_READY")
  );
  assert.strictEqual(calls.length, 0);
}

async function testFreezeVariantsReturnClientErrorShape() {
  const wrappers = createUnsupportedActionWrappers(originals([]), blockedRuntime());
  const freeze = await wrappers.freezeSubscriptionForClient({
    subscriptionId: "sub-stack",
    userId: "allowed-user",
  });
  const unfreeze = await wrappers.unfreezeSubscriptionForClient({
    subscriptionId: "sub-stack",
    userId: "allowed-user",
  });

  assert.deepStrictEqual(
    { ok: freeze.ok, status: freeze.status, code: freeze.code },
    { ok: false, status: 503, code: "STACKING_FREEZE_NOT_READY" }
  );
  assert.strictEqual(unfreeze.code, "STACKING_UNFREEZE_NOT_READY");
  assert.strictEqual(freeze.details.subscriptionId, "sub-stack");
}

async function testCancellationIsBlockedForClientAndSystemActors() {
  const calls = [];
  const wrappers = createUnsupportedActionWrappers(originals(calls), blockedRuntime());
  await assert.rejects(
    () => wrappers.cancelSubscriptionDomain({
      subscriptionId: "sub-stack",
      actor: { kind: "client", userId: "allowed-user" },
    }),
    (err) => Boolean(err && err.code === "STACKING_CANCELLATION_NOT_READY")
  );
  await assert.rejects(
    () => wrappers.cancelSubscriptionDomain({
      subscriptionId: "sub-stack",
      actor: { kind: "system" },
    }),
    (err) => Boolean(
      err
      && err.code === "STACKING_CANCELLATION_NOT_READY"
      && err.details.actorKind === "system"
    )
  );
  assert.strictEqual(calls.length, 0);
}

async function testOwnerMismatchDoesNotExposeAnotherUsersStack() {
  const decision = await resolveGuardDecision({
    subscriptionId: "sub-stack",
    suppliedUserId: "allowed-user",
    runtime: blockedRuntime({
      writeEnabledForUser: () => true,
      findBatchOwner: async () => ({
        userId: "different-owner",
        containerSubscriptionId: "sub-stack",
      }),
    }),
  });
  assert.strictEqual(decision.blocked, false);
  assert.strictEqual(decision.reason, "supplied_user_not_owner");
}

async function run() {
  await testGlobalDisableIsExactNoOpWithoutDatabaseRead();
  await testNonAllowlistedUserDelegatesWithoutBatchQuery();
  await testAllowlistedButNonStackedSubscriptionDelegates();
  await testSkipVariantsThrowBeforeMutation();
  await testFreezeVariantsReturnClientErrorShape();
  await testCancellationIsBlockedForClientAndSystemActors();
  await testOwnerMismatchDoesNotExposeAnotherUsersStack();
  console.log("subscription stacking unsupported action guard tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
