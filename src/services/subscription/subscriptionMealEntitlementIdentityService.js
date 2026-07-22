"use strict";

const crypto = require("node:crypto");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionMealReservationLock = require("../../models/SubscriptionMealReservationLock");

const RESERVATION_LOCK_LEASE_MS = 30 * 1000;
const RESERVATION_LOCK_WAIT_ATTEMPTS = 80;
const RESERVATION_LOCK_WAIT_MS = 25;
const ACTIVE_ALLOCATION_STATES = new Set(["reserved", "consumed", "forfeited"]);

function serviceError(code, message, status = 409, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_error) {
    return "";
  }
}

function plain(value) {
  if (!value || typeof value !== "object") return value || {};
  return typeof value.toObject === "function"
    ? value.toObject({ depopulate: false })
    : value;
}

function clonePlain(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function slotKeyOf(slot, index = 0) {
  return clean(slot && (slot.slotKey || (slot.slotIndex ? `slot_${slot.slotIndex}` : "")))
    || `slot_${index + 1}`;
}

function daySlotIdentity(value) {
  const dayId = clean(value && value.dayId);
  const slotKey = clean(value && value.slotKey);
  return dayId && slotKey ? `${dayId}:${slotKey}` : "";
}

function allocationIdentity(allocation) {
  return daySlotIdentity(allocation);
}

function specIdentity(spec) {
  return daySlotIdentity(spec);
}

function groupDayAllocations(allocations, dayId) {
  const groups = new Map();
  for (const allocation of Array.isArray(allocations) ? allocations : []) {
    if (clean(allocation && allocation.dayId) !== clean(dayId)) continue;
    const identity = allocationIdentity(allocation);
    if (!identity) continue;
    const rows = groups.get(identity) || [];
    rows.push(allocation);
    groups.set(identity, rows);
  }
  return groups;
}

function activeRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => ACTIVE_ALLOCATION_STATES.has(clean(row && row.state)));
}

function assertNoDuplicateActiveDayAllocations(groups, dayId) {
  const duplicates = [];
  for (const [identity, rows] of groups.entries()) {
    const active = activeRows(rows);
    if (active.length > 1) {
      duplicates.push({
        identity,
        slotKey: clean(active[0] && active[0].slotKey),
        allocationKeys: active.map((row) => clean(row && row.allocationKey)).filter(Boolean),
        states: active.map((row) => clean(row && row.state)),
      });
    }
  }
  if (duplicates.length) {
    throw serviceError(
      "DUPLICATE_DAY_SLOT_ALLOCATIONS",
      "Duplicate active meal reservations exist for the same subscription day slots",
      409,
      { dayId: clean(dayId), duplicates }
    );
  }
}

function chooseExistingAllocation(rows) {
  const active = activeRows(rows);
  if (active.length === 1) return active[0];
  const released = (Array.isArray(rows) ? rows : [])
    .filter((row) => clean(row && row.state) === "released")
    .sort((left, right) => {
      const leftTime = new Date(left && (left.releasedAt || left.reservedAt) || 0).getTime();
      const rightTime = new Date(right && (right.releasedAt || right.reservedAt) || 0).getTime();
      return rightTime - leftTime;
    });
  return released[0] || null;
}

function premiumSelectionsForSlotKeys(day, slotKeys) {
  const keys = new Set((Array.isArray(slotKeys) ? slotKeys : []).map(clean).filter(Boolean));
  return (Array.isArray(day && day.premiumUpgradeSelections) ? day.premiumUpgradeSelections : [])
    .filter((selection) => keys.has(clean(selection && (selection.baseSlotKey || selection.slotKey))));
}

