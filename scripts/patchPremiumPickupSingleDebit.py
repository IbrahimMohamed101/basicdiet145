from pathlib import Path

SERVICE_PATH = Path("src/services/subscription/subscriptionPickupRequestBalanceService.js")
WORKFLOW_PATH = Path(".github/workflows/subscription-entitlement-focused.yml")
TEST_PATH = Path("tests/subscriptionPremiumPickupSingleDebit.test.js")

service = SERVICE_PATH.read_text()

helper_marker = "async function claimLinkedDayAllocations"
if helper_marker not in service:
    anchor = '''function withOptionalSession(options, session) {
  return session ? { ...options, session } : options;
}

async function findPickupRequestOrThrow'''
    helpers = '''function withOptionalSession(options, session) {
  return session ? { ...options, session } : options;
}

function normalizeSlotKey(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function collectPickupSlotKeys(pickupRequest = {}) {
  const ordered = [];
  const seen = new Set();
  const add = (value) => {
    const key = normalizeSlotKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  };

  (Array.isArray(pickupRequest.selectedMealSlotIds) ? pickupRequest.selectedMealSlotIds : []).forEach(add);
  (Array.isArray(pickupRequest.selectedPickupItemIds) ? pickupRequest.selectedPickupItemIds : []).forEach(add);

  for (const item of Array.isArray(pickupRequest.selectedPickupItems) ? pickupRequest.selectedPickupItems : []) {
    if (!item || typeof item !== "object") continue;
    add(item.slotKey);
    add(item.slotId);
    if (item.source === "mealSlot") add(item.sourceId);
    if (["meal", "premium_meal", "large_salad"].includes(String(item.itemType || ""))) add(item.itemId);
  }

  const snapshotSlots = pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.mealSlots)
    ? pickupRequest.snapshot.mealSlots
    : [];
  for (const slot of snapshotSlots) {
    if (!slot || typeof slot !== "object") continue;
    add(slot.slotKey || (slot.slotIndex ? `slot_${slot.slotIndex}` : null));
  }

  return ordered;
}

async function releaseLinkedDayAllocationClaims({
  subscriptionId,
  pickupRequestId,
  allocationKeys,
  session = null,
} = {}) {
  const keys = Array.isArray(allocationKeys) ? allocationKeys.filter(Boolean) : [];
  if (!keys.length) return;
  await Subscription.updateOne(
    { _id: subscriptionId },
    { $set: { "baseMealAllocations.$[allocation].pickupRequestId": null } },
    withOptionalSession({
      arrayFilters: [{
        "allocation.allocationKey": { $in: keys },
        "allocation.pickupRequestId": pickupRequestId,
      }],
    }, session)
  );
}

async function claimLinkedDayAllocations({
  subscriptionId,
  pickupRequest,
  mealCount,
  session = null,
} = {}) {
  const linkedDayId = pickupRequest && pickupRequest.subscriptionDayId;
  if (!linkedDayId) {
    return { hasLinkedDayAllocations: false, allocationKeys: [], newlyClaimedKeys: [] };
  }

  const subscriptionQuery = Subscription.findById(subscriptionId).select("baseMealAllocations");
  if (session) subscriptionQuery.session(session);
  const subscription = await subscriptionQuery.lean();
  if (!subscription) {
    throw createServiceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  }

  const dayAllocations = (Array.isArray(subscription.baseMealAllocations) ? subscription.baseMealAllocations : [])
    .filter((allocation) => String(allocation.dayId || "") === String(linkedDayId));
  if (!dayAllocations.length) {
    return { hasLinkedDayAllocations: false, allocationKeys: [], newlyClaimedKeys: [] };
  }

  const requestedSlotKeys = collectPickupSlotKeys(pickupRequest);
  const requestedSet = new Set(requestedSlotKeys);
  const matching = requestedSet.size > 0
    ? dayAllocations.filter((allocation) => requestedSet.has(normalizeSlotKey(allocation.slotKey)))
    : dayAllocations;
  const eligible = matching.filter((allocation) => (
    allocation.state === "reserved"
      && (!allocation.pickupRequestId || String(allocation.pickupRequestId) === String(pickupRequest._id))
  ));

  const orderedEligible = requestedSlotKeys.length > 0
    ? requestedSlotKeys.flatMap((slotKey) => eligible.filter((allocation) => normalizeSlotKey(allocation.slotKey) === slotKey))
    : eligible;
  const uniqueEligible = [];
  const seen = new Set();
  for (const allocation of orderedEligible) {
    const key = String(allocation.allocationKey || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueEligible.push(allocation);
  }

  if (uniqueEligible.length < mealCount) {
    throw createServiceError(
      "MEAL_SLOT_UNAVAILABLE",
      "Linked day entitlement is not available for this pickup request",
      409
    );
  }

  const allocationKeys = [];
  const newlyClaimedKeys = [];
  for (const allocation of uniqueEligible.slice(0, mealCount)) {
    const allocationKey = String(allocation.allocationKey);
    if (allocation.pickupRequestId && String(allocation.pickupRequestId) === String(pickupRequest._id)) {
      allocationKeys.push(allocationKey);
      continue;
    }

    const updated = await Subscription.findOneAndUpdate(
      {
        _id: subscriptionId,
        baseMealAllocations: {
          $elemMatch: {
            allocationKey,
            state: "reserved",
            pickupRequestId: null,
          },
        },
      },
      { $set: { "baseMealAllocations.$[allocation].pickupRequestId": pickupRequest._id } },
      withOptionalSession({
        new: true,
        arrayFilters: [{
          "allocation.allocationKey": allocationKey,
          "allocation.state": "reserved",
          "allocation.pickupRequestId": null,
        }],
      }, session)
    ).lean();

    if (!updated) {
      const rereadQuery = Subscription.findById(subscriptionId).select("baseMealAllocations");
      if (session) rereadQuery.session(session);
      const reread = await rereadQuery.lean();
      const current = (reread && reread.baseMealAllocations || [])
        .find((entry) => String(entry.allocationKey || "") === allocationKey);
      if (current && current.state === "reserved" && String(current.pickupRequestId || "") === String(pickupRequest._id)) {
        allocationKeys.push(allocationKey);
        continue;
      }
      await releaseLinkedDayAllocationClaims({
        subscriptionId,
        pickupRequestId: pickupRequest._id,
        allocationKeys: newlyClaimedKeys,
        session,
      });
      throw createServiceError("MEAL_SLOT_UNAVAILABLE", "Linked day entitlement was claimed by another pickup request", 409);
    }

    allocationKeys.push(allocationKey);
    newlyClaimedKeys.push(allocationKey);
  }

  return { hasLinkedDayAllocations: true, allocationKeys, newlyClaimedKeys };
}

async function cleanupReservationAttempt({
  subscriptionId,
  pickupRequestId,
  newlyReservedKeys = [],
  newlyClaimedKeys = [],
  session = null,
} = {}) {
  let firstError = null;
  for (const allocationKey of newlyReservedKeys) {
    try {
      await transitionPickupEntitlements({
        subscriptionId,
        allocationKeys: [allocationKey],
        toState: "released",
        session,
      });
    } catch (err) {
      firstError = firstError || err;
    }
  }
  try {
    await releaseLinkedDayAllocationClaims({
      subscriptionId,
      pickupRequestId,
      allocationKeys: newlyClaimedKeys,
      session,
    });
  } catch (err) {
    firstError = firstError || err;
  }
  if (firstError) throw firstError;
}

async function findPickupRequestOrThrow'''
    if anchor not in service:
        raise RuntimeError("helper insertion anchor not found")
    service = service.replace(anchor, helpers, 1)

