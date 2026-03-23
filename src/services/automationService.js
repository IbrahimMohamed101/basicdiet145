const SubscriptionDay = require("../models/SubscriptionDay");
const Meal = require("../models/Meal");
const { getTomorrowKSADate } = require("../utils/date");
const { notifyUser } = require("../utils/notify");
const { writeLog } = require("../utils/log");
const { getEffectiveDeliveryDetails } = require("../utils/delivery");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../utils/subscriptionDaySelectionSync");
const { logger } = require("../utils/logger");
const { isPhase2CanonicalDayPlanningEnabled } = require("../utils/featureFlags");
const {
    isCanonicalDayPlanningEligible,
    applyCanonicalDraftPlanningToDay,
    buildScopedCanonicalPlanningSnapshot,
    confirmCanonicalDayPlanning,
} = require("./subscriptionDayPlanningService");
const {
    isCanonicalRecurringAddonEligible,
    applyRecurringAddonProjectionToDay,
    buildScopedRecurringAddonSnapshot,
} = require("./recurringAddonService");
const { buildOneTimeAddonPlanningSnapshot } = require("./oneTimeAddonPlanningService");

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

        // CR-08 FIX: Auto-assign meals if selections are empty and no other intent exists
        // Use locked selections if available, otherwise create new
        const hasMealSelections = (day.selections && day.selections.length > 0) || (day.premiumSelections && day.premiumSelections.length > 0);
        const hasOneTimeAddons = (day.oneTimeAddonSelections && day.oneTimeAddonSelections.length > 0);
        const hasPremiumWalletIntent = (day.premiumUpgradeSelections && day.premiumUpgradeSelections.length > 0);
        const hasAddonCreditIntent = (day.addonCreditSelections && day.addonCreditSelections.length > 0);
        const hasPendingOverage = (day.premiumOverageCount > 0);
        const hasPendingOneTimePayment = (day.oneTimeAddonPendingCount > 0) || (day.oneTimeAddonPaymentStatus !== undefined);

        if (!hasMealSelections && !hasOneTimeAddons && !hasPremiumWalletIntent && !hasAddonCreditIntent && !hasPendingOverage && !hasPendingOneTimePayment) {
            logger.info("Automation auto-assign meals", { subscriptionId: String(sub._id) });

            // Get some default meals (simplified logic)
            const defaultMeals = await Meal.find({ type: "regular", isActive: true }).limit(mealsPerDay).lean();
            day.selections = defaultMeals.map(m => m._id);
            day.assignedByKitchen = true;

            const isCanonical = isCanonicalDayPlanningEligible(sub, {
                flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
            });

            if (isCanonical) {
                // For canonical fallback: NO premium, NO one-time addons, NO overage
                day.premiumSelections = [];
                day.premiumUpgradeSelections = [];
                day.addonCreditSelections = [];
                day.oneTimeAddonSelections = [];
                day.oneTimeAddonPendingCount = 0;
                day.oneTimeAddonPaymentStatus = undefined;

                applyCanonicalDraftPlanningToDay({
                    subscription: sub,
                    day,
                    selections: day.selections,
                    premiumSelections: [],
                    assignmentSource: "system_auto_assign",
                });
                confirmCanonicalDayPlanning({
                    subscription: sub,
                    day,
                    actorRole: "system_auto_assign",
                });

                if (isCanonicalRecurringAddonEligible(sub)) {
                    applyRecurringAddonProjectionToDay({
                        subscription: sub,
                        day,
                    });
                }
            } else {
                // Legacy behavior
                if (isCanonicalRecurringAddonEligible(sub)) {
                    applyRecurringAddonProjectionToDay({
                        subscription: sub,
                        day,
                    });
                }
            }
        }

        // 3. Capture Snapshot
        // CR-08 FIX: Always use lockedSnapshot once created - do not modify selections after lock
        if (!day.lockedSnapshot) {
            const planningSnapshot = buildScopedCanonicalPlanningSnapshot({
                subscription: sub,
                day,
                flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
            });
            const recurringAddonSnapshot = buildScopedRecurringAddonSnapshot({
                subscription: sub,
                day,
            });
            const oneTimeAddonSnapshot = buildOneTimeAddonPlanningSnapshot({ day });
            const { address, deliveryWindow } = getEffectiveDeliveryDetails(sub, day);
            day.lockedSnapshot = {
            selections: day.selections,
            premiumSelections: day.premiumSelections,
            addonsOneTime: day.addonsOneTime || [],
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
            mealsPerDay,
        };
            if (planningSnapshot) {
                day.lockedSnapshot.planning = planningSnapshot;
            }
            if (recurringAddonSnapshot) {
                day.lockedSnapshot.recurringAddons = recurringAddonSnapshot;
            }
            if (oneTimeAddonSnapshot) {
                Object.assign(day.lockedSnapshot, oneTimeAddonSnapshot);
            }
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
