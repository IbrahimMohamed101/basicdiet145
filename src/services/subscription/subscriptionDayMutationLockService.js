"use strict";

const crypto = require("node:crypto");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionDayMutationLock = require("../../models/SubscriptionDayMutationLock");

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

function serviceError(code, message, status = 409, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function activeLock(lock, now = new Date()) {
  return Boolean(
    lock
      && !lock.releasedAt
      && lock.leaseExpiresAt
      && new Date(lock.leaseExpiresAt).getTime() > now.getTime()
  );
}

function leaseDate(now = new Date(), leaseMs = DEFAULT_LEASE_MS) {
  return new Date(now.getTime() + Math.max(1000, Number(leaseMs || DEFAULT_LEASE_MS)));
}

async function readDay(subscriptionDayId) {
  const day = await SubscriptionDay.findById(subscriptionDayId).lean();
  if (!day) throw serviceError("DAY_NOT_FOUND", "Subscription day not found", 404);
  return day;
}

async function acquireDayMutationLock({
  subscriptionDayId,
  subscriptionId,
  date,
  ownerOperationId,
  token = null,
  expectedPlannerRevisionHash = null,
  leaseMs = DEFAULT_LEASE_MS,
} = {}) {
  if (!subscriptionDayId || !subscriptionId || !ownerOperationId) {
    throw serviceError("INVALID_ARGUMENTS", "Day mutation lock requires day, subscription, and operation IDs", 400);
  }

  const now = new Date();
  const resolvedToken = clean(token) || crypto.randomUUID();
  const day = await readDay(subscriptionDayId);
  if (clean(day.subscriptionId) !== clean(subscriptionId)) {
    throw serviceError("SUBSCRIPTION_MISMATCH", "Subscription day does not belong to subscription", 409);
  }
  if (
    expectedPlannerRevisionHash !== null
    && expectedPlannerRevisionHash !== undefined
    && clean(day.plannerRevisionHash) !== clean(expectedPlannerRevisionHash)
  ) {
    throw serviceError(
      "DAY_CHANGED",
      "The subscription day changed before the append operation acquired its mutation lock",
      409,
      {
        expectedPlannerRevisionHash: clean(expectedPlannerRevisionHash),
        currentPlannerRevisionHash: clean(day.plannerRevisionHash),
      }
    );
  }

  const current = await SubscriptionDayMutationLock.findOne({ subscriptionDayId });
  if (activeLock(current, now) && clean(current.token) !== resolvedToken) {
    throw serviceError("DAY_MUTATION_IN_PROGRESS", "Another mutation is already in progress for this day", 409, {
      ownerOperationId: clean(current.ownerOperationId),
      leaseExpiresAt: current.leaseExpiresAt,
    });
  }

  const leaseExpiresAt = leaseDate(now, leaseMs);
  const filter = current
    ? {
      _id: current._id,
      $or: [
        { token: resolvedToken },
        { releasedAt: { $ne: null } },
        { leaseExpiresAt: { $lte: now } },
      ],
    }
    : { subscriptionDayId };
  const update = {
    $set: {
      subscriptionDayId,
      subscriptionId,
      date: clean(date || day.date),
      ownerOperationId,
      token: resolvedToken,
      purpose: "delivery_append",
      basePlannerRevisionHash: clean(expectedPlannerRevisionHash || day.plannerRevisionHash),
      leaseExpiresAt,
      acquiredAt: current && clean(current.token) === resolvedToken ? current.acquiredAt || now : now,
      releasedAt: null,
    },
  };

  try {
    const lock = await SubscriptionDayMutationLock.findOneAndUpdate(
      filter,
      update,
      { new: true, upsert: !current, setDefaultsOnInsert: true }
    );
    if (!lock) {
      throw serviceError("DAY_MUTATION_IN_PROGRESS", "Another mutation acquired the day lock first", 409);
    }
    return { lock, token: resolvedToken, day };
  } catch (err) {
    if (err && err.code === 11000) {
      throw serviceError("DAY_MUTATION_IN_PROGRESS", "Another mutation acquired the day lock first", 409);
    }
    throw err;
  }
}

async function renewDayMutationLock({ subscriptionDayId, token, leaseMs = DEFAULT_LEASE_MS } = {}) {
  const now = new Date();
  const lock = await SubscriptionDayMutationLock.findOneAndUpdate(
    {
      subscriptionDayId,
      token: clean(token),
      releasedAt: null,
    },
    { $set: { leaseExpiresAt: leaseDate(now, leaseMs) } },
    { new: true }
  );
  if (!lock) {
    throw serviceError("DAY_MUTATION_LOCK_LOST", "The append operation no longer owns the day mutation lock", 409);
  }
  return lock;
}

async function releaseDayMutationLock({ subscriptionDayId, token } = {}) {
  if (!subscriptionDayId || !token) return { released: false };
  const now = new Date();
  const result = await SubscriptionDayMutationLock.updateOne(
    {
      subscriptionDayId,
      token: clean(token),
      releasedAt: null,
    },
    {
      $set: {
        releasedAt: now,
        leaseExpiresAt: now,
      },
    }
  );
  const modified = Number(result && (result.modifiedCount !== undefined ? result.modifiedCount : result.nModified) || 0);
  return { released: modified > 0 };
}

async function assertDayMutationAllowed({ subscriptionId, date, token = null } = {}) {
  if (!subscriptionId || !date) return { allowed: true };
  const day = await SubscriptionDay.findOne({ subscriptionId, date }).select("_id").lean();
  if (!day) return { allowed: true };
  const lock = await SubscriptionDayMutationLock.findOne({ subscriptionDayId: day._id }).lean();
  if (!activeLock(lock)) return { allowed: true };
  if (token && clean(lock.token) === clean(token)) return { allowed: true, lock };
  throw serviceError("DAY_MUTATION_IN_PROGRESS", "Another mutation is already in progress for this day", 409, {
    ownerOperationId: clean(lock.ownerOperationId),
    leaseExpiresAt: lock.leaseExpiresAt,
  });
}

async function ownsDayMutationLock({ subscriptionDayId, token } = {}) {
  const lock = await SubscriptionDayMutationLock.findOne({ subscriptionDayId }).lean();
  return Boolean(activeLock(lock) && clean(lock.token) === clean(token));
}

module.exports = {
  DEFAULT_LEASE_MS,
  acquireDayMutationLock,
  activeLock,
  assertDayMutationAllowed,
  ownsDayMutationLock,
  releaseDayMutationLock,
  renewDayMutationLock,
};
