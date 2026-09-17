"use strict";

const crypto = require("node:crypto");

const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionExtraEntitlementAllocation = require(
  "../../models/SubscriptionExtraEntitlementAllocation"
);
const {
  assertTransactionalSession,
} = require("./subscriptionEntitlementLedgerService");
const {
  consumeReservedExtraEntitlementsTransactional,
  releaseReservedExtraEntitlementsTransactional,
  reserveExtraEntitlementsTransactional,
  runExtraEntitlementTransaction,
} = require("./subscriptionExtraEntitlementAllocationService");

const STATE_VERSION = "subscription_stacking.extra_selection.v1";

function lifecycleError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function text(value) {
  return String(value || "").trim();
}

function key(value) {
  return text(value).toLowerCase();
}

function id(value) {
  return text(value && value._id ? value._id : value);
}

function positiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw lifecycleError(
      "STACKING_EXTRA_SELECTION_QUANTITY_INVALID",
      `${fieldName} must be a positive integer`,
      422,
      { fieldName }
    );
  }
  return parsed;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function normalizeDesiredEntry(input = {}) {
  const kind = key(input.kind);
  if (!new Set(["premium", "addon"]).has(kind)) {
    throw lifecycleError(
      "STACKING_EXTRA_SELECTION_KIND_INVALID",
      "Extra selection kind must be premium or addon",
      422
    );
  }
  const identity = {
    premiumKey: "",
    entitlementKey: "",
    addonId: "",
    addonPlanId: "",
    category: "",
  };
  if (kind === "premium") {
    identity.premiumKey = key(input.premiumKey || input.entitlementKey);
    identity.entitlementKey = identity.premiumKey;
    if (!identity.premiumKey) {
      throw lifecycleError(
        "STACKING_EXTRA_PREMIUM_KEY_REQUIRED",
        "Premium selection requires premiumKey",
        422
      );
    }
  } else {
    identity.entitlementKey = key(input.entitlementKey);
    identity.addonId = id(input.addonId);
    identity.addonPlanId = id(input.addonPlanId);
    identity.category = key(input.category);
    if (!identity.entitlementKey || (!identity.addonId && !identity.addonPlanId)) {
      throw lifecycleError(
        "STACKING_EXTRA_ADDON_IDENTITY_REQUIRED",
        "Add-on selection requires entitlementKey and addonId or addonPlanId",
        422
      );
    }
  }
  const quantity = positiveInteger(input.quantity || 1, "quantity");
  const identityKey = stableHash({ kind, identity });
  return { kind, identity, identityKey, quantity };
}

function normalizeDesiredSelections(input = []) {
  const byIdentity = new Map();
  for (const raw of Array.isArray(input) ? input : []) {
    const entry = normalizeDesiredEntry(raw);
    const existing = byIdentity.get(entry.identityKey);
    if (existing) existing.quantity += entry.quantity;
    else byIdentity.set(entry.identityKey, entry);
  }
  return [...byIdentity.values()].sort((left, right) => (
    left.identityKey.localeCompare(right.identityKey)
  ));
}

function normalizePersistedState(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { version: STATE_VERSION, nextNonce: 1, lifecycleStatus: "reserved", entries: [] };
  }
  if (value.version !== STATE_VERSION) {
    throw lifecycleError(
      "STACKING_EXTRA_SELECTION_STATE_INVALID",
      "Persisted extra selection state version is invalid",
      409
    );
  }
  const nextNonce = positiveInteger(value.nextNonce || 1, "nextNonce");
  const entries = (Array.isArray(value.entries) ? value.entries : []).map((row) => {
    const normalized = normalizeDesiredEntry({
      kind: row.kind,
      ...(row.identity || {}),
      quantity: row.quantity,
    });
    const reservationKeys = (Array.isArray(row.reservationKeys) ? row.reservationKeys : [])
      .map(text)
      .filter(Boolean);
    if (reservationKeys.length !== normalized.quantity
      || new Set(reservationKeys).size !== reservationKeys.length
      || (row.identityKey && row.identityKey !== normalized.identityKey)) {
      throw lifecycleError(
        "STACKING_EXTRA_SELECTION_STATE_INVALID",
        "Persisted extra selection reservation state is inconsistent",
        409,
        { identityKey: normalized.identityKey }
      );
    }
    return { ...normalized, reservationKeys };
  });
  if (new Set(entries.map((row) => row.identityKey)).size !== entries.length) {
    throw lifecycleError(
      "STACKING_EXTRA_SELECTION_STATE_INVALID",
      "Persisted extra selection identities must be unique",
      409
    );
  }
  return {
    version: STATE_VERSION,
    nextNonce,
    lifecycleStatus: text(value.lifecycleStatus || "reserved"),
    entries,
  };
}