start_marker = '''  const reservation = await reservePickupEntitlements({
    subscriptionId,
    pickupRequest,
    session,
  });

  const now = new Date();'''
end_marker = '''  return {
    reserved: true,'''
if start_marker in service:
    start = service.index(start_marker)
    end = service.index(end_marker, start)
    replacement = '''  let linkedDayClaim = {
    hasLinkedDayAllocations: false,
    allocationKeys: [],
    newlyClaimedKeys: [],
  };
  let reservation;
  try {
    linkedDayClaim = await claimLinkedDayAllocations({
      subscriptionId,
      pickupRequest,
      mealCount: resolvedMealCount,
      session,
    });
    reservation = linkedDayClaim.hasLinkedDayAllocations
      ? { allocationKeys: linkedDayClaim.allocationKeys, newlyReservedKeys: [] }
      : await reservePickupEntitlements({
        subscriptionId,
        pickupRequest,
        session,
      });
  } catch (err) {
    await releaseLinkedDayAllocationClaims({
      subscriptionId,
      pickupRequestId: pickupRequest._id,
      allocationKeys: linkedDayClaim.newlyClaimedKeys,
      session,
    }).catch(() => {});
    throw err;
  }

  const now = new Date();
  let updatedPickupRequest;
  try {
    updatedPickupRequest = await SubscriptionPickupRequest.findOneAndUpdate(
      { _id: pickupRequestId, creditsReserved: { $ne: true } },
      {
        $set: {
          creditsReserved: true,
          creditsReservedAt: now,
          baseAllocationKeys: reservation.allocationKeys,
        },
      },
      withOptionalSession({ new: true }, session)
    );
  } catch (err) {
    await cleanupReservationAttempt({
      subscriptionId,
      pickupRequestId: pickupRequest._id,
      newlyReservedKeys: reservation.newlyReservedKeys,
      newlyClaimedKeys: linkedDayClaim.newlyClaimedKeys,
      session,
    }).catch(() => {});
    throw err;
  }

  if (!updatedPickupRequest) {
    const currentPickupRequest = await findPickupRequestOrThrow(pickupRequestId, session);
    const currentKeys = new Set(
      (Array.isArray(currentPickupRequest.baseAllocationKeys) ? currentPickupRequest.baseAllocationKeys : [])
        .map((key) => String(key))
    );
    const currentOwnsReservation = Boolean(currentPickupRequest.creditsReserved)
      && reservation.allocationKeys.every((key) => currentKeys.has(String(key)));
    if (!currentOwnsReservation) {
      await cleanupReservationAttempt({
        subscriptionId,
        pickupRequestId: pickupRequest._id,
        newlyReservedKeys: reservation.newlyReservedKeys,
        newlyClaimedKeys: linkedDayClaim.newlyClaimedKeys,
        session,
      });
    }
    return {
      reserved: false,
      alreadyReserved: Boolean(currentPickupRequest.creditsReserved),
      pickupRequest: currentPickupRequest,
      mealCount: resolvedMealCount,
    };
  }

'''
    service = service[:start] + replacement + service[end:]
