const mongoose = require("mongoose");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Delivery = require("../models/Delivery");
const { canTransition } = require("../utils/state");
const { writeLog } = require("../utils/log");
const { notifyUser } = require("../utils/notify");
const { getEffectiveDeliveryDetails } = require("../utils/delivery");
const { fulfillSubscriptionDay } = require("../services/fulfillmentService");

async function listDailyOrders(req, res) {
  const { date } = req.params;
  const days = await SubscriptionDay.find({ date })
    .populate({ path: "addonsOneTime", select: "name price type" })
    .populate({
      path: "subscriptionId",
      select: "addonSubscriptions userId deliveryMode deliveryAddress deliveryWindow planId"
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

    return {
      ...d,
      subscriptionAddons,
      effectiveAddress,
      effectiveWindow,
      customSalads: customSaladsSnapshot,
      kitchenAddons: [...subscriptionAddons, ...(d.addonsOneTime || [])],
    };
  });

  return res.status(200).json({ ok: true, data: enrichedDays });
}

async function assignMeals(req, res) {
  const { id, date } = req.params;
  const { selections = [], premiumSelections = [] } = req.body || {};

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).populate("planId").session(session).lean();
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
    }
    const totalSelected = selections.length + premiumSelections.length;
    if (totalSelected > sub.planId.mealsPerDay) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, error: { code: "DAILY_CAP", message: "Selections exceed meals per day" } });
    }
    const day = await SubscriptionDay.findOneAndUpdate(
      { subscriptionId: id, date },
      { selections, premiumSelections, assignedByKitchen: true },
      { upsert: true, new: true, session }
    );
    await writeLog({
      entityType: "subscription_day",
      entityId: day._id,
      action: "assign_meals",
      byUserId: req.dashboardUser ? req.dashboardUser._id : undefined,
      byRole: req.dashboardRole,
      meta: { selectionsCount: selections.length, premiumCount: premiumSelections.length },
    });

    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ ok: true, data: day });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Assignment failed" } });
  }
}

async function ensureLockedSnapshot(sub, day, session) {
  if (day.lockedSnapshot) return;
  const { address, deliveryWindow } = getEffectiveDeliveryDetails(sub, day);
  day.lockedSnapshot = {
    selections: day.selections,
    premiumSelections: day.premiumSelections,
    addonsOneTime: day.addonsOneTime,
    customSalads: day.customSalads || [],
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

async function transitionDay(req, res, toStatus) {
  const { id, date } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Day not found" } });
    }
    if (!canTransition(day.status, toStatus)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ ok: false, error: { code: "INVALID_TRANSITION", message: "Invalid state transition" } });
    }
    const sub = await Subscription.findById(id).session(session).lean();
    if (toStatus === "locked" && sub) {
      await ensureLockedSnapshot(sub, day, session);
    }
    if (toStatus === "out_for_delivery") {
      if (sub && sub.deliveryMode !== "delivery") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Not a delivery subscription" } });
      }
      if (sub) {
        const effective = day.lockedSnapshot
          ? { address: day.lockedSnapshot.address || null, deliveryWindow: day.lockedSnapshot.deliveryWindow || null }
          : getEffectiveDeliveryDetails(sub, day);
        await Delivery.updateOne(
          { dayId: day._id },
          {
            $setOnInsert: {
              subscriptionId: sub._id,
              dayId: day._id,
              address: effective.address,
              window: effective.deliveryWindow,
              status: "out_for_delivery",
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
        return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Not a pickup subscription" } });
      }
    }
    const fromStatus = day.status;
    day.status = toStatus;
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "subscription_day",
      entityId: day._id,
      action: "state_change",
      byUserId: req.dashboardUser ? req.dashboardUser._id : undefined,
      byRole: req.dashboardRole,
      meta: { from: fromStatus, to: toStatus, date: day.date },
    });
    if (toStatus === "ready_for_pickup" && sub) {
      await notifyUser(sub.userId, {
        title: "الطلب جاهز للاستلام",
        body: "طلبك أصبح جاهزًا للاستلام من المطعم",
        data: { subscriptionId: String(sub._id), date: day.date },
      });
    }
    return res.status(200).json({ ok: true, data: day });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Transition failed" } });
  }
}

async function fulfillPickup(req, res) {
  const { id, date } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await fulfillSubscriptionDay({ subscriptionId: id, date, session });
    if (!result.ok) {
      await session.abortTransaction();
      session.endSession();
      const status =
        result.code === "NOT_FOUND" ? 404 :
          result.code === "INSUFFICIENT_CREDITS" ? 400 :
            result.code === "INVALID_TRANSITION" ? 409 :
              400;
      return res.status(status).json({ ok: false, error: { code: result.code, message: result.message } });
    }

    await session.commitTransaction();
    session.endSession();
    await writeLog({
      entityType: "subscription_day",
      entityId: result.day._id,
      action: "pickup_fulfilled",
      byUserId: req.dashboardUser ? req.dashboardUser._id : undefined,
      byRole: req.dashboardRole,
      meta: { deductedCredits: result.deductedCredits, date },
    });
    return res.status(200).json({ ok: true, data: result.day, alreadyFulfilled: result.alreadyFulfilled });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Fulfillment failed" } });
  }
}

module.exports = {
  listDailyOrders,
  assignMeals,
  transitionDay,
  fulfillPickup,
};