function reservationKeyFor({ dayId, identityKey, nonce }) {
  return `stack-extra:${stableHash({ dayId: id(dayId), identityKey, nonce })}`;
}

function reservationInput({ userId, containerSubscriptionId, businessDate, entry, reservationKey }) {
  return {
    userId,
    containerSubscriptionId,
    reservationKey,
    sourceKey: `subscription-day:${businessDate}`,
    businessDate,
    kind: entry.kind,
    quantity: 1,
    ...entry.identity,
  };
}

function defaultRuntime() {
  return {
    reserve: (args) => reserveExtraEntitlementsTransactional(args),
    release: (args) => releaseReservedExtraEntitlementsTransactional(args),
    consume: (args) => consumeReservedExtraEntitlementsTransactional(args),
    findAllocations({ userId, containerSubscriptionId, reservationKeys, session }) {
      return SubscriptionExtraEntitlementAllocation.find({
        userId,
        containerSubscriptionId,
        reservationKey: { $in: reservationKeys },
      }).sort({ reservationKey: 1, fundingSequence: 1 }).session(session).lean();
    },
    saveDayState({ dayId, expectedStateHash, state, session }) {
      const filter = { _id: dayId };
      if (expectedStateHash) {
        filter["stackingExtraSelectionState.stateHash"] = expectedStateHash;
      } else {
        filter.$or = [
          { stackingExtraSelectionState: { $exists: false } },
          { stackingExtraSelectionState: null },
        ];
      }
      return SubscriptionDay.findOneAndUpdate(
        filter,
        { $set: { stackingExtraSelectionState: state } },
        { new: true, session }
      );
    },
    async afterReservation() {},
    async afterDayStateSaved() {},
    async beforeConsume() {},
    async afterConsume() {},
  };
}

function runtimeWith(overrides = null) {
  return overrides && typeof overrides === "object" && !Array.isArray(overrides)
    ? { ...defaultRuntime(), ...overrides }
    : defaultRuntime();
}

function stateHashFor(state) {
  return stableHash({
    version: state.version,
    nextNonce: state.nextNonce,
    lifecycleStatus: state.lifecycleStatus,
    entries: state.entries,
  });
}

