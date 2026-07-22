"use strict";

const SubscriptionPickupRequest = require("../models/SubscriptionPickupRequest");
const recoveryService = require("./subscription/subscriptionPickupRequestRecoveryService");
const {
  assertLinkedDayAllocationIntegrity,
} = require("./subscription/pickupLinkedDayIntegrityService");
const {
  repairLinkedDayAllocations,
} = require("./subscription/pickupLinkedDayAllocationRepairService");

const INSTALL_KEY = Symbol.for("basicdiet.pickupRequestRecovery.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.pickupRequestRecovery.wrapped");

async function resolveResultRequest(result) {
  if (result && result.pickupRequest && result.pickupRequest._id) return result.pickupRequest;
  const requestId = result && result.data && (result.data.requestId || result.data.id);
  return requestId ? SubscriptionPickupRequest.findById(requestId) : null;
}

function installPickupRequestRecovery() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const pickupService = require("./subscription/subscriptionPickupRequestClientService");
  const original = pickupService.createSubscriptionPickupRequestForClient;
  if (typeof original !== "function" || original[WRAPPED_KEY]) return;

  const wrapped = async function recoverablePickupCreate(args = {}) {
    // Historical subscriptions can contain an aggregate debit for a confirmed
    // day while the per-slot allocation row is missing. Materialize that debit
    // first (or reserve a genuinely new slot once), then keep the strict
    // no-standalone-fallback assertion as a fail-closed boundary.
    await repairLinkedDayAllocations({
      subscriptionId: args.subscriptionId,
      date: args.date,
      mealCount: args.mealCount,
      selectedMealSlotIds: args.selectedMealSlotIds,
      selectedPickupItemIds: args.selectedPickupItemIds,
      session: args.session || null,
    });
    await assertLinkedDayAllocationIntegrity({
      subscriptionId: args.subscriptionId,
      date: args.date,
      mealCount: args.mealCount,
      selectedMealSlotIds: args.selectedMealSlotIds,
      selectedPickupItemIds: args.selectedPickupItemIds,
      session: args.session || null,
    });

    const result = await original(args);
    const request = await resolveResultRequest(result);
    if (!request) return result;

    const recovery = await recoveryService.recoverIncompletePickupReservation({
      pickupRequestId: request._id,
      subscriptionId: args.subscriptionId || request.subscriptionId,
      session: args.session || null,
    });
    const pickupRequest = recovery.pickupRequest || request;
    const mapped = pickupService.mapSubscriptionPickupRequestStatus(
      pickupRequest,
      { idempotent: Boolean(result && result.idempotent) }
    );

    return {
      ...(result || {}),
      pickupRequest,
      data: {
        ...((result && result.data) || {}),
        ...mapped,
        reservationState: pickupRequest.reservationState || "reserved",
        reservationRecovered: Boolean(recovery.recovered),
      },
      reservationRecovered: Boolean(recovery.recovered),
      idempotent: Boolean(result && result.idempotent),
    };
  };

  wrapped[WRAPPED_KEY] = true;
  wrapped.__original = original;
  wrapped.__pickupReservationRecovery = true;
  wrapped.__linkedDayIntegrityPreflight = true;
  wrapped.__linkedDayAllocationRepair = true;
  pickupService.createSubscriptionPickupRequestForClient = wrapped;
}

installPickupRequestRecovery();

module.exports = {
  installPickupRequestRecovery,
};
