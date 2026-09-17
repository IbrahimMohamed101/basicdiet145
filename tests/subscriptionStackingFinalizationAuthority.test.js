"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const mongoose = require("mongoose");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const {
  FINALIZATION_MODES,
  FINALIZATION_ROUTES,
  buildAdditiveFinalizationIntent,
  buildStandardInitialFinalizationIntent,
  normalizeFinalizationIntent,
  resolveFinalizationAuthority,
} = require(
  "../src/services/subscription/subscriptionStackingFinalizationAuthorityService"
);

function pendingDraft(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    status: "pending_payment",
    subscriptionId: null,
    ...overrides,
  };
}

function testSchemaPersistsCheckoutTimeAuthorityWithoutAnIndexMigration() {
  const path = CheckoutDraft.schema.path("stackingFinalization");
  assert(path, "CheckoutDraft must persist stacking finalization authority");
  assert.strictEqual(
    CheckoutDraft.schema.indexes().some(([keys]) => (
      Object.prototype.hasOwnProperty.call(keys, "stackingFinalization")
    )),
    false,
    "routing authority must not require a production index rebuild"
  );
}

function testIntentBuildersAreStrict() {
  const initial = buildStandardInitialFinalizationIntent();
  assert.strictEqual(initial.mode, FINALIZATION_MODES.STANDARD_INITIAL);
  assert.strictEqual(initial.expectedParentSubscriptionId, null);

  const parentId = new mongoose.Types.ObjectId();
  const additive = buildAdditiveFinalizationIntent({
    expectedParentSubscriptionId: parentId,
  });
  assert.strictEqual(
    additive.mode,
    FINALIZATION_MODES.ADDITIVE_EXISTING_PARENT
  );
  assert.strictEqual(
    additive.expectedParentSubscriptionId,
    String(parentId)
  );
  assert.strictEqual(
    normalizeFinalizationIntent({ ...additive, mode: "unknown" }),
    null
  );
  assert.throws(
    () => buildAdditiveFinalizationIntent({
      expectedParentSubscriptionId: "not-an-object-id",
    }),
    (err) => Boolean(err && err.code === "STACKING_FINALIZATION_PARENT_REQUIRED")
  );
}

function testRoutingIsMutuallyExclusive() {
  const legacy = resolveFinalizationAuthority({
    draft: pendingDraft(),
    writeEnabled: false,
  });
  assert.strictEqual(legacy.route, FINALIZATION_ROUTES.LEGACY_STANDARD);

  assert.throws(
    () => resolveFinalizationAuthority({
      draft: pendingDraft(),
      writeEnabled: true,
    }),
    (err) => Boolean(err && err.code === "STACKING_FINALIZATION_INTENT_MISSING")
  );

  const initial = resolveFinalizationAuthority({
    draft: pendingDraft({
      stackingFinalization: buildStandardInitialFinalizationIntent(),
    }),
    writeEnabled: true,
  });
  assert.strictEqual(initial.route, FINALIZATION_ROUTES.STANDARD_INITIAL);

  const parentId = new mongoose.Types.ObjectId();
  const additiveDraft = pendingDraft({
    stackingFinalization: buildAdditiveFinalizationIntent({
      expectedParentSubscriptionId: parentId,
    }),
  });
  const additive = resolveFinalizationAuthority({
    draft: additiveDraft,
    writeEnabled: true,
  });
  assert.strictEqual(additive.route, FINALIZATION_ROUTES.STACKING_ADDITIVE);
  assert.strictEqual(additive.expectedParentSubscriptionId, String(parentId));

  assert.throws(
    () => resolveFinalizationAuthority({
      draft: additiveDraft,
      writeEnabled: false,
    }),
    (err) => Boolean(
      err && err.code === "STACKING_FINALIZATION_DISABLED_AFTER_CHECKOUT"
    )
  );
}

function testCompletedAdditiveDraftIsIdempotentOnlyForItsOriginalParent() {
  const parentId = new mongoose.Types.ObjectId();
  const intent = buildAdditiveFinalizationIntent({
    expectedParentSubscriptionId: parentId,
  });
  const authority = resolveFinalizationAuthority({
    draft: pendingDraft({
      status: "completed",
      subscriptionId: parentId,
      stackingFinalization: intent,
    }),
    writeEnabled: false,
  });
  assert.strictEqual(authority.route, FINALIZATION_ROUTES.STACKING_IDEMPOTENT);

  assert.throws(
    () => resolveFinalizationAuthority({
      draft: pendingDraft({
        status: "completed",
        subscriptionId: new mongoose.Types.ObjectId(),
        stackingFinalization: intent,
      }),
      writeEnabled: true,
    }),
    (err) => Boolean(err && err.code === "STACKING_FINALIZATION_PARENT_MISMATCH")
  );
}

function run() {
  testSchemaPersistsCheckoutTimeAuthorityWithoutAnIndexMigration();
  testIntentBuildersAreStrict();
  testRoutingIsMutuallyExclusive();
  testCompletedAdditiveDraftIsIdempotentOnlyForItsOriginalParent();
  console.log("subscription stacking finalization authority tests passed");
}

run();