async function reconcileDayExtraSelectionsTransactional(input = {}) {
  assertTransactionalSession(input.session);
  if (!input.day || !input.day._id) {
    throw lifecycleError("STACKING_DAY_REQUIRED", "Persisted subscription day is required", 422);
  }
  const runtime = runtimeWith(input.runtime);
  const hadPersistedState = Boolean(input.day.stackingExtraSelectionState);
  const previous = normalizePersistedState(input.day.stackingExtraSelectionState);
  if (previous.lifecycleStatus !== "reserved") {
    throw lifecycleError(
      previous.lifecycleStatus === "consumed"
        ? "STACKING_EXTRA_SELECTION_ALREADY_CONSUMED"
        : "STACKING_EXTRA_SELECTION_STATE_CONFLICT",
      "Only reserved extra selections may be edited",
      409,
      { lifecycleStatus: previous.lifecycleStatus }
    );
  }
  const desired = normalizeDesiredSelections(input.desiredSelections);
  if (!hadPersistedState && desired.length === 0) {
    return {
      day: input.day,
      state: null,
      reservedCount: 0,
      releasedCount: 0,
      idempotent: true,
    };
  }
  const desiredByIdentity = new Map(desired.map((row) => [row.identityKey, row]));
  const previousByIdentity = new Map(previous.entries.map((row) => [row.identityKey, row]));
  let nextNonce = previous.nextNonce;
  const nextEntries = [];
  let reservedCount = 0;
  let releasedCount = 0;

  for (const oldEntry of previous.entries) {
    const wanted = desiredByIdentity.get(oldEntry.identityKey);
    const keepCount = Math.min(oldEntry.quantity, wanted ? wanted.quantity : 0);
    const keptKeys = oldEntry.reservationKeys.slice(0, keepCount);
    for (const reservationKey of oldEntry.reservationKeys.slice(keepCount)) {
      await runtime.release({
        userId: input.userId,
        containerSubscriptionId: input.containerSubscriptionId,
        reservationKey,
        session: input.session,
      });
      releasedCount += 1;
    }
    if (wanted && keptKeys.length) {
      nextEntries.push({ ...wanted, quantity: keptKeys.length, reservationKeys: keptKeys });
    }
  }

  for (const wanted of desired) {
    const current = previousByIdentity.get(wanted.identityKey);
    const alreadyKept = Math.min(current ? current.quantity : 0, wanted.quantity);
    let target = nextEntries.find((row) => row.identityKey === wanted.identityKey);
    if (!target) {
      target = { ...wanted, quantity: 0, reservationKeys: [] };
      nextEntries.push(target);
    }
    for (let index = alreadyKept; index < wanted.quantity; index += 1) {
      const reservationKey = reservationKeyFor({
        dayId: input.day._id,
        identityKey: wanted.identityKey,
        nonce: nextNonce,
      });
      nextNonce += 1;
      await runtime.reserve({
        ...reservationInput({
          userId: input.userId,
          containerSubscriptionId: input.containerSubscriptionId,
          businessDate: input.businessDate,
          entry: wanted,
          reservationKey,
        }),
        session: input.session,
      });
      target.reservationKeys.push(reservationKey);
      target.quantity += 1;
      reservedCount += 1;
      await runtime.afterReservation({ reservationKey, entry: wanted, session: input.session });
    }
  }

  nextEntries.sort((left, right) => left.identityKey.localeCompare(right.identityKey));
  const stateWithoutHash = {
    version: STATE_VERSION,
    nextNonce,
    lifecycleStatus: "reserved",
    entries: nextEntries,
  };
  const nextState = { ...stateWithoutHash, stateHash: stateHashFor(stateWithoutHash) };
  const savedDay = await runtime.saveDayState({
    dayId: input.day._id,
    expectedStateHash: input.day.stackingExtraSelectionState
      && input.day.stackingExtraSelectionState.stateHash,
    state: nextState,
    session: input.session,
  });
  if (!savedDay) {
    throw lifecycleError(
      "STACKING_EXTRA_SELECTION_REVISION_CONFLICT",
      "Extra selections changed concurrently",
      409
    );
  }
  await runtime.afterDayStateSaved({ day: savedDay, state: nextState, session: input.session });
  return { day: savedDay, state: nextState, reservedCount, releasedCount };
}

