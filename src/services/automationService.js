const SubscriptionDay = require("../models/SubscriptionDay");
const { getTomorrowKSADate } = require("../utils/date");
const { notifyUser } = require("../utils/notify");
const { writeLog } = require("../utils/log");
const { getEffectiveDeliveryDetails } = require("../utils/delivery");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../utils/subscription/subscriptionDaySelectionSync");
const { logger } = require("../utils/logger");
const { isPhase2CanonicalDayPlanningEnabled } = require("../utils/featureFlags");
const {
    isCanonicalDayPlanningEligible,
    buildScopedCanonicalPlanningSnapshot,
    confirmCanonicalDayPlanning,
} = require("./subscription/subscriptionDayPlanningService");
const {
    isCanonicalRecurringAddonEligible,
    applyRecurringAddonProjectionToDay,
    buildScopedRecurringAddonSnapshot,
} = require("./recurringAddonService");
const { buildOneTimeAddonPlanningSnapshot } = require("./oneTimeAddonPlanningService");
const Subscription = require("../models/Subscription");

let isCutoffJobRunning = false;
const CUTOFF_LOCK_ACTOR_ROLE = "system_cutoff_lock";

/**
 * Count total meal selections for a day (base + premium).
 */
function countSelectedMeals(day) {
    const baseCount = Array.isArray(day && day.selections) ? day.selections.filter(Boolean).length : 0;
    const premiumCount = Array.isArray(day && day.premiumSelections) ? day.premiumSelections.filter(Boolean).length : 0;
    return baseCount + premiumCount;
}

/**
 * Resolve the auto-lock reason code based on delivery mode and actual selected meals.
 * deliveryMode in the DB is "delivery" (courier) or "pickup".
 * Uses the real selected count (not mealsPerDay) so the log is truthful.
 */
function resolveAutoLockReason({ isPickup, day, mealsPerDay }) {
    const actualSelected = countSelectedMeals(day);
    if (actualSelected === 0) {
        return isPickup ? "pickup_auto_locked_empty" : "locked_empty_day";
    }
    if (actualSelected < mealsPerDay) {
        return isPickup ? "pickup_auto_locked_incomplete" : "locked_with_incomplete_plan";
    }
    return "auto_locked_complete";
}

async function processDailyCutoff() {
    // Enforce single-run lock so overlapping manual/scheduled triggers cannot process the same cutoff twice.
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

        // Fetch all open days for tomorrow, populating the subscription (and its plan).
        const openDays = await SubscriptionDay.find({
            date: tomorrow,
            status: "open",
        }).populate({ path: "subscriptionId", populate: { path: "planId" } });

        for (const day of openDays) {
            const sub = day.subscriptionId;
            if (!sub || sub.status !== "active") continue;

            // ── Resolve meal counts ──────────────────────────────────────────
            const mealsPerDay = resolveMealsPerDay(sub);
            applyDayWalletSelections({ subscription: sub, day });

            // Always deduct the full daily quota (mealsPerDay), regardless of
            // how many meals the user actually selected. Skipped/frozen days
            // never reach this path as the query only returns status='open' days.
            const mealsToDeduct = mealsPerDay;
            const isPickup = sub.deliveryMode === "pickup";
            const shouldDeductCredits = true;

            // ── Canonical day planning confirmation (no fallback, confirm as-is) ──
            const isCanonical = isCanonicalDayPlanningEligible(sub, {
                flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
            });

            if (isCanonical && day.planningState !== "confirmed") {
                confirmCanonicalDayPlanning({
                    subscription: sub,
                    day,
                    actorRole: CUTOFF_LOCK_ACTOR_ROLE,
                });
            }

            // ── Recurring addon projection ────────────────────────────────────
            if (isCanonicalRecurringAddonEligible(sub)) {
                applyRecurringAddonProjectionToDay({ subscription: sub, day });
            }

            // ── Build locked snapshot (only if not yet captured) ─────────────
            if (!day.lockedSnapshot) {
                const { premiumUpgradeSelections, addonCreditSelections } = applyDayWalletSelections({
                    subscription: sub,
                    day,
                });
                const planningSnapshot = buildScopedCanonicalPlanningSnapshot({
                    subscription: sub,
                    day,
                    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
                });
                const recurringAddonSnapshot = buildScopedRecurringAddonSnapshot({ subscription: sub, day });
                const oneTimeAddonSnapshot = buildOneTimeAddonPlanningSnapshot({ day });
                const { address, deliveryWindow } = getEffectiveDeliveryDetails(sub, day);

                day.lockedSnapshot = {
                    selections: day.selections,
                    premiumSelections: day.premiumSelections,
                    addonsOneTime: day.addonsOneTime || [],
                    premiumUpgradeSelections,
                    addonCreditSelections,
                    planningSource: "user",
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

            // ── Apply lock fields ─────────────────────────────────────────────
            day.status = "locked";
            day.autoLocked = true;
            day.creditsDeducted = shouldDeductCredits;
            if (isPickup) {
                // Pickup was NOT requested by user before cutoff — mark accordingly.
                day.pickupRequested = false;
            }

            await day.save();

            // ── Credit deduction (atomic, capped by remainingMeals) ───────────
            let actualDeduct = 0;
            let creditDeficit = 0;
            if (shouldDeductCredits) {
                const currentRemaining = typeof sub.remainingMeals === "number" ? sub.remainingMeals : 0;
                actualDeduct = Math.min(mealsToDeduct, currentRemaining);
                creditDeficit = mealsToDeduct - actualDeduct;

                if (actualDeduct > 0) {
                    await Subscription.findByIdAndUpdate(
                        sub._id,
                        { $inc: { remainingMeals: -actualDeduct } }
                    );
                }
            }

            // ── Structured auto-lock log ──────────────────────────────────────
            const lockReason = resolveAutoLockReason({ isPickup, day, mealsPerDay });

            await writeLog({
                entityType: "subscription_day",
                entityId: day._id,
                action: "auto_lock",
                byRole: "system",
                meta: {
                    date: tomorrow,
                    deliveryMode: sub.deliveryMode,
                    reason: lockReason,
                    mealsSelected: countSelectedMeals(day), // actual user selections
                    mealsRequired: mealsPerDay,
                    mealsDeducted: actualDeduct,            // actual amount charged
                    ...(creditDeficit > 0 && { credit_deficit: creditDeficit }),
                },
            });

            // ── User notification (deduplicated within this run) ──────────────
            const notificationKey = `${sub._id}:${tomorrow}:cutoff_locked`;
            if (!sentNotificationKeys.has(notificationKey)) {
                await notifyUser(sub.userId, {
                    title: "تم تأكيد طلبك لغدًا",
                    body: "تم إقفال اختيارات الوجبات وبدء التجهيز لغدًا",
                    data: { subscriptionId: String(sub._id), date: tomorrow },
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
