const mongoose = require("mongoose");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Delivery = require("../models/Delivery");
const Meal = require("../models/Meal");
const { isValidKSADateString } = require("../utils/date");
const { canTransition } = require("../utils/state");
const { writeLog } = require("../utils/log");
const { notifyUser } = require("../utils/notify");
const { getEffectiveDeliveryDetails } = require("../utils/delivery");
const { resolveMealsPerDay, applyDayWalletSelections, resolveDayWalletSelections } = require("../utils/subscriptionDaySelectionSync");
const {
  sumPremiumRemainingFromBalance,
  syncPremiumRemainingFromBalance,
  ensureLegacyPremiumBalanceFromRemaining,
} = require("../utils/premiumWallet");
const { fulfillSubscriptionDay } = require("../services/fulfillmentService");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

async function listDailyOrders(req, res) {
  const { date } = req.params;
  const days = await SubscriptionDay.find({ date })
    .populate({ path: "addonsOneTime", select: "name price type" })
    .populate({
      path: "subscriptionId",
      select: "addonSubscriptions premiumSelections addonSelections userId deliveryMode deliveryAddress deliveryWindow planId selectedMealsPerDay totalMeals"
    })
    .lean();

  // Transform to include subscription add-ons explicitly if needed
  const enrichedDays = days.map(d => {
    const sub = d.subscriptionId;
    const subscriptionAddons = sub ? sub.addonSubscriptions || [] : [];
    const effectiveAddress = sub
      ? (d.deliveryAddressOverride && Object.keys(d.deliveryAddressOverride).length > 0 ? d.deliveryAddressOverride : sub.deliveryAddress)
      : null;
    const effectiveWindow = sub
      ? (d.deliveryWindowOverride || sub.deliveryWindow)
      : null;
    const customSaladsSnapshot = d.lockedSnapshot && d.lockedSnapshot.customSalads ? d.lockedSnapshot.customSalads : (d.customSalads || []);
    const customMealsSnapshot = d.lockedSnapshot && d.lockedSnapshot.customMeals ? d.lockedSnapshot.customMeals : (d.customMeals || []);
    const dayWalletSelections = resolveDayWalletSelections({ subscription: sub, day: d });
    const premiumUpgradeSelections = d.lockedSnapshot && Array.isArray(d.lockedSnapshot.premiumUpgradeSelections)
      ? d.lockedSnapshot.premiumUpgradeSelections
      : dayWalletSelections.premiumUpgradeSelections;
    const addonCreditSelections = d.lockedSnapshot && Array.isArray(d.lockedSnapshot.addonCreditSelections)
      ? d.lockedSnapshot.addonCreditSelections
      : dayWalletSelections.addonCreditSelections;

    return {
      ...d,
      subscriptionAddons,
      effectiveAddress,
      effectiveWindow,
      customSalads: customSaladsSnapshot,
      customMeals: customMealsSnapshot,
      premiumUpgradeSelections,
      addonCreditSelections,
      kitchenAddons: [...subscriptionAddons, ...(d.addonsOneTime || [])],
    };
  });

  return res.status(200).json({ ok: true, data: enrichedDays });
}

async function assignMeals(req, res) {
  const { id, date } = req.params;
  const { selections = [], premiumSelections = [] } = req.body || {};
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!Array.isArray(selections) || !Array.isArray(premiumSelections)) {
    // MEDIUM AUDIT FIX: Reject malformed payload shapes early to prevent partial writes.
    return errorResponse(res, 400, "INVALID", "selections and premiumSelections must be arrays");
  }

  const selectedMealIds = [...selections, ...premiumSelections].map((mealId) => String(mealId));
  // MEDIUM AUDIT FIX: Guard all meal ids before querying to avoid cast errors.
  try {
    selectedMealIds.forEach((mealId) => validateObjectId(mealId, "mealId"));
  } catch (err) {
    return errorResponse(res, err.status, err.code, "Invalid meal id in selections");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).populate("planId").session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    const totalSelected = selections.length + premiumSelections.length;
    const mealsPerDayLimit = resolveMealsPerDay(sub);
    if (totalSelected > mealsPerDayLimit) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "DAILY_CAP", "Selections exceed meals per day");
    }

    // MEDIUM AUDIT FIX: Ensure all referenced meals exist and are active so kitchen assignments cannot reference missing records.
    const uniqueMealIds = Array.from(new Set(selectedMealIds));
    if (uniqueMealIds.length > 0) {
      const existingMeals = await Meal.find({ _id: { $in: uniqueMealIds }, isActive: true }).select("_id type").session(session).lean();
      if (existingMeals.length !== uniqueMealIds.length) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 404, "NOT_FOUND", "One or more meals were not found");
      }
    }

    const existingDay = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    // Premium accounting uses wallet balance as the source of truth.
    const legacyUnitExtraFeeHalala =
      Number.isFinite(Number(sub.premiumPrice)) && Number(sub.premiumPrice) >= 0
        ? Math.round(Number(sub.premiumPrice) * 100)
        : 0;
    const migratedLegacyPremium = ensureLegacyPremiumBalanceFromRemaining(sub, {
      unitExtraFeeHalala: legacyUnitExtraFeeHalala,
      currency: "SAR",
    });
    if (migratedLegacyPremium) {
      syncPremiumRemainingFromBalance(sub);
      await sub.save({ session });
    }

    // MEDIUM AUDIT FIX: Enforce premium entitlement when kitchen updates day selections.
    const previousPremiumCount = existingDay ? existingDay.premiumSelections.length : 0;
    const premiumEntitlement = sumPremiumRemainingFromBalance(sub.premiumBalance || []) + previousPremiumCount;
    if (premiumSelections.length > premiumEntitlement) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INSUFFICIENT_PREMIUM", "Premium selections exceed entitlement");
    }
    // SECURITY FIX: Kitchen assignment must not overwrite non-open (locked/fulfilled/skipped) days.
    if (existingDay && existingDay.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is not open for assignment");
    }

    let day;
    if (!existingDay) {
      const created = await SubscriptionDay.create(
        [{ subscriptionId: id, date, status: "open", selections, premiumSelections, assignedByKitchen: true }],
        { session }
      );
      day = created[0];
    } else {
      day = await SubscriptionDay.findOneAndUpdate(
        { _id: existingDay._id, status: "open" },
        { $set: { selections, premiumSelections, assignedByKitchen: true } },
        { new: true, session }
      );
      if (!day) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "LOCKED", "Day is not open for assignment");
      }
    }

    await writeLog({
      entityType: "subscription_day",
      entityId: day._id,
      action: "assign_meals",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: { selectionsCount: selections.length, premiumCount: premiumSelections.length },
    });

    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ ok: true, data: day });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("kitchenController.assignMeals failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Assignment failed");
  }
}