elif "claimLinkedDayAllocations({" not in service:
    raise RuntimeError("reservation replacement anchor not found")

SERVICE_PATH.write_text(service)

TEST_PATH.write_text(r'''"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const {
  checkEntitlementInvariants,
  reserveDayEntitlements,
  transitionDayEntitlements,
} = require("../src/services/subscription/subscriptionMealEntitlementService");
const {
  consumeReservedPickupMeals,
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceService");

async function main() {
  const mongo = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongo.getUri(), { serverSelectionTimeoutMS: 10000 });
    const subscription = await Subscription.create({
      userId: new mongoose.Types.ObjectId(),
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      startDate: new Date("2026-07-19T00:00:00.000Z"),
      endDate: new Date("2026-07-26T00:00:00.000Z"),
      validityEndDate: new Date("2026-07-26T00:00:00.000Z"),
      totalMeals: 7,
      remainingMeals: 7,
      selectedGrams: 100,
      selectedMealsPerDay: 1,
      mealsPerDay: 1,
      contractMode: "canonical",
      deliveryMode: "pickup",
      pickupLocationId: "branch_1",
    });

    const day = await SubscriptionDay.create({
      subscriptionId: subscription._id,
      date: "2026-07-19",
      status: "open",
      plannerState: "draft",
      plannerRevisionHash: "premium-large-salad-revision-1",
      mealSlots: [{
        slotIndex: 1,
        slotKey: "slot_1",
        status: "complete",
        selectionType: "premium_large_salad",
        productId: new mongoose.Types.ObjectId(),
        productKey: "premium_large_salad",
        selectedOptions: [],
        salad: { presetKey: "premium_large_salad", groups: {} },
        isPremium: true,
        premiumKey: "premium_large_salad",
        premiumSource: "paid_extra",
        premiumExtraFeeHalala: 1800,
      }],
      plannerMeta: {
        requiredSlotCount: 1,
        completeSlotCount: 1,
        premiumSlotCount: 1,
        isDraftValid: true,
      },
    });

    const paymentReservation = await reserveDayEntitlements({
      subscriptionId: subscription._id,
      day,
    });
    assert.equal(paymentReservation.allocationKeys.length, 1);

    const afterPayment = await Subscription.findById(subscription._id).lean();
    assert.equal(afterPayment.remainingMeals, 6, "payment initiation reserves exactly one base meal");
    assert.equal(afterPayment.reservedMeals, 1);
    assert.equal(afterPayment.baseMealAllocations.length, 1);

    const pickupRequest = await SubscriptionPickupRequest.create({
      subscriptionId: subscription._id,
      subscriptionDayId: day._id,
      userId: subscription.userId,
      date: day.date,
      mealCount: 1,
      selectedMealSlotIds: ["slot_1"],
      selectedPickupItemIds: ["slot_1"],
      selectionMode: "slot_ids",
      status: "in_preparation",
      snapshot: { mealSlots: [{ slotIndex: 1, slotKey: "slot_1" }] },
    });

    const firstReserve = await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: 1,
    });
    assert.equal(firstReserve.reserved, true);

    const afterPickup = await Subscription.findById(subscription._id).lean();
    const persistedPickup = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
    assert.equal(afterPickup.remainingMeals, 6, "pickup request must reuse the paid day reservation instead of deducting a second meal");
    assert.equal(afterPickup.reservedMeals, 1);
    assert.equal(afterPickup.baseMealAllocations.length, 1);
    assert.deepEqual(persistedPickup.baseAllocationKeys, paymentReservation.allocationKeys);
    assert.equal(String(afterPickup.baseMealAllocations[0].pickupRequestId), String(pickupRequest._id));
    assert.equal(checkEntitlementInvariants(afterPickup).valid, true);

    const replay = await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: 1,
    });
    assert.equal(replay.alreadyReserved, true);
    const afterReplay = await Subscription.findById(subscription._id).lean();
    assert.equal(afterReplay.remainingMeals, 6);
    assert.equal(afterReplay.baseMealAllocations.length, 1);

    await consumeReservedPickupMeals({ pickupRequestId: pickupRequest._id });
    const refreshedDay = await SubscriptionDay.findById(day._id);
    await transitionDayEntitlements({
      subscriptionId: subscription._id,
      day: refreshedDay,
      toState: "consumed",
    });
    const finalSubscription = await Subscription.findById(subscription._id).lean();
    assert.equal(finalSubscription.remainingMeals, 6);
    assert.equal(finalSubscription.reservedMeals, 0);
    assert.equal(finalSubscription.consumedMeals, 1);
    assert.equal(finalSubscription.baseMealAllocations.length, 1);
    assert.equal(checkEntitlementInvariants(finalSubscription).valid, true);

    console.log("subscriptionPremiumPickupSingleDebit.test.js passed");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
''')

workflow = WORKFLOW_PATH.read_text()
path_line = '      - "tests/subscriptionPremiumPickupSingleDebit.test.js"\n'
anchor_path = '      - "tests/subscriptionPaymentInitiationReservationCleanup.test.js"\n'
if path_line not in workflow:
    workflow = workflow.replace(anchor_path, anchor_path + path_line)
run_line = '          node tests/subscriptionPremiumPickupSingleDebit.test.js\n'
anchor_run = '          node tests/subscriptionPaymentInitiationReservationCleanup.test.js\n'
if run_line not in workflow:
    workflow = workflow.replace(anchor_run, anchor_run + run_line, 1)
WORKFLOW_PATH.write_text(workflow)
