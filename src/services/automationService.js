const SubscriptionDay = require("../models/SubscriptionDay");
const Meal = require("../models/Meal");
const { getTomorrowKSADate } = require("../utils/date");
const { notifyUser } = require("../utils/notify");
const { writeLog } = require("../utils/log");
const { getEffectiveDeliveryDetails } = require("../utils/delivery");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../utils/subscription/subscriptionDaySelectionSync");
const { logger } = require("../utils/logger");
const { createLocalizedError } = require("../utils/errorLocalization");
const { isPhase2CanonicalDayPlanningEnabled } = require("../utils/featureFlags");
const {
    isCanonicalDayPlanningEligible,
    applyCanonicalDraftPlanningToDay,
    buildScopedCanonicalPlanningSnapshot,
    confirmCanonicalDayPlanning,
} = require("./subscription/subscriptionDayPlanningService");
const {
    isCanonicalRecurringAddonEligible,
    applyRecurringAddonProjectionToDay,
    buildScopedRecurringAddonSnapshot,
} = require("./recurringAddonService");
const { buildOneTimeAddonPlanningSnapshot } = require("./oneTimeAddonPlanningService");
const {
    isGenericPremiumWalletMode,
    refundGenericPremiumSelectionRowsOrThrow,
    syncPremiumRemainingFromActivePremiumWallet,
} = require("./genericPremiumWalletService");

let isCutoffJobRunning = false;
const CUTOFF_FALLBACK_ASSIGNMENT_SOURCE = "cutoff_fallback";
const CUTOFF_FALLBACK_ACTOR_ROLE = "system_cutoff_fallback";
const CUTOFF_LOCK_ACTOR_ROLE = "system_cutoff_lock";

function countSelectedMeals(day) {
    const baseCount = Array.isArray(day && day.selections) ? day.selections.filter(Boolean).length : 0;
    const premiumCount = Array.isArray(day && day.premiumSelections) ? day.premiumSelections.filter(Boolean).length : 0;
    return baseCount + premiumCount;
}

function hasPendingPremiumOverage(day) {
    return Number(day && day.premiumOverageCount || 0) > 0 && day.premiumOverageStatus !== "paid";
}

function hasPendingOneTimeAddonPayment(day) {
    return Number(day && day.oneTimeAddonPendingCount || 0) > 0 && day.oneTimeAddonPaymentStatus !== "paid";
}

function shouldUseCutoffFallback({ day, mealsPerDay }) {
    if (!day) return false;
    if (countSelectedMeals(day) !== mealsPerDay) {
        return true;
    }
    if (hasPendingPremiumOverage(day)) {
        return true;
    }
    if (hasPendingOneTimeAddonPayment(day)) {
        return true;
    }
    return false;
}

async function loadCutoffFallbackMeals({ mealsPerDay }) {
    const defaultMeals = await Meal.find({
        type: "regular",
        isActive: true,
        availableForSubscription: { $ne: false },
    })
        .sort({ sortOrder: 1, createdAt: -1 })
        .limit(mealsPerDay)
        .lean();

    if (defaultMeals.length !== mealsPerDay) {
        throw createLocalizedError({
            code: "SUBSCRIPTION_CUTOFF_CATALOG_SHORTAGE",
            key: "errors.subscription.cutoffCatalogShortage",
            fallbackMessage: "Not enough active subscription meals are available to auto-assign the day at cutoff",
        });
    }

    return defaultMeals;
}

function matchesSelectionDay(selection, day) {
    if (!selection || !day) return false;
    if (selection.dayId && day._id && String(selection.dayId) === String(day._id)) {
        return true;
    }
    return Boolean(selection.date && day.date && String(selection.date) === String(day.date));
}

function refundLegacyPremiumSelectionRowsToBalanceOrThrow(subscription, selections) {
    for (const selection of Array.isArray(selections) ? selections : []) {
        const match = (subscription.premiumBalance || []).find(
            (row) =>
                String(row && row.premiumMealId) === String(selection && selection.premiumMealId)
                && Number(row && row.unitExtraFeeHalala || 0) === Number(selection && selection.unitExtraFeeHalala || 0)
                && String(row && row.currency || "SAR").toUpperCase() === String(selection && selection.currency || "SAR").toUpperCase()
        );
        if (!match) {
            const err = new Error("Cannot refund premium credits because the original wallet bucket was not found");
            err.code = "DATA_INTEGRITY_ERROR";
            throw err;
        }
        const nextRemainingQty = Number(match.remainingQty || 0) + 1;
        const purchasedQty = Number(match.purchasedQty || 0);
        if (nextRemainingQty > purchasedQty) {
            const err = new Error("Cannot refund premium credits because refund exceeds purchased quantity");
            err.code = "DATA_INTEGRITY_ERROR";
            throw err;
        }
        match.remainingQty = nextRemainingQty;
    }
}

