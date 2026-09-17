"use strict";

const FINALIZATION_AUTHORITY_VERSION =
  "subscription_stacking.finalization.v1";

const FINALIZATION_MODES = Object.freeze({
  STANDARD_INITIAL: "standard_initial",
  ADDITIVE_EXISTING_PARENT: "additive_existing_parent",
});

const FINALIZATION_ROUTES = Object.freeze({
  LEGACY_STANDARD: "legacy_standard",
  LEGACY_IDEMPOTENT: "legacy_idempotent",
  STANDARD_INITIAL: "standard_initial",
  STACKING_ADDITIVE: "stacking_additive",
  STACKING_IDEMPOTENT: "stacking_idempotent",
});

function authorityError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function stringId(value) {
  return String(value && value._id ? value._id : value || "").trim();
}

function isObjectIdString(value) {
  return /^[a-f0-9]{24}$/i.test(stringId(value));
}

function buildStandardInitialFinalizationIntent({ decidedAt = new Date() } = {}) {
  return {
    version: FINALIZATION_AUTHORITY_VERSION,
    mode: FINALIZATION_MODES.STANDARD_INITIAL,
    expectedParentSubscriptionId: null,
    decidedAt,
  };
}

function buildAdditiveFinalizationIntent({
  expectedParentSubscriptionId,
  decidedAt = new Date(),
} = {}) {
  const parentId = stringId(expectedParentSubscriptionId);
  if (!isObjectIdString(parentId)) {
    throw authorityError(
      "STACKING_FINALIZATION_PARENT_REQUIRED",
      "Additive subscription finalization requires an expected parent subscription",
      422
    );
  }
  return {
    version: FINALIZATION_AUTHORITY_VERSION,
    mode: FINALIZATION_MODES.ADDITIVE_EXISTING_PARENT,
    expectedParentSubscriptionId: parentId,
    decidedAt,
  };
}

function normalizeFinalizationIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const version = String(value.version || "").trim();
  const mode = String(value.mode || "").trim();
  if (version !== FINALIZATION_AUTHORITY_VERSION) return null;
  if (!Object.values(FINALIZATION_MODES).includes(mode)) return null;

  const expectedParentSubscriptionId = stringId(
    value.expectedParentSubscriptionId
  );
  if (
    mode === FINALIZATION_MODES.ADDITIVE_EXISTING_PARENT
    && !isObjectIdString(expectedParentSubscriptionId)
  ) {
    return null;
  }
  if (
    mode === FINALIZATION_MODES.STANDARD_INITIAL
    && expectedParentSubscriptionId
  ) {
    return null;
  }

  return {
    version,
    mode,
    expectedParentSubscriptionId:
      expectedParentSubscriptionId || null,
    decidedAt: value.decidedAt || null,
  };
}

function resolveFinalizationAuthority({ draft, writeEnabled } = {}) {
  const status = String(draft && draft.status || "").trim();
  const subscriptionId = stringId(draft && draft.subscriptionId);
  const completed = Boolean(subscriptionId) || status === "completed";
  const intent = normalizeFinalizationIntent(
    draft && draft.stackingFinalization
  );

  if (!intent) {
    if (completed) {
      return {
        route: FINALIZATION_ROUTES.LEGACY_IDEMPOTENT,
        intent: null,
        expectedParentSubscriptionId: subscriptionId || null,
      };
    }
    if (writeEnabled) {
      throw authorityError(
        "STACKING_FINALIZATION_INTENT_MISSING",
        "Stacking finalization authority is missing from the checkout draft",
        409
      );
    }
    return {
      route: FINALIZATION_ROUTES.LEGACY_STANDARD,
      intent: null,
      expectedParentSubscriptionId: null,
    };
  }

  if (intent.mode === FINALIZATION_MODES.STANDARD_INITIAL) {
    return {
      route: completed
        ? FINALIZATION_ROUTES.LEGACY_IDEMPOTENT
        : FINALIZATION_ROUTES.STANDARD_INITIAL,
      intent,
      expectedParentSubscriptionId: subscriptionId || null,
    };
  }

  const expectedParentSubscriptionId =
    intent.expectedParentSubscriptionId;
  if (completed) {
    if (!subscriptionId) {
      throw authorityError(
        "STACKING_COMPLETED_SUBSCRIPTION_MISSING",
        "Completed additive checkout is missing its parent subscription",
        409
      );
    }
    if (subscriptionId !== expectedParentSubscriptionId) {
      throw authorityError(
        "STACKING_FINALIZATION_PARENT_MISMATCH",
        "Completed additive checkout points to a different parent subscription",
        409,
        { expectedParentSubscriptionId, subscriptionId }
      );
    }
    return {
      route: FINALIZATION_ROUTES.STACKING_IDEMPOTENT,
      intent,
      expectedParentSubscriptionId,
    };
  }

  if (!writeEnabled) {
    throw authorityError(
      "STACKING_FINALIZATION_DISABLED_AFTER_CHECKOUT",
      "Additive checkout cannot be rerouted to legacy finalization after stacking is disabled",
      503,
      { expectedParentSubscriptionId }
    );
  }

  return {
    route: FINALIZATION_ROUTES.STACKING_ADDITIVE,
    intent,
    expectedParentSubscriptionId,
  };
}

module.exports = {
  FINALIZATION_AUTHORITY_VERSION,
  FINALIZATION_MODES,
  FINALIZATION_ROUTES,
  buildAdditiveFinalizationIntent,
  buildStandardInitialFinalizationIntent,
  normalizeFinalizationIntent,
  resolveFinalizationAuthority,
};
