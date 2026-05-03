const mongoose = require("mongoose");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { getTodayKSADate } = require("../utils/date");
const { logger } = require("../utils/logger");
const { consumeSubscriptionDayCredits } = require("./subscription/subscriptionDayConsumptionService");
const {
  settlePastSubscriptionDaysForRange,
} = require("./subscription/pastSubscriptionDaySettlementService");

let isCutoffJobRunning = false;

async function processDailyCutoff() {
  if (isCutoffJobRunning) {
    const err = new Error("Cutoff job is already running");
    err.code = "JOB_RUNNING";
    throw err;
  }
  isCutoffJobRunning = true;

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const today = getTodayKSADate();
    const pastSettlement = await settlePastSubscriptionDaysForRange({
      dateBefore: today,
      now: new Date(),
      actor: { actorType: "system" },
    });
    const days = await SubscriptionDay.find({
      date: today,
      status: { $nin: ["skipped", "frozen", "fulfilled", "no_show", "consumed_without_preparation"] },
      pickupRequested: { $ne: true },
      creditsDeducted: { $ne: true },
    }).session(session);

    const subscriptionIds = Array.from(new Set(days.map((day) => String(day.subscriptionId))));
    const subscriptions = subscriptionIds.length
      ? await Subscription.find({ _id: { $in: subscriptionIds }, deliveryMode: "pickup" }).session(session)
      : [];
    const subscriptionMap = new Map(subscriptions.map((sub) => [String(sub._id), sub]));

    let consumedCount = 0;
    for (const day of days) {
      const subscription = subscriptionMap.get(String(day.subscriptionId));
      if (!subscription) {
        continue;
      }
      if (["in_preparation", "ready_for_pickup"].includes(day.status)) {
        continue;
      }

      await consumeSubscriptionDayCredits({
        day,
        subscription,
        session,
        reason: "pickup_window_ended_without_prepare",
      });

      day.status = "consumed_without_preparation";
      day.dayEndConsumptionReason = "pickup_window_ended_without_prepare";
      day.pickupRequested = false;
      day.pickupCode = null;
      day.pickupCodeIssuedAt = null;
      await day.save({ session });
      consumedCount += 1;
    }

    await session.commitTransaction();
    session.endSession();

    logger.info("Automation cutoff processed pickup end-of-day consumption", {
      date: today,
      consumedCount,
      pastSettlement,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  } finally {
    isCutoffJobRunning = false;
  }
}

module.exports = { processDailyCutoff };