async function assertDayExtraReservationsTransactional(input = {}) {
  assertTransactionalSession(input.session);
  const state = normalizePersistedState(input.day && input.day.stackingExtraSelectionState);
  if (input.expectedPremiumSelections || input.expectedAddonSelections) {
    const premiumCounts = new Map();
    for (const row of Array.isArray(input.expectedPremiumSelections)
      ? input.expectedPremiumSelections
      : []) {
      const premiumKey = key(row && row.premiumKey);
      if (!premiumKey) continue;
      premiumCounts.set(
        premiumKey,
        Number(premiumCounts.get(premiumKey) || 0) + positiveInteger(row.quantity || 1, "quantity")
      );
    }
    const premiumState = state.entries.filter((row) => row.kind === "premium");
    const premiumMatches = premiumState.length === premiumCounts.size
      && premiumState.every((row) => premiumCounts.get(row.identity.premiumKey) === row.quantity);

    const addonCounts = new Map();
    for (const row of Array.isArray(input.expectedAddonSelections)
      ? input.expectedAddonSelections
      : []) {
      const addonIdentity = JSON.stringify({
        addonPlanId: id(row && row.addonPlanId),
        entitlementKey: key(row && row.entitlementKey),
        category: key(row && row.category),
      });
      addonCounts.set(
        addonIdentity,
        Number(addonCounts.get(addonIdentity) || 0) + positiveInteger(
          row && (row.quantity || row.qty) || 1,
          "quantity"
        )
      );
    }
    const addonState = state.entries.filter((row) => row.kind === "addon");
    const addonMatches = addonState.length === addonCounts.size
      && addonState.every((row) => addonCounts.get(JSON.stringify({
        addonPlanId: row.identity.addonPlanId,
        entitlementKey: row.identity.entitlementKey,
        category: row.identity.category,
      })) === row.quantity);
    if (!premiumMatches || !addonMatches) {
      throw lifecycleError(
        "STACKING_EXTRA_SELECTION_RESERVATION_MISMATCH",
        "Persisted day selections do not match their extra entitlement reservations",
        409
      );
    }
  }
  const reservationKeys = state.entries.flatMap((row) => row.reservationKeys);
  if (!reservationKeys.length) return { reservationCount: 0, state };
  const runtime = runtimeWith(input.runtime);
  const allocations = await runtime.findAllocations({
    userId: input.userId,
    containerSubscriptionId: input.containerSubscriptionId,
    reservationKeys,
    session: input.session,
  });
  const found = new Set(allocations.map((row) => text(row.reservationKey)));
  const invalid = allocations.find((row) => row.state !== "reserved");
  if (found.size !== reservationKeys.length || invalid) {
    throw lifecycleError(
      "STACKING_EXTRA_SELECTION_RESERVATION_MISMATCH",
      "Day extra selection reservation is missing or not reserved",
      409
    );
  }
  return { reservationCount: reservationKeys.length, state };
}

async function transitionDayExtrasTransactional(input = {}, toState) {
  assertTransactionalSession(input.session);
  const runtime = runtimeWith(input.runtime);
  const state = normalizePersistedState(input.day && input.day.stackingExtraSelectionState);
  if (state.lifecycleStatus === toState) {
    return { changedCount: 0, idempotent: true, state };
  }
  if (state.lifecycleStatus !== "reserved") {
    throw lifecycleError(
      "STACKING_EXTRA_SELECTION_STATE_CONFLICT",
      "Only reserved day extra selections may transition",
      409,
      { fromState: state.lifecycleStatus, toState }
    );
  }
  const reservationKeys = state.entries.flatMap((row) => row.reservationKeys);
  let changedCount = 0;
  for (const reservationKey of reservationKeys) {
    if (toState === "consumed") await runtime.beforeConsume({ reservationKey, session: input.session });
    const result = await runtime[toState === "consumed" ? "consume" : "release"]({
      userId: input.userId,
      containerSubscriptionId: input.containerSubscriptionId,
      reservationKey,
      session: input.session,
    });
    changedCount += Number(result.changedCount || 0) > 0 ? 1 : 0;
    if (toState === "consumed") await runtime.afterConsume({ reservationKey, session: input.session });
  }
  const nextWithoutHash = { ...state, lifecycleStatus: toState };
  delete nextWithoutHash.stateHash;
  const nextState = { ...nextWithoutHash, stateHash: stateHashFor(nextWithoutHash) };
  const savedDay = await runtime.saveDayState({
    dayId: input.day._id,
    expectedStateHash: input.day.stackingExtraSelectionState
      && input.day.stackingExtraSelectionState.stateHash,
    state: nextState,
    session: input.session,
  });
  if (!savedDay) {
    throw lifecycleError(
      "STACKING_EXTRA_SELECTION_REVISION_CONFLICT",
      "Day extra selection state changed concurrently",
      409
    );
  }
  return { changedCount, idempotent: false, state: nextState, day: savedDay };
}