async function ensureLockedSnapshot(sub, day, session) {
  if (day.lockedSnapshot) return;
  const { premiumUpgradeSelections, addonCreditSelections } = applyDayWalletSelections({
    subscription: sub,
    day,
  });
  const { address, deliveryWindow } = getEffectiveDeliveryDetails(sub, day);
  day.lockedSnapshot = {
    selections: day.selections,
    premiumSelections: day.premiumSelections,
    addonsOneTime: day.addonsOneTime,
    premiumUpgradeSelections,
    addonCreditSelections,
    customSalads: day.customSalads || [],
    customMeals: day.customMeals || [],
    subscriptionAddons: sub.addonSubscriptions || [],
    address,
    deliveryWindow,
    pricing: {
      planId: sub.planId,
      premiumPrice: sub.premiumPrice,
      addons: sub.addonSubscriptions,
    },
  };
  day.lockedAt = new Date();
  await day.save({ session });
}

async function bulkLockDaysByDate(req, res) {
  const { date } = req.params;
  if (!isValidKSADateString(date)) {
    return errorResponse(res, 400, "INVALID_DATE", "Invalid date");
  }

  const session = await mongoose.startSession();
  let lockedDayIds = [];
  let summary;
  try {
    session.startTransaction();

    const days = await SubscriptionDay.find({ date }).session(session);
    const totalDays = days.length;
    const openDays = days.filter((day) => day.status === "open");
    const skippedDays = days.filter((day) => day.status !== "open");
    const subscriptionIds = Array.from(new Set(openDays.map((day) => String(day.subscriptionId))));
    const subscriptions = subscriptionIds.length
      ? await Subscription.find({ _id: { $in: subscriptionIds } }).session(session).lean()
      : [];
    const subscriptionMap = new Map(subscriptions.map((sub) => [String(sub._id), sub]));

    let lockedCount = 0;
    let skippedMissingSubscriptionCount = 0;

    for (const day of openDays) {
      const sub = subscriptionMap.get(String(day.subscriptionId));
      if (!sub) {
        skippedMissingSubscriptionCount += 1;
        continue;
      }
      await ensureLockedSnapshot(sub, day, session);
      day.status = "locked";
      await day.save({ session });
      lockedCount += 1;
      lockedDayIds.push(String(day._id));
    }

    summary = {
      date,
      totalDays,
      lockedCount,
      skippedCount: skippedDays.length + skippedMissingSubscriptionCount,
      alreadyProcessedCount: skippedDays.length,
      missingSubscriptionCount: skippedMissingSubscriptionCount,
    };

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("kitchenController.bulkLockDaysByDate failed", { date, error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Bulk lock failed");
  }

  await Promise.allSettled(
    lockedDayIds.map((dayId) =>
      writeLog({
        entityType: "subscription_day",
        entityId: dayId,
        action: "bulk_lock",
        byUserId: req.userId,
        byRole: req.userRole,
        meta: { date },
      })
    )
  );

  return res.status(200).json({ ok: true, data: summary });
}

async function transitionDay(req, res, toStatus) {
  const { id, date } = req.params;
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const session = await mongoose.startSession();
  let day;
  let sub;
  let fromStatus;
  try {
    session.startTransaction();
    day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (!canTransition(day.status, toStatus)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }
    sub = await Subscription.findById(id).session(session).lean();
    if (toStatus === "locked" && sub) {
      await ensureLockedSnapshot(sub, day, session);
    }
    if (toStatus === "out_for_delivery") {
      if (sub && sub.deliveryMode !== "delivery") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 400, "INVALID", "Not a delivery subscription");
      }
      if (sub) {
        const effective = day.lockedSnapshot
          ? { address: day.lockedSnapshot.address || null, deliveryWindow: day.lockedSnapshot.deliveryWindow || null }
          : getEffectiveDeliveryDetails(sub, day);
        await Delivery.updateOne(
          { dayId: day._id },
          {
            // MEDIUM AUDIT FIX: Delivery details are mutable and must be updated on existing docs; only identity fields are insert-only.
            $set: {
              address: effective.address,
              window: effective.deliveryWindow,
              status: "out_for_delivery",
            },
            $setOnInsert: {
              subscriptionId: sub._id,
              dayId: day._id,
              orderId: null,
            },
          },
          { upsert: true, session }
        );
      }
    }
    if (toStatus === "ready_for_pickup") {
      if (sub && sub.deliveryMode !== "pickup") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 400, "INVALID", "Not a pickup subscription");
      }
    }
    fromStatus = day.status;
    day.status = toStatus;
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("kitchenController.transitionDay failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Transition failed");
  }

  // MEDIUM AUDIT FIX: Keep logs/notifications outside transaction so commit/abort lifecycle stays consistent.
  try {
    await writeLog({
      entityType: "subscription_day",
      entityId: day._id,
      action: "state_change",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: { from: fromStatus, to: toStatus, date: day.date },
    });
  } catch (err) {
    logger.error("Kitchen transition log write failed", { error: err.message, stack: err.stack, dayId: String(day._id) });
  }
  try {
    if (toStatus === "ready_for_pickup" && sub) {
      await notifyUser(sub.userId, {
        title: "الطلب جاهز للاستلام",
        body: "طلبك أصبح جاهزًا للاستلام من المطعم",
        data: { subscriptionId: String(sub._id), date: day.date },
      });
    }
  } catch (err) {
    logger.error("Kitchen transition notification failed", { error: err.message, stack: err.stack, dayId: String(day._id) });
  }
  return res.status(200).json({ ok: true, data: day });
}

