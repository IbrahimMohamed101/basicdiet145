const SubscriptionDay = require("../models/SubscriptionDay");
const Meal = require("../models/Meal");
const { getTomorrowKSADate } = require("../utils/date");
const { notifyUser } = require("../utils/notify");
const { writeLog } = require("../utils/log");
const { getEffectiveDeliveryDetails } = require("../utils/delivery");
const { logger } = require("../utils/logger");

async function processDailyCutoff() {
    const tomorrow = getTomorrowKSADate();
    logger.info("Automation cutoff start", { date: tomorrow });

    // 1. Find all active subscriptions that have an "open" day for tomorrow
    // and are due for processing.
    const openDays = await SubscriptionDay.find({
        date: tomorrow,
        status: "open"
    }).populate({ path: "subscriptionId", populate: { path: "planId" } });

    for (const day of openDays) {
        const sub = day.subscriptionId;
        if (!sub || sub.status !== "active") continue;

        const mealsPerDay = sub.planId ? sub.planId.mealsPerDay : 1;

        // CR-08 FIX: Auto-assign meals if selections are empty
        // Use locked selections if available, otherwise create new
        if ((!day.selections || day.selections.length === 0) && (!day.premiumSelections || day.premiumSelections.length === 0)) {
            logger.info("Automation auto-assign meals", { subscriptionId: String(sub._id) });

            // Get some default meals (simplified logic)
            const defaultMeals = await Meal.find({ type: "regular", isActive: true }).limit(mealsPerDay).lean();
            day.selections = defaultMeals.map(m => m._id);
            day.assignedByKitchen = true;
        }

        // 3. Capture Snapshot
        // CR-08 FIX: Always use lockedSnapshot once created - do not modify selections after lock
        if (!day.lockedSnapshot) {
            const { address, deliveryWindow } = getEffectiveDeliveryDetails(sub, day);
            day.lockedSnapshot = {
            selections: day.selections,
            premiumSelections: day.premiumSelections,
            addonsOneTime: day.addonsOneTime || [],
            customSalads: day.customSalads || [],
            subscriptionAddons: sub.addonSubscriptions || [],
            address,
            deliveryWindow,
            pricing: {
                planId: sub.planId,
                premiumPrice: sub.premiumPrice,
                addons: sub.addonSubscriptions,
            },
            mealsPerDay,
        };
            day.lockedAt = new Date();
        }

        // 4. Transition to locked
        day.status = "locked";
        await day.save();

        await writeLog({
            entityType: "subscription_day",
            entityId: day._id,
            action: "auto_lock",
            byRole: "system",
            meta: { date: tomorrow }
        });

        // 5. Notify User (Optional)
        await notifyUser(sub.userId, {
            title: "تم تأكيد طلبك لغدًا",
            body: "تم إقفال اختيارات الوجبات وبدء التجهيز لغدًا",
            data: { subscriptionId: String(sub._id), date: tomorrow }
        });
    }

    logger.info("Automation cutoff finished", { count: openDays.length });
}

module.exports = { processDailyCutoff };
