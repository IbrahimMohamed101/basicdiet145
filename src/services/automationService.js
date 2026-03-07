const SubscriptionDay = require("../models/SubscriptionDay");
const Meal = require("../models/Meal");
const { getTomorrowKSADate } = require("../utils/date");
const { notifyUser } = require("../utils/notify");
const { writeLog } = require("../utils/log");
const { getEffectiveDeliveryDetails } = require("../utils/delivery");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../utils/subscriptionDaySelectionSync");
const { logger } = require("../utils/logger");

let isCutoffJobRunning = false;

async function processDailyCutoff() {
    // MEDIUM AUDIT FIX: Enforce single-run lock so overlapping manual/scheduled triggers cannot process the same cutoff twice.
    if (isCutoffJobRunning) {
        const err = new Error("Cutoff job is already running");
        err.code = "JOB_RUNNING";
        throw err;
    }
    isCutoffJobRunning = true;

    const sentNotificationKeys = new Set();
    try {
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

        const mealsPerDay = resolveMealsPerDay(sub);
        const { premiumUpgradeSelections, addonCreditSelections } = applyDayWalletSelections({
            subscription: sub,
            day,
        });

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
            premiumUpgradeSelections,
            addonCreditSelections,
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

        // MEDIUM AUDIT FIX: Deduplicate notifications within the same run to avoid double sends during repeated day hits.
        const notificationKey = `${sub._id}:${tomorrow}:cutoff_locked`;
        if (!sentNotificationKeys.has(notificationKey)) {
            await notifyUser(sub.userId, {
                title: "تم تأكيد طلبك لغدًا",
                body: "تم إقفال اختيارات الوجبات وبدء التجهيز لغدًا",
                data: { subscriptionId: String(sub._id), date: tomorrow }
            });
            sentNotificationKeys.add(notificationKey);
        }
    }

    logger.info("Automation cutoff finished", { count: openDays.length });
    } finally {
        isCutoffJobRunning = false;
    }
}

module.exports = { processDailyCutoff };