async function reopenLockedDay(req, res) {
  const { id, date } = req.params;
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!isValidKSADateString(date)) {
    return errorResponse(res, 400, "INVALID_DATE", "Invalid date");
  }

  const session = await mongoose.startSession();
  let day;
  try {
    session.startTransaction();

    day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (day.status !== "locked") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Only locked days can be reopened");
    }
    if (day.pickupRequested || day.creditsDeducted) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Pickup-prepared days cannot be reopened");
    }

    await Delivery.deleteMany({ dayId: day._id }).session(session);

    day.status = "open";
    day.lockedSnapshot = undefined;
    day.lockedAt = undefined;
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("kitchenController.reopenLockedDay failed", {
      subscriptionId: id,
      date,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "Reopen failed");
  }

  try {
    await writeLog({
      entityType: "subscription_day",
      entityId: day._id,
      action: "reopen",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: { date },
    });
  } catch (err) {
    logger.error("Kitchen reopen log write failed", { error: err.message, stack: err.stack, dayId: String(day._id) });
  }

  return res.status(200).json({ ok: true, data: day });
}

async function fulfillPickup(req, res) {
  const { id, date } = req.params;
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const session = await mongoose.startSession();
  let result;
  try {
    session.startTransaction();
    const sub = await Subscription.findById(id).session(session).lean();
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    // SECURITY FIX: Pickup fulfillment endpoint must enforce pickup delivery mode.
    if (sub.deliveryMode !== "pickup") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Not a pickup subscription");
    }

    result = await fulfillSubscriptionDay({ subscriptionId: id, date, session });
    if (!result.ok) {
      await session.abortTransaction();
      session.endSession();
      const status =
        result.code === "NOT_FOUND" ? 404 :
          result.code === "INSUFFICIENT_CREDITS" ? 400 :
            result.code === "INVALID_TRANSITION" ? 409 :
              400;
      return errorResponse(res, status, result.code, result.message);
    }

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("kitchenController.fulfillPickup failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Fulfillment failed");
  }

  // MEDIUM AUDIT FIX: Keep logs outside transaction to avoid abort-after-commit failures.
  try {
    await writeLog({
      entityType: "subscription_day",
      entityId: result.day._id,
      action: "pickup_fulfilled",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: { deductedCredits: result.deductedCredits, date },
    });
  } catch (err) {
    logger.error("Kitchen pickup fulfillment log write failed", { error: err.message, stack: err.stack, dayId: String(result.day._id) });
  }
  return res.status(200).json({ ok: true, data: result.day, alreadyFulfilled: result.alreadyFulfilled });
}

module.exports = {
  listDailyOrders,
  assignMeals,
  bulkLockDaysByDate,
  transitionDay,
  reopenLockedDay,
  fulfillPickup,
};
