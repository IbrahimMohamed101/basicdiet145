const { addDays, addHours } = require("date-fns");
const { formatInTimeZone } = require("date-fns-tz");
const Delivery = require("../models/Delivery");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { KSA_TIMEZONE, toKSADateString } = require("../utils/date");
const { sendUserNotificationWithDedupe } = require("./notificationService");
const { notifyOrderUser } = require("./orderNotificationService");
const { logger } = require("../utils/logger");

function hasSelectedMeals(day) {
  const materializedCount = Array.isArray(day && day.materializedMeals) ? day.materializedMeals.filter(Boolean).length : 0;
  if (materializedCount > 0) return true;

  const completeSlotCount = Array.isArray(day && day.mealSlots)
    ? day.mealSlots.filter((slot) => slot && slot.status === "complete").length
    : 0;
  if (completeSlotCount > 0) return true;

  const hasRegular = Array.isArray(day.selections) && day.selections.length > 0;
  const hasPremium = Array.isArray(day.premiumSelections) && day.premiumSelections.length > 0;
  return hasRegular || hasPremium;
}

function isProcessedDispatchStatus(status) {
  return status === "sent" || status === "no_tokens" || status === "duplicate";
}

async function processDueDeliveryArrivingSoon(now = new Date()) {
  const oneHourLater = addHours(now, 1);
  const deliveries = await Delivery.find({
    etaAt: { $gt: now, $lte: oneHourLater },
    arrivingSoonReminderSentAt: null,
    status: { $nin: ["delivered", "canceled"] },
  })
    .populate({ path: "subscriptionId", select: "userId" })
    .populate({ path: "orderId", select: "userId" })
    .lean();

  let processed = 0;
  for (const delivery of deliveries) {
    const subscription = delivery.subscriptionId;
    const order = delivery.orderId;
    let dispatch = { status: "failed" };

    if (subscription && subscription.userId) {
      dispatch = await sendUserNotificationWithDedupe({
        userId: subscription.userId,
        title: "Delivery Update",
        body: "Your order will arrive soon.",
        data: { deliveryId: String(delivery._id) },
        type: "arriving_soon_1h",
        dedupeKey: `delivery:${delivery._id}:arriving_soon_1h`,
        entityType: "delivery",
        entityId: delivery._id,
        scheduledFor: delivery.etaAt ? addHours(new Date(delivery.etaAt), -1) : null,
      });
    } else if (order && order.userId) {
      dispatch = await notifyOrderUser({
        order,
        type: "arriving_soon",
        deliveryId: delivery._id,
        scheduledFor: delivery.etaAt ? addHours(new Date(delivery.etaAt), -1) : null,
      });
    }

    if (!isProcessedDispatchStatus(dispatch.status)) continue;

    await Delivery.updateOne(
      {
        _id: delivery._id,
        arrivingSoonReminderSentAt: null,
        status: { $nin: ["delivered", "canceled"] },
      },
      { $set: { arrivingSoonReminderSentAt: now } }
    );
    processed += 1;
  }

  return { scanned: deliveries.length, processed };
}

async function processDailyMealSelectionReminders(now = new Date()) {
  const tomorrowKSA = formatInTimeZone(addDays(now, 1), KSA_TIMEZONE, "yyyy-MM-dd");
  const days = await SubscriptionDay.find({
    date: tomorrowKSA,
    status: "open",
    mealReminderSentAt: null,
  })
    .populate({ path: "subscriptionId", select: "userId status" })
    .lean();

  const usersToDayIds = new Map();
  for (const day of days) {
    const sub = day.subscriptionId;
    if (!sub || sub.status !== "active" || !sub.userId) continue;
    if (hasSelectedMeals(day)) continue;

    const key = String(sub.userId);
    if (!usersToDayIds.has(key)) {
      usersToDayIds.set(key, { userId: sub.userId, dayIds: [] });
    }
    usersToDayIds.get(key).dayIds.push(day._id);
  }

  let notifiedUsers = 0;
  for (const { userId, dayIds } of usersToDayIds.values()) {
    const dispatch = await sendUserNotificationWithDedupe({
      userId,
      title: "Meal Reminder",
      body: "Reminder: please select your meals for tomorrow before we close.",
      data: { date: tomorrowKSA },
      type: "meal_reminder",
      dedupeKey: `user:${userId}:meal_reminder:${tomorrowKSA}`,
      entityType: "subscription_day",
      scheduledFor: now,
    });

    if (!isProcessedDispatchStatus(dispatch.status)) continue;

    await SubscriptionDay.updateMany(
      { _id: { $in: dayIds }, mealReminderSentAt: null },
      { $set: { mealReminderSentAt: now } }
    );
    notifiedUsers += 1;
  }

  return { scannedDays: days.length, targetUsers: usersToDayIds.size, notifiedUsers };
}

async function processSubscriptionExpiryReminders(now = new Date()) {
  const target3d = toKSADateString(addDays(now, 3));
  const target24h = toKSADateString(addDays(now, 1));
  const activeSubs = await Subscription.find({ status: "active" })
    .select("userId endDate validityEndDate expiryReminder3dSentAt expiryReminder24hSentAt")
    .lean();

  let sent3d = 0;
  let sent24h = 0;
  for (const sub of activeSubs) {
    if (!sub.userId) continue;
    const effectiveEndDate = sub.validityEndDate || sub.endDate;
    if (!effectiveEndDate) continue;

    const endDateKSA = toKSADateString(effectiveEndDate);

    if (endDateKSA === target3d && !sub.expiryReminder3dSentAt) {
      const dispatch3d = await sendUserNotificationWithDedupe({
        userId: sub.userId,
        title: "Subscription Reminder",
        body: "Your subscription will expire in 3 days.",
        data: { subscriptionId: String(sub._id), endDate: endDateKSA },
        type: "expiry_3d",
        dedupeKey: `sub:${sub._id}:expiry_3d`,
        entityType: "subscription",
        entityId: sub._id,
        scheduledFor: now,
      });

      if (isProcessedDispatchStatus(dispatch3d.status)) {
        await Subscription.updateOne(
          { _id: sub._id, status: "active", expiryReminder3dSentAt: null },
          { $set: { expiryReminder3dSentAt: now } }
        );
        sent3d += 1;
      }
    }

    if (endDateKSA === target24h && !sub.expiryReminder24hSentAt) {
      const dispatch24h = await sendUserNotificationWithDedupe({
        userId: sub.userId,
        title: "Subscription Reminder",
        body: "Your subscription will expire tomorrow.",
        data: { subscriptionId: String(sub._id), endDate: endDateKSA },
        type: "expiry_24h",
        dedupeKey: `sub:${sub._id}:expiry_24h`,
        entityType: "subscription",
        entityId: sub._id,
        scheduledFor: now,
      });

      if (isProcessedDispatchStatus(dispatch24h.status)) {
        await Subscription.updateOne(
          { _id: sub._id, status: "active", expiryReminder24hSentAt: null },
          { $set: { expiryReminder24hSentAt: now } }
        );
        sent24h += 1;
      }
    }
  }

  logger.info("Subscription expiry reminders finished", {
    activeSubscriptions: activeSubs.length,
    sent3d,
    sent24h,
  });

  return { activeSubscriptions: activeSubs.length, sent3d, sent24h };
}

module.exports = {
  processDueDeliveryArrivingSoon,
  processDailyMealSelectionReminders,
  processSubscriptionExpiryReminders,
};