function buildDeltaDay(day, missingSlotKeys) {
  const source = clonePlain(plain(day));
  const keys = new Set((Array.isArray(missingSlotKeys) ? missingSlotKeys : []).map(clean).filter(Boolean));
  source.mealSlots = (Array.isArray(source.mealSlots) ? source.mealSlots : [])
    .filter((slot, index) => keys.has(slotKeyOf(slot, index)));
  source.premiumUpgradeSelections = premiumSelectionsForSlotKeys(source, missingSlotKeys);
  return source;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockIsActive(lock, now = new Date()) {
  return Boolean(
    lock
      && !lock.releasedAt
      && lock.leaseExpiresAt
      && new Date(lock.leaseExpiresAt).getTime() > now.getTime()
  );
}

async function acquireReservationLock({ subscriptionId, day }) {
  const dayId = day && day._id;
  if (!dayId) {
    throw serviceError("DAY_ID_REQUIRED", "A persisted subscription day is required before reserving meal credits", 409);
  }
  const token = crypto.randomUUID();

  for (let attempt = 0; attempt < RESERVATION_LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + RESERVATION_LOCK_LEASE_MS);
    const current = await SubscriptionMealReservationLock.findOne({ subscriptionDayId: dayId });

    if (!current) {
      try {
        const created = await SubscriptionMealReservationLock.create({
          subscriptionDayId: dayId,
          subscriptionId,
          date: clean(day.date),
          token,
          leaseExpiresAt,
          acquiredAt: now,
          releasedAt: null,
        });
        return { lockId: created._id, token };
      } catch (error) {
        if (!error || error.code !== 11000) throw error;
      }
    } else if (!lockIsActive(current, now)) {
      const acquired = await SubscriptionMealReservationLock.findOneAndUpdate(
        {
          _id: current._id,
          $or: [
            { releasedAt: { $ne: null } },
            { leaseExpiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            subscriptionId,
            date: clean(day.date),
            token,
            leaseExpiresAt,
            acquiredAt: now,
            releasedAt: null,
          },
        },
        { new: true }
      );
      if (acquired) return { lockId: acquired._id, token };
    }

    await sleep(RESERVATION_LOCK_WAIT_MS);
  }

  throw serviceError(
    "MEAL_RESERVATION_IN_PROGRESS",
    "Another meal reservation is still being processed for this subscription day",
    409,
    { dayId: clean(dayId) }
  );
}

async function releaseReservationLock(lock) {
  if (!lock || !lock.lockId || !lock.token) return;
  const now = new Date();
  await SubscriptionMealReservationLock.updateOne(
    { _id: lock.lockId, token: lock.token, releasedAt: null },
    { $set: { releasedAt: now, leaseExpiresAt: now } }
  );
}

function createStableDayEntitlementReservationService({
  originalService,
  SubscriptionModel = Subscription,
  SubscriptionDayModel = SubscriptionDay,
} = {}) {
  if (!originalService || typeof originalService.reserveDayEntitlements !== "function") {
    throw new TypeError("originalService.reserveDayEntitlements is required");
  }
  const originalReserveDayEntitlements = originalService.reserveDayEntitlements;
  const ensureEntitlementLedger = originalService.ensureEntitlementLedger;
  const reacquireAllocation = originalService.reacquireAllocation;
  const buildDayAllocationSpecs = originalService.buildDayAllocationSpecs;

  async function reserveDayEntitlementsStable({ subscriptionId, day, paymentId = null, session = null } = {}) {
    const sourceDay = plain(day);
    if (!sourceDay || !sourceDay._id) {
      return originalReserveDayEntitlements({ subscriptionId, day, paymentId, session });
    }

    const reservationLock = await acquireReservationLock({ subscriptionId, day: sourceDay });
    try {
      const specs = buildDayAllocationSpecs({ subscriptionId, day: sourceDay, paymentId });
      const before = await ensureEntitlementLedger(subscriptionId, session);
      const groups = groupDayAllocations(before.baseMealAllocations, sourceDay._id);
      assertNoDuplicateActiveDayAllocations(groups, sourceDay._id);

      const allocationKeyByIdentity = new Map();
      const newlyReservedKeys = [];
      const missingSlotKeys = [];

      for (const spec of specs) {
        const identity = specIdentity(spec);
        const existing = chooseExistingAllocation(groups.get(identity));
        if (!existing) {
          missingSlotKeys.push(clean(spec.slotKey));
          continue;
        }

        const actualKey = clean(existing.allocationKey);
        if (!actualKey) {
          throw serviceError("DATA_INTEGRITY_ERROR", "Existing meal allocation has no allocation key", 409, {
            dayId: clean(sourceDay._id),
            slotKey: clean(spec.slotKey),
          });
        }

        if (clean(existing.state) === "released") {
          const reopened = await reacquireAllocation({
            subscriptionId,
            allocationKey: actualKey,
            session,
          });
          if (reopened && reopened.changed) newlyReservedKeys.push(actualKey);
        } else if (!ACTIVE_ALLOCATION_STATES.has(clean(existing.state))) {
          throw serviceError("DATA_INTEGRITY_ERROR", "Unsupported meal allocation state", 409, {
            allocationKey: actualKey,
            state: clean(existing.state),
          });
        }

        allocationKeyByIdentity.set(identity, actualKey);
      }

      if (missingSlotKeys.length) {
        const deltaDay = buildDeltaDay(sourceDay, missingSlotKeys);
        const deltaReservation = await originalReserveDayEntitlements({
          subscriptionId,
          day: deltaDay,
          paymentId,
          session,
        });
        for (const key of Array.isArray(deltaReservation && deltaReservation.newlyReservedKeys)
          ? deltaReservation.newlyReservedKeys
          : []) {
          if (key) newlyReservedKeys.push(clean(key));
        }
      }

      const latest = await ensureEntitlementLedger(subscriptionId, session);
      const latestGroups = groupDayAllocations(latest.baseMealAllocations, sourceDay._id);
      assertNoDuplicateActiveDayAllocations(latestGroups, sourceDay._id);

      for (const spec of specs) {
        const identity = specIdentity(spec);
        if (allocationKeyByIdentity.has(identity)) continue;
        const allocation = chooseExistingAllocation(latestGroups.get(identity));
        if (!allocation || !clean(allocation.allocationKey)) {
          throw serviceError("DATA_INTEGRITY_ERROR", "Meal slot reservation was not persisted", 409, {
            dayId: clean(sourceDay._id),
            slotKey: clean(spec.slotKey),
          });
        }
        allocationKeyByIdentity.set(identity, clean(allocation.allocationKey));
      }

      const allocationKeys = specs.map((spec) => allocationKeyByIdentity.get(specIdentity(spec))).filter(Boolean);
      if (allocationKeys.length !== specs.length) {
        throw serviceError("DATA_INTEGRITY_ERROR", "Not every meal slot resolved to one stable allocation", 409, {
          expected: specs.length,
          actual: allocationKeys.length,
          dayId: clean(sourceDay._id),
        });
      }

      await SubscriptionDayModel.updateOne(
        { _id: sourceDay._id, subscriptionId },
        {
          $set: {
            baseAllocationKeys: allocationKeys,
            entitlementTransitionState: "reserved",
          },
        },
        session ? { session } : {}
      );

      return {
        allocationKeys,
        newlyReservedKeys: [...new Set(newlyReservedKeys.filter(Boolean))],
        stableIdentity: "subscription_day_slot",
      };
    } finally {
      await releaseReservationLock(reservationLock).catch(() => {});
    }
  }

  Object.defineProperty(reserveDayEntitlementsStable, "__stableDaySlotIdentity", {
    value: true,
  });
  Object.defineProperty(reserveDayEntitlementsStable, "__original", {
    value: originalReserveDayEntitlements,
  });

  return {
    reserveDayEntitlementsStable,
  };
}

module.exports = {
  ACTIVE_ALLOCATION_STATES,
  RESERVATION_LOCK_LEASE_MS,
  RESERVATION_LOCK_WAIT_ATTEMPTS,
  RESERVATION_LOCK_WAIT_MS,
  allocationIdentity,
  assertNoDuplicateActiveDayAllocations,
  buildDeltaDay,
  createStableDayEntitlementReservationService,
  daySlotIdentity,
  groupDayAllocations,
  lockIsActive,
  specIdentity,
};
