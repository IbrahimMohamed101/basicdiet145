"use strict";

const mongoose = require("mongoose");

const Subscription = require("../src/models/Subscription");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const { buildContractHash } = require("../src/services/idempotencyService");
const dateUtils = require("../src/utils/date");

const DISPLAY_ID = "SUB-2E187A";
const TARGET_START = "2026-09-20";
const EXPECTED_CURRENT_START = "2026-09-21";
const SHIFT_MS = -24 * 60 * 60 * 1000;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function ksaDate(value) {
  return value ? dateUtils.toKSADateString(new Date(value)) : null;
}

function shiftedDate(value) {
  return value ? new Date(new Date(value).getTime() + SHIFT_MS) : value;
}

function shiftedKsaDate(value) {
  return dateUtils.addDaysToKSADateString(String(value), -1);
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGO_URI/MONGODB_URI is not configured");

  await mongoose.connect(mongoUri);

  try {
    const candidates = await Subscription.find({ status: { $in: ["active", "frozen", "expired", "canceled", "completed"] } })
      .select("_id startDate endDate validityEndDate timelineExtraDays contractSnapshot contractHash")
      .lean();

    const matches = candidates.filter((row) =>
      `SUB-${String(row._id).slice(-6).toUpperCase()}` === DISPLAY_ID
    );

    if (matches.length !== 1) {
      throw new Error(`Expected exactly one subscription for ${DISPLAY_ID}; found ${matches.length}`);
    }

    const subscription = matches[0];
    const currentStart = ksaDate(subscription.startDate);
    if (currentStart !== EXPECTED_CURRENT_START) {
      console.log(JSON.stringify({
        action: "noop",
        reason: "current_start_is_not_expected_shifted_date",
        displayId: DISPLAY_ID,
        currentStart,
      }));
      return;
    }

    const currentSnapshot = clone(subscription.contractSnapshot) || {};
    const snapshotStart = currentSnapshot.start && typeof currentSnapshot.start === "object"
      ? currentSnapshot.start
      : {};
    const requestedStart = snapshotStart.requestedStartDate
      ? ksaDate(snapshotStart.requestedStartDate)
      : null;

    const newStart = new Date(`${TARGET_START}T00:00:00+03:00`);
    const newEnd = shiftedDate(subscription.endDate);
    const newValidityEnd = shiftedDate(subscription.validityEndDate || subscription.endDate);

    const nextSnapshot = clone(currentSnapshot) || {};
    nextSnapshot.start = {
      ...snapshotStart,
      requestedStartDate: TARGET_START,
      resolvedStartDate: newStart.toISOString(),
      defaultedToTomorrow: false,
      timezone: snapshotStart.timezone || "Asia/Riyadh",
    };

    const nextContractHash = buildContractHash({
      contractSnapshot: nextSnapshot,
    });

    const subscriptionUpdate = await Subscription.updateOne(
      { _id: subscription._id, startDate: subscription.startDate },
      {
        $set: {
          startDate: newStart,
          endDate: newEnd,
          validityEndDate: newValidityEnd,
          contractSnapshot: nextSnapshot,
          contractHash: nextContractHash,
        },
      }
    );

    if (subscriptionUpdate.matchedCount !== 1) {
      throw new Error("Subscription changed before repair could be applied");
    }

    const batches = await SubscriptionEntitlementBatch.find({
      containerSubscriptionId: subscription._id,
    });

    for (const batch of batches) {
      const effectiveStart = ksaDate(batch.effectiveStartDate);
      const requestedBatchStart = ksaDate(batch.requestedStartDate);
      if (effectiveStart !== EXPECTED_CURRENT_START && requestedBatchStart !== EXPECTED_CURRENT_START) {
        continue;
      }

      batch.requestedStartDate = shiftedDate(batch.requestedStartDate);
      batch.effectiveStartDate = shiftedDate(batch.effectiveStartDate);
      batch.endDate = shiftedDate(batch.endDate);
      batch.validityEndDate = shiftedDate(batch.validityEndDate);
      if (batch.baseValidityEndDate) {
        batch.baseValidityEndDate = shiftedDate(batch.baseValidityEndDate);
      }

      const batchSnapshot = clone(batch.contractSnapshot);
      if (batchSnapshot && batchSnapshot.start && batchSnapshot.start.resolvedStartDate) {
        batchSnapshot.start.resolvedStartDate =
          shiftedDate(batchSnapshot.start.resolvedStartDate).toISOString();
        batch.contractSnapshot = batchSnapshot;
      }

      await batch.save();
    }

    // Shift materialized subscription days by one day. Process newest
    // dates first so the unique (subscriptionId, date) index cannot collide
    // while moving the range backward by one day.
    const days = await SubscriptionDay.find({
      subscriptionId: subscription._id,
      date: { $gte: EXPECTED_CURRENT_START },
    }).sort({ date: -1 });

    for (const day of days) {
      day.date = shiftedKsaDate(day.date);
      await day.save();
    }

    const repaired = await Subscription.findById(subscription._id)
      .select("_id startDate endDate validityEndDate contractSnapshot contractHash")
      .lean();

    const linkedBatches = await SubscriptionEntitlementBatch.find({
      containerSubscriptionId: subscription._id,
    }).select("requestedStartDate effectiveStartDate endDate validityEndDate baseValidityEndDate").lean();

    const linkedDays = await SubscriptionDay.find({
      subscriptionId: subscription._id,
    }).select("date status").sort({ date: 1 }).lean();

    const linkedPickupRequests = await SubscriptionPickupRequest.find({
      subscriptionId: subscription._id,
    }).select("date status").sort({ date: 1 }).lean();

    console.log(JSON.stringify({
      action: "repaired",
      displayId: DISPLAY_ID,
      before: {
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        validityEndDate: subscription.validityEndDate,
      },
      after: {
        startDate: repaired.startDate,
        endDate: repaired.endDate,
        validityEndDate: repaired.validityEndDate,
        requestedStartDate: repaired.contractSnapshot?.start?.requestedStartDate || null,
        resolvedStartDate: repaired.contractSnapshot?.start?.resolvedStartDate || null,
        contractHashUpdated: repaired.contractHash !== subscription.contractHash,
      },
      businessDateCheck: {
        targetDate: TARGET_START,
        passesSubscriptionValidity:
          TARGET_START >= ksaDate(repaired.startDate)
          && TARGET_START <= ksaDate(repaired.validityEndDate || repaired.endDate),
      },
      linkedBatchDates: linkedBatches.map((batch) => ({
        requestedStartDate: ksaDate(batch.requestedStartDate),
        effectiveStartDate: ksaDate(batch.effectiveStartDate),
        endDate: ksaDate(batch.endDate),
        validityEndDate: ksaDate(batch.validityEndDate),
      })),
      linkedDayRange: linkedDays.length
        ? { first: linkedDays[0].date, last: linkedDays[linkedDays.length - 1].date, count: linkedDays.length }
        : null,
      linkedPickupRequestCount: linkedPickupRequests.length,
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