function refundAddonSelectionRowsOrThrow(subscription, selections) {
    for (const selection of Array.isArray(selections) ? selections : []) {
        const match = (subscription.addonBalance || []).find(
            (balance) =>
                String(balance && balance.addonId) === String(selection && selection.addonId)
                && Number(balance && balance.unitPriceHalala || 0) === Number(selection && selection.unitPriceHalala || 0)
        );
        if (!match) {
            const err = new Error("Cannot refund addon credits because the original wallet bucket was not found");
            err.code = "DATA_INTEGRITY_ERROR";
            throw err;
        }
        const refundQty = Number(selection && selection.qty || 0);
        const nextRemainingQty = Number(match.remainingQty || 0) + refundQty;
        const purchasedQty = Number(match.purchasedQty || 0);
        if (nextRemainingQty > purchasedQty) {
            const err = new Error("Cannot refund addon credits because refund exceeds purchased quantity");
            err.code = "DATA_INTEGRITY_ERROR";
            throw err;
        }
        match.remainingQty = nextRemainingQty;
    }
}

function refundDayWalletSelectionsOrThrow({ subscription, day }) {
    if (!subscription || !day) {
        return false;
    }

    const premiumRows = Array.isArray(subscription.premiumSelections)
        ? subscription.premiumSelections.filter((row) => matchesSelectionDay(row, day))
        : [];
    const addonRows = Array.isArray(subscription.addonSelections)
        ? subscription.addonSelections.filter((row) => matchesSelectionDay(row, day))
        : [];

    if (!premiumRows.length && !addonRows.length) {
        return false;
    }

    if (premiumRows.length) {
        if (isGenericPremiumWalletMode(subscription)) {
            refundGenericPremiumSelectionRowsOrThrow(subscription, premiumRows);
        } else {
            refundLegacyPremiumSelectionRowsToBalanceOrThrow(subscription, premiumRows);
        }
        subscription.premiumSelections = (subscription.premiumSelections || []).filter(
            (row) => !matchesSelectionDay(row, day)
        );
        syncPremiumRemainingFromActivePremiumWallet(subscription);
    }

    if (addonRows.length) {
        refundAddonSelectionRowsOrThrow(subscription, addonRows);
        subscription.addonSelections = (subscription.addonSelections || []).filter(
            (row) => !matchesSelectionDay(row, day)
        );
    }

    return true;
}

function resetDayForCutoffFallback(day) {
    day.selections = [];
    day.premiumSelections = [];
    day.premiumUpgradeSelections = [];
    day.addonCreditSelections = [];
    if (day.addonsOneTime !== undefined) {
        day.addonsOneTime = [];
    }
    if (
        day.oneTimeAddonSelections !== undefined
        || day.oneTimeAddonPendingCount !== undefined
        || day.oneTimeAddonPaymentStatus !== undefined
    ) {
        day.oneTimeAddonSelections = [];
        day.oneTimeAddonPendingCount = 0;
        day.oneTimeAddonPaymentStatus = undefined;
    }
    day.premiumOverageCount = 0;
    day.premiumOverageStatus = undefined;
}

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
	        applyDayWalletSelections({
	            subscription: sub,
	            day,
	        });
            const isCanonical = isCanonicalDayPlanningEligible(sub, {
                flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
            });
            let planningSource = "user";
            let assignmentSource = null;
            let subscriptionChanged = false;

	        if (shouldUseCutoffFallback({ day, mealsPerDay })) {
                logger.info("Automation cutoff fallback auto-assign meals", {
                    subscriptionId: String(sub._id),
                    dayId: String(day._id),
                    date: day.date,
                });

                const defaultMeals = await loadCutoffFallbackMeals({ mealsPerDay });
                subscriptionChanged = refundDayWalletSelectionsOrThrow({
                    subscription: sub,
                    day,
                }) || subscriptionChanged;
                resetDayForCutoffFallback(day);
                day.selections = defaultMeals.map((meal) => meal._id);
                day.assignedByKitchen = true;
                planningSource = "system";
                assignmentSource = CUTOFF_FALLBACK_ASSIGNMENT_SOURCE;

                if (isCanonical) {
                    applyCanonicalDraftPlanningToDay({
                        subscription: sub,
                        day,
                        selections: day.selections,
                        premiumSelections: [],
                        assignmentSource: CUTOFF_FALLBACK_ASSIGNMENT_SOURCE,
                    });
                    confirmCanonicalDayPlanning({
                        subscription: sub,
                        day,
                        actorRole: CUTOFF_FALLBACK_ACTOR_ROLE,
                    });
                }
	        } else if (isCanonical && day.planningState !== "confirmed") {
                confirmCanonicalDayPlanning({
                    subscription: sub,
                    day,
                    actorRole: CUTOFF_LOCK_ACTOR_ROLE,
                });
            }

            if (isCanonicalRecurringAddonEligible(sub)) {
                applyRecurringAddonProjectionToDay({
                    subscription: sub,
                    day,
                });
            }

            if (subscriptionChanged && typeof sub.save === "function") {
                await sub.save();
            }

	        // 3. Capture Snapshot
	        // CR-08 FIX: Always use lockedSnapshot once created - do not modify selections after lock
	        if (!day.lockedSnapshot) {
                const {
                    premiumUpgradeSelections,
                    addonCreditSelections,
                } = applyDayWalletSelections({
                    subscription: sub,
                    day,
                });
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
                planningSource,
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
                if (assignmentSource) {
                    day.lockedSnapshot.assignmentSource = assignmentSource;
                }
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