function consumeDayExtraSelectionsTransactional(input = {}) {
  return transitionDayExtrasTransactional(input, "consumed");
}

function releaseDayExtraSelectionsTransactional(input = {}) {
  return transitionDayExtrasTransactional(input, "released");
}

async function reopenDayExtraSelectionsTransactional(input = {}) {
  assertTransactionalSession(input.session);
  if (!input.day || !input.day._id) {
    throw lifecycleError("STACKING_DAY_REQUIRED", "Persisted subscription day is required", 422);
  }
  const runtime = runtimeWith(input.runtime);
  const state = normalizePersistedState(input.day.stackingExtraSelectionState);
  if (state.lifecycleStatus === "reserved") {
    return { changedCount: 0, idempotent: true, state, day: input.day };
  }
  if (state.lifecycleStatus !== "released") {
    throw lifecycleError(
      "STACKING_EXTRA_SELECTION_STATE_CONFLICT",
      "Only released day extra selections may be reopened",
      409,
      { fromState: state.lifecycleStatus, toState: "reserved" }
    );
  }

  let nextNonce = state.nextNonce;
  let changedCount = 0;
  const nextEntries = [];
  for (const entry of state.entries) {
    const reservationKeys = [];
    for (let index = 0; index < entry.quantity; index += 1) {
      const reservationKey = reservationKeyFor({
        dayId: input.day._id,
        identityKey: entry.identityKey,
        nonce: nextNonce,
      });
      nextNonce += 1;
      await runtime.reserve({
        ...reservationInput({
          userId: input.userId,
          containerSubscriptionId: input.containerSubscriptionId,
          businessDate: input.businessDate,
          entry,
          reservationKey,
        }),
        session: input.session,
      });
      reservationKeys.push(reservationKey);
      changedCount += 1;
      await runtime.afterReservation({ reservationKey, entry, session: input.session });
    }
    nextEntries.push({ ...entry, reservationKeys });
  }

  const nextWithoutHash = {
    version: STATE_VERSION,
    nextNonce,
    lifecycleStatus: "reserved",
    entries: nextEntries,
  };
  const nextState = { ...nextWithoutHash, stateHash: stateHashFor(nextWithoutHash) };
  const savedDay = await runtime.saveDayState({
    dayId: input.day._id,
    expectedStateHash: input.day.stackingExtraSelectionState
      && input.day.stackingExtraSelectionState.stateHash,
    state: nextState,
    session: input.session,
  });
  if (!savedDay) {
    throw lifecycleError(
      "STACKING_EXTRA_SELECTION_REVISION_CONFLICT",
      "Day extra selection state changed concurrently",
      409
    );
  }
  await runtime.afterDayStateSaved({ day: savedDay, state: nextState, session: input.session });
  return { changedCount, idempotent: false, state: nextState, day: savedDay };
}

function reconcileDayExtraSelections(input = {}) {
  return runExtraEntitlementTransaction(
    (session) => reconcileDayExtraSelectionsTransactional({ ...input, session }),
    input.transactionOptions
  );
}

module.exports = {
  STATE_VERSION,
  assertDayExtraReservationsTransactional,
  consumeDayExtraSelectionsTransactional,
  normalizeDesiredSelections,
  normalizePersistedState,
  reconcileDayExtraSelections,
  reconcileDayExtraSelectionsTransactional,
  releaseDayExtraSelectionsTransactional,
  reopenDayExtraSelectionsTransactional,
};
