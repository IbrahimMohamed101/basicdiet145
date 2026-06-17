"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const Delivery = require("../../models/Delivery");
const Payment = require("../../models/Payment");
const ActivityLog = require("../../models/ActivityLog");
const errorResponse = require("../../utils/errorResponse");

/**
 * Audit-Only Invariant Logic:
 * This controller is read-only. It performs assertions and aggregates domain states to
 * construct the audit and lifecycle logs. It does not perform or duplicate business logic mutations.
 * 
 * GET /api/dashboard/subscriptions/:subscriptionId/audit
 * Compiles a structured ledger audit checking remaining/total meals, manual deductions,
 * completed meal slots, and active/canceled pickup requests.
 */
async function getSubscriptionAudit(req, res) {
  const { subscriptionId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
    return errorResponse(res, 400, "INVALID_SUBSCRIPTION_ID", "Invalid subscriptionId");
  }

  const subscription = await Subscription.findById(subscriptionId).lean();
  if (!subscription) {
    return errorResponse(res, 404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");
  }

  const days = await SubscriptionDay.find({ subscriptionId }).lean();
  const pickupRequests = await SubscriptionPickupRequest.find({ subscriptionId }).lean();
  const dayIds = days.map((d) => d._id);

  const [deliveries, payments, manualDeductionLogs] = await Promise.all([
    Delivery.find({
      $or: [{ subscriptionId }, { dayId: { $in: dayIds } }],
    }).lean(),
    Payment.find({ subscriptionId }).lean(),
    ActivityLog.find({
      entityType: "subscription",
      entityId: subscriptionId,
      action: "manual_subscription_meal_deduction",
    }).lean(),
  ]);

  const warnings = [];

  // 1. BASE MEAL SLOTS SECTION
  const totalAllowed = subscription.totalMeals || 0;
  const remainingMeals = subscription.remainingMeals || 0;
  const usedMeals = Math.max(0, totalAllowed - remainingMeals);

  const totalPlanned = days.reduce(
    (sum, day) => sum + (Array.isArray(day.mealSlots) ? day.mealSlots.length : 0),
    0
  );

  const fulfillableDays = days.filter((d) => !["skipped", "frozen"].includes(String(d.status || "open")));
  const totalFulfillable = fulfillableDays.reduce(
    (sum, day) => sum + (Array.isArray(day.mealSlots) ? day.mealSlots.length : 0),
    0
  );

  const skippedDaysCount = days.filter((d) => d.status === "skipped").length;
  const frozenDaysCount = days.filter((d) => d.status === "frozen").length;

  for (const day of days) {
    if (["skipped", "frozen"].includes(String(day.status || "open"))) {
      const slots = Array.isArray(day.mealSlots) ? day.mealSlots.length : 0;
      if (slots > 0) {
        warnings.push(`${day.status.charAt(0).toUpperCase() + day.status.slice(1)} day on date ${day.date} has ${slots} meal slot(s) planned.`);
      }
    }
  }

  const prsActive = pickupRequests.filter((pr) => pr.status !== "canceled");
  const fulfilledPRs = prsActive.filter((pr) => pr.status === "fulfilled");
  const pickupRequestsTotalMeals = prsActive.reduce(
    (sum, pr) => sum + (pr.mealCount || 0),
    0
  );

  const manualDeductionsTotalMeals = manualDeductionLogs.reduce(
    (sum, log) => sum + (log.meta && log.meta.deductedTotalMeals ? log.meta.deductedTotalMeals : 0),
    0
  );

  const deliveredDays = days.filter((d) => d.status === "fulfilled");
  const deliveredMeals = deliveredDays.reduce(
    (sum, d) => sum + (Array.isArray(d.mealSlots) ? d.mealSlots.length : 0),
    0
  );

  const calculatedDeductions =
    (subscription.deliveryMode === "pickup" ? pickupRequestsTotalMeals : deliveredMeals) +
    manualDeductionsTotalMeals;

  const expectedRemaining = Math.max(0, totalAllowed - calculatedDeductions);
  const baseMealsCountValid = remainingMeals === expectedRemaining;
  if (!baseMealsCountValid) {
    warnings.push(`Subscription remainingMeals mismatch: ledger shows ${remainingMeals}, calculated is ${expectedRemaining}`);
  }

  const baseMealSlots = {
    totalAllowed,
    remainingMeals,
    totalPlanned,
    totalFulfillable,
    skippedDaysCount,
    frozenDaysCount,
    hasMismatch: !baseMealsCountValid,
  };

  // 2. PREMIUM UPGRADES SECTION
  const totalPremiumUpgradeSelections = subscription.premiumSelections ? subscription.premiumSelections.length : 0;

  const exceedsPlannedSlots = totalPremiumUpgradeSelections > totalFulfillable;
  if (exceedsPlannedSlots) {
    warnings.push(`Premium upgrade count (${totalPremiumUpgradeSelections}) exceeds planned meal slots (${totalFulfillable})`);
  }

  let createsExtraMeals = false;
  for (const day of days) {
    const dayMealSlots = day.mealSlots || [];
    const dayPremiumSels = day.premiumUpgradeSelections || [];
    for (const pSel of dayPremiumSels) {
      if (pSel.premiumSource && pSel.premiumSource !== "none") {
        const hasBaseSlot = dayMealSlots.some((s) => s.slotKey === pSel.baseSlotKey);
        if (!hasBaseSlot) {
          createsExtraMeals = true;
          warnings.push(`Premium upgrade on date ${day.date} for slot ${pSel.baseSlotKey} has no matching base meal slot (creates extra meals).`);
        }
      }
    }
  }

  const premiumBalanceRows = [];
  let premiumUpgradeLimitValid = !exceedsPlannedSlots;
  for (const row of (subscription.premiumBalance || [])) {
    let usedQty = 0;
    for (const day of days) {
      for (const pSel of (day.premiumUpgradeSelections || [])) {
        if (pSel.premiumKey === row.premiumKey && pSel.premiumSource === "balance") {
          usedQty++;
        }
      }
    }
    const rowValid = row.purchasedQty === row.remainingQty + usedQty;
    if (!rowValid) {
      premiumUpgradeLimitValid = false;
      warnings.push(`Premium balance mismatch for key ${row.premiumKey}: purchased=${row.purchasedQty}, used=${usedQty}, remaining=${row.remainingQty} (expected remaining: ${row.purchasedQty - usedQty})`);
    }
    premiumBalanceRows.push({
      premiumKey: row.premiumKey,
      proteinId: row.proteinId,
      purchasedQty: row.purchasedQty,
      remainingQty: row.remainingQty,
      usedQty,
      isValid: rowValid,
    });
  }

  const premiumUpgrades = {
    totalPurchased: (subscription.premiumBalance || []).reduce((sum, r) => sum + (r.purchasedQty || 0), 0),
    totalRemaining: (subscription.premiumBalance || []).reduce((sum, r) => sum + (r.remainingQty || 0), 0),
    totalConsumed: totalPremiumUpgradeSelections,
    exceedsPlannedSlots,
    createsExtraMeals,
    balanceRows: premiumBalanceRows,
  };

  // 3. ADD-ON SUBSCRIPTION ENTITLEMENTS SECTION
  const itemAddons = [];
  let addonsBalanceValid = true;
  let reappearedAfterFulfillment = false;

  // Build picked count map from fulfilled pickup requests
  const pickedAddonsMap = new Map();
  for (const pr of fulfilledPRs) {
    for (const itemId of (pr.selectedPickupItemIds || [])) {
      if (String(itemId).startsWith("addon_")) {
        const parts = String(itemId).split("_");
        const aId = parts[1];
        if (aId) {
          pickedAddonsMap.set(aId, (pickedAddonsMap.get(aId) || 0) + 1);
        }
      }
    }
  }

  for (const row of (subscription.addonBalance || [])) {
    let usedQty = 0;
    let pickedQty = 0;
    let deliveredQty = 0;

    for (const day of days) {
      const isFulfillmentActive = day.status === "fulfilled";
      const prForDay = fulfilledPRs.find((pr) => pr.date === day.date || String(pr.subscriptionDayId) === String(day._id));

      for (const addonSel of (day.addonSelections || [])) {
        if (String(addonSel.addonId) === String(row.addonId) && addonSel.source === "wallet") {
          usedQty++;
          if (isFulfillmentActive) {
            if (subscription.deliveryMode === "delivery") {
              deliveredQty++;
            } else {
              if (!prForDay) {
                pickedQty++;
              }
            }
          }
        }
      }
    }

    const prPickedQty = pickedAddonsMap.get(String(row.addonId)) || 0;
    const totalPickedQty = pickedQty + prPickedQty;
    const remainingPlannedQty = Math.max(0, usedQty - totalPickedQty - deliveredQty);

    const rowValid = row.purchasedQty === row.remainingQty + usedQty;
    if (!rowValid) {
      addonsBalanceValid = false;
      warnings.push(`Addon balance mismatch for addonId ${row.addonId}: purchased=${row.purchasedQty}, used=${usedQty}, remaining=${row.remainingQty}`);
    }

    if (row.remainingQty + usedQty > row.purchasedQty) {
      reappearedAfterFulfillment = true;
      warnings.push(`Addon ${row.addonId} has reappeared as available (remainingQty + usedQty > purchasedQty)`);
    }

    itemAddons.push({
      addonId: row.addonId,
      purchasedQty: row.purchasedQty,
      remainingQty: row.remainingQty, // Wallet balance
      usedQty,                        // Total planned/used
      pickedQty: totalPickedQty,      // Picked/consumed via pickup request
      deliveredQty,                   // Delivered via delivery doc
      remainingPlannedQty,            // Planned but not picked/delivered
      isValid: rowValid && !reappearedAfterFulfillment,
    });
  }

  const planAddons = [];
  for (const ent of (subscription.addonSubscriptions || [])) {
    let totalPlanned = 0;
    for (const day of days) {
      for (const addonSel of (day.addonSelections || [])) {
        if (addonSel.category === ent.category && addonSel.source === "subscription") {
          totalPlanned++;
        }
      }
    }
    planAddons.push({
      addonId: ent.addonId,
      category: ent.category,
      maxPerDay: ent.maxPerDay,
      totalPlanned,
    });
  }

  const addonEntitlements = {
    itemAddons,
    planAddons,
    reappearedAfterFulfillment,
  };

  // 4. PICKUP FULFILLMENT SECTION


  let pickedMealSlotsCount = 0;
  let pickedAddonsCount = 0;

  for (const pr of fulfilledPRs) {
    pickedMealSlotsCount += pr.mealCount || 0;
    const day = days.find((d) => d.date === pr.date);
    if (day) {
      const addonCount = (pr.selectedPickupItemIds || []).filter(id => String(id || "").startsWith("addon_")).length;
      pickedAddonsCount += addonCount;
      if (day.status !== "fulfilled") {
        warnings.push(`Fulfillment mismatch: Pickup request for date ${pr.date} is fulfilled, but day status is ${day.status} (picked items reappear as editable).`);
      }
    }
  }

  const pickupFulfillment = {
    totalPickupRequests: prsActive.length,
    fulfilledPickupRequests: fulfilledPRs.length,
    pickedMealSlotsCount,
    pickedAddonsCount,
  };

  // 5. DELIVERY FULFILLMENT SECTION
  const deliveryDocsActive = deliveries.filter((d) => d.status !== "canceled");
  const fulfilledDeliveries = deliveryDocsActive.filter((d) => d.status === "delivered");

  let deliveredMealSlotsCount = 0;
  let deliveredAddonsCount = 0;

  for (const del of deliveryDocsActive) {
    const day = days.find((d) => String(d._id) === String(del.dayId) || d.date === del.date);
    if (day) {
      if (del.status === "delivered") {
        deliveredMealSlotsCount += (day.mealSlots || []).length;
        deliveredAddonsCount += (day.addonSelections || []).length;
        if (day.status !== "fulfilled") {
          warnings.push(`Fulfillment mismatch: Delivery for date ${del.date} is delivered, but day status is ${day.status} (delivered items reappear as editable).`);
        }
      }
    }
  }

  const deliveryFulfillment = {
    totalDeliveries: deliveryDocsActive.length,
    fulfilledDeliveries: fulfilledDeliveries.length,
    deliveredMealSlotsCount,
    deliveredAddonsCount,
  };

  let noFulfillmentDoubleConsumption = true;
  for (const day of days) {
    const hasFulfilledPR = fulfilledPRs.some((pr) => pr.date === day.date);
    const hasDeliveredDoc = fulfilledDeliveries.some((del) => del.date === day.date || String(del.dayId) === String(day._id));
    if (hasFulfilledPR && hasDeliveredDoc) {
      noFulfillmentDoubleConsumption = false;
      warnings.push(`Double consumption: Day on date ${day.date} has both a fulfilled pickup request and a delivered delivery.`);
    }

    if (subscription.deliveryMode === "pickup" && hasDeliveredDoc) {
      noFulfillmentDoubleConsumption = false;
      warnings.push(`Double consumption: Pickup subscription has a delivered home delivery on date ${day.date}.`);
    }

    if (subscription.deliveryMode === "delivery" && hasFulfilledPR) {
      noFulfillmentDoubleConsumption = false;
      warnings.push(`Double consumption: Delivery subscription has a fulfilled branch pickup request on date ${day.date}.`);
    }
  }

  // 6. KITCHEN/OPERATIONS QUEUE LINKAGE SECTION
  const queueStatuses = ["locked", "in_preparation", "ready_for_pickup", "out_for_delivery"];
  const queueDays = days.filter((d) => queueStatuses.includes(d.status));
  const queueDetails = [];
  let kitchenQueueLinkedCorrectly = true;

  for (const qDay of queueDays) {
    if (subscription.deliveryMode === "pickup") {
      const pr = prsActive.find((r) => r.date === qDay.date);
      if (!pr) {
        kitchenQueueLinkedCorrectly = false;
        warnings.push(`Kitchen queue mismatch: Day on date ${qDay.date} is in preparation state (${qDay.status}) but has no active pickup request (missing linkage).`);
        queueDetails.push({
          date: qDay.date,
          status: qDay.status,
          linked: false,
          issue: "Missing pickup request",
        });
      } else {
        const prMealCount = pr.mealCount || 0;
        const dayMealCount = (qDay.mealSlots || []).length;

        let itemsMatch = true;
        if (prMealCount !== dayMealCount) {
          itemsMatch = false;
        }

        if (pr.selectedPickupItemIds && Array.isArray(pr.selectedPickupItemIds)) {
          const expectedItemIds = [
            ...(qDay.mealSlots || []).map((s) => String(s._id || s.slotKey)),
            ...(qDay.addonSelections || []).map((a) => String(a.addonId || a._id)),
          ];
          for (const expectedId of expectedItemIds) {
            if (!pr.selectedPickupItemIds.includes(expectedId)) {
              itemsMatch = false;
            }
          }
        }

        if (!itemsMatch) {
          kitchenQueueLinkedCorrectly = false;
          warnings.push(`Kitchen queue mismatch: Pickup request for date ${qDay.date} items do not match planned day selections (linkage mismatch).`);
        }

        queueDetails.push({
          date: qDay.date,
          status: qDay.status,
          linked: true,
          pickupRequestId: pr._id,
          itemsMatch,
        });
      }
    } else {
      const del = deliveryDocsActive.find((d) => d.date === qDay.date || String(d.dayId) === String(qDay._id));
      if (!del) {
        kitchenQueueLinkedCorrectly = false;
        warnings.push(`Kitchen queue mismatch: Day on date ${qDay.date} is in preparation state (${qDay.status}) but has no active delivery record.`);
        queueDetails.push({
          date: qDay.date,
          status: qDay.status,
          linked: false,
          issue: "Missing delivery record",
        });
      } else {
        queueDetails.push({
          date: qDay.date,
          status: qDay.status,
          linked: true,
          deliveryId: del._id,
          itemsMatch: true,
        });
      }
    }
  }

  const kitchenQueueLinkage = {
    queueLength: queueDays.length,
    isLinkedCorrectly: kitchenQueueLinkedCorrectly,
    details: queueDetails,
  };

  // 7. PAYMENTS SECTION
  const paidPayments = payments.filter((p) => p.status === "paid");
  const totalPaidAmountHalala = paidPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

  const paymentsList = payments.map((p) => ({
    paymentId: p._id,
    type: p.type,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    createdAt: p.createdAt,
  }));

  const paymentsValid = payments.every((p) => p.status === "paid" || p.status === "failed" || p.status === "initiated");

  const paymentsSection = {
    totalPaidAmountHalala,
    paymentsList,
  };

  // 8. INVARIANTS PASS/FAIL FLAGS
  const invariants = {
    baseMealsCountValid,
    premiumUpgradeLimitValid,
    premiumNoExtraMeals: !createsExtraMeals,
    addonsBalanceValid,
    noAddonDoubleConsumption: !reappearedAfterFulfillment,
    noFulfillmentDoubleConsumption,
    kitchenQueueLinkedCorrectly,
    paymentsValid,
  };

  const auditStatus = Object.values(invariants).every((v) => v === true) ? "ok" : "mismatch";

  return res.status(200).json({
    status: true,
    data: {
      subscriptionId,
      userId: String(subscription.userId),
      deliveryMode: subscription.deliveryMode,
      baseMealSlots,
      premiumUpgrades,
      addonEntitlements,
      pickupFulfillment,
      deliveryFulfillment,
      kitchenQueueLinkage,
      payments: paymentsSection,
      invariants,
      warnings,
      auditStatus,
    },
  });
}

/**
 * GET /api/dashboard/subscriptions/:subscriptionId/lifecycle
 * Compiles a chronological timeline of all events, payment attempts, edits, manual deductions, and actions.
 */
async function getSubscriptionLifecycle(req, res) {
  const { subscriptionId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
    return errorResponse(res, 400, "INVALID_SUBSCRIPTION_ID", "Invalid subscriptionId");
  }

  const subscription = await Subscription.findById(subscriptionId).lean();
  if (!subscription) {
    return errorResponse(res, 404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");
  }

  const days = await SubscriptionDay.find({ subscriptionId }).lean();
  const pickupRequests = await SubscriptionPickupRequest.find({ subscriptionId }).lean();

  const [payments, logs] = await Promise.all([
    Payment.find({ subscriptionId }).lean(),
    ActivityLog.find({
      $or: [
        { entityType: "subscription", entityId: subscriptionId },
        { entityType: "subscription_day", entityId: { $in: days.map((d) => d._id) } },
        { entityType: "subscription_pickup_request", entityId: { $in: pickupRequests.map((pr) => pr._id) } },
      ],
    }).lean(),
  ]);

  const events = [];

  events.push({
    timestamp: subscription.createdAt,
    action: "subscription_created",
    description: `Subscription created in draft (${subscription.deliveryMode} mode) with total allowed meals: ${subscription.totalMeals}`,
    actor: { id: null, role: "client" },
    metadata: { totalMeals: subscription.totalMeals, deliveryMode: subscription.deliveryMode },
  });

  for (const payment of payments) {
    events.push({
      timestamp: payment.createdAt,
      action: `payment_${payment.status}`,
      description: `Payment of type ${payment.type} for ${payment.amount / 100} ${payment.currency} is ${payment.status}`,
      actor: { id: String(payment.userId || ""), role: "system" },
      metadata: {
        paymentId: String(payment._id),
        type: payment.type,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
      },
    });
  }

  for (const log of logs) {
    let description = `${log.action} performed on ${log.entityType}`;
    if (log.action === "manual_subscription_meal_deduction") {
      const meta = log.meta || {};
      description = `Manual deduction of ${meta.deductedTotalMeals || 0} meals by ${log.byRole || "admin"} for reason: ${meta.reason || "none"}`;
    } else if (log.action === "pickup_prepare" || log.action === "prepare") {
      description = ` Fulfiller prepared the items for ${log.entityType}`;
    } else if (log.action === "pickup_ready" || log.action === "ready_for_pickup") {
      description = ` Fulfiller set state to ready for pickup`;
    } else if (log.action === "pickup_fulfill" || log.action === "fulfill") {
      description = `Fulfillment finalized`;
    }

    events.push({
      timestamp: log.createdAt,
      action: log.action,
      description,
      actor: { id: log.byUserId ? String(log.byUserId) : null, role: log.byRole || "unknown" },
      metadata: log.meta || {},
    });
  }

  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return res.status(200).json({
    status: true,
    data: {
      subscriptionId,
      status: subscription.status,
      totalMeals: subscription.totalMeals,
      remainingMeals: subscription.remainingMeals,
      events,
    },
  });
}

module.exports = {
  getSubscriptionAudit,
  getSubscriptionLifecycle,
};
