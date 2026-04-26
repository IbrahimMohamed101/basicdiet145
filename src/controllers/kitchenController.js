const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Setting = require("../models/Setting");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Delivery = require("../models/Delivery");
const Meal = require("../models/Meal");
const { isValidKSADateString, getTodayKSADate } = require("../utils/date");
const { canTransition } = require("../utils/state");
const { writeLog } = require("../utils/log");
const { notifyUser } = require("../utils/notify");
const { resolveMealsPerDay, resolveDayWalletSelections } = require("../utils/subscription/subscriptionDaySelectionSync");
const { isPhase2CanonicalDayPlanningEnabled } = require("../utils/featureFlags");
const {
  isCanonicalDayPlanningEligible,
  applyCanonicalDraftPlanningToDay,
} = require("../services/subscription/subscriptionDayPlanningService");
const { buildLockedDaySnapshot } = require("../services/subscription/subscriptionDayOperationalSnapshotService");
const { fulfillSubscriptionDay } = require("../services/fulfillmentService");
const {
  validateDayBeforeLockOrPrepare,
  resolveDayExecutionValidationErrorStatus,
} = require("../services/subscription/subscriptionDayExecutionValidationService");
const { buildSubscriptionDayFulfillmentState } = require("../services/subscription/subscriptionDayFulfillmentStateService");
const { consumeSubscriptionDayCredits } = require("../services/subscription/subscriptionDayConsumptionService");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

async function getPickupLocationsSetting() {
  const setting = await Setting.findOne({ key: "pickup_locations" }).lean();
  return Array.isArray(setting && setting.value) ? setting.value : [];
}

function generateSixDigitPickupCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function normalizePickupCode(value) {
  return String(value || "").trim();
}

function isPickupOperationalDay(day = {}) {
  return Boolean(
    day.pickupRequested
      || day.pickupPreparationStartedAt
      || day.pickupPreparedAt
      || ["in_preparation", "ready_for_pickup", "fulfilled", "no_show", "canceled_at_branch"].includes(day.status)
  );
}

function getTrackedPremiumCredits(subscription) {
  const rows = Array.isArray(subscription && subscription["premium" + "Balance"])
    ? subscription["premium" + "Balance"]
    : [];
  return rows.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row && row.remainingQty) || 0)), 0);
}

function appendOperationAudit(day, { action, actor }) {
  if (!day || !action) return;
  if (!Array.isArray(day.operationAuditLog)) {
    day.operationAuditLog = [];
  }
  day.operationAuditLog.push({
    action: String(action),
    by: String(actor || ""),
    at: new Date(),
  });
}

async function issuePickupCode(day, { session } = {}) {
  const query = {
    _id: day._id,
    status: day.status,
    $or: [
      { pickupCode: { $exists: false } },
      { pickupCode: null },
      { pickupCode: "" },
    ],
  };
  const pickupCode = generateSixDigitPickupCode();
  const updatedDay = await SubscriptionDay.findOneAndUpdate(
    query,
    {
      $set: {
        pickupCode,
        pickupCodeIssuedAt: new Date(),
        pickupVerifiedAt: null,
        pickupVerifiedByDashboardUserId: null,
        pickupNoShowAt: null,
      },
    },
    { new: true, session }
  );

  if (updatedDay) {
    return updatedDay;
  }

  const persistedDay = await SubscriptionDay.findById(day._id).session(session);
  return persistedDay || day;
}

function buildPickupQueueMeals(snapshot = null) {
  if (!snapshot || typeof snapshot !== "object") {
    return [];
  }

  const meals = [];
  const planning = snapshot.planning && typeof snapshot.planning === "object"
    ? snapshot.planning
    : null;

  if (planning && Array.isArray(planning.baseMealSlots)) {
    planning.baseMealSlots.forEach((slot) => {
      if (!slot || !slot.mealId) return;
      meals.push({
        kind: "base",
        slotKey: slot.slotKey || "",
        mealId: String(slot.mealId),
      });
    });
  } else if (Array.isArray(snapshot.selections)) {
    snapshot.selections.forEach((mealId, index) => {
      if (!mealId) return;
      meals.push({
        kind: "base",
        slotKey: `base_slot_${index + 1}`,
        mealId: String(mealId),
      });
    });
  }

  if (Array.isArray(snapshot.premiumSelections)) {
    snapshot.premiumSelections.forEach((mealId, index) => {
      if (!mealId) return;
      meals.push({
        kind: "premium",
        slotKey: `premium_slot_${index + 1}`,
        mealId: String(mealId),
      });
    });
  }

  return meals;
}

function buildPickupQueueRow(day) {
  const snapshot = day.lockedSnapshot || day.fulfilledSnapshot || null;
  if (!snapshot) return null;

  return {
    subscriptionDayId: String(day._id),
    customerName: String(snapshot.customerName || snapshot.customerPhone || ""),
    meals: buildPickupQueueMeals(snapshot),
    status: String(day.status || ""),
    pickupWindow: snapshot.deliveryWindow || null,
    isReady: day.status === "ready_for_pickup",
    pickupCode: day.status === "ready_for_pickup" ? normalizePickupCode(day.pickupCode) || null : null,
    verified: Boolean(day.pickupVerifiedAt),
    pickupLocationId: snapshot.pickupLocationId || null,
    pickupLocationName: snapshot.pickupLocationName || "",
    pickupAddress: snapshot.pickupAddress || null,
    verifiedAt: day.pickupVerifiedAt || null,
  };
}

function resolvePickupQueueStatusOrder(status) {
  switch (status) {
    case "ready_for_pickup":
      return 0;
    case "in_preparation":
      return 1;
    case "locked":
      return 2;
    case "fulfilled":
      return 3;
    case "no_show":
      return 4;
    case "canceled_at_branch":
      return 5;
    default:
      return 99;
  }
}

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
    const fulfillmentState = buildSubscriptionDayFulfillmentState({
      subscription: sub,
      day: d,
      today: date,
    });
    const operationalSnapshot = d.lockedSnapshot || d.fulfilledSnapshot || null;
    const subscriptionAddons = operationalSnapshot && Array.isArray(operationalSnapshot.subscriptionAddons)
      ? operationalSnapshot.subscriptionAddons
      : (sub ? sub.addonSubscriptions || [] : []);

    // Kitchen UI needs to reliably display customer delivery notes.
    // Some edge flows might have incomplete snapshots, so we fallback to
    // client-provided overrides (day) or subscription defaults.
    const fallbackAddress =
      (d.deliveryAddressOverride && Object.keys(d.deliveryAddressOverride).length > 0)
        ? d.deliveryAddressOverride
        : (sub && sub.deliveryAddress ? sub.deliveryAddress : null);
    const fallbackWindow =
      d.deliveryWindowOverride
        ? d.deliveryWindowOverride
        : (sub && sub.deliveryWindow ? sub.deliveryWindow : null);

    let effectiveAddress = operationalSnapshot
      ? (operationalSnapshot.pickupAddress || operationalSnapshot.address || null)
      : null;
    let effectiveWindow = operationalSnapshot
      ? (operationalSnapshot.deliveryWindow || null)
      : null;

    if (!effectiveAddress) effectiveAddress = fallbackAddress;
    if (!effectiveWindow) effectiveWindow = fallbackWindow;

    // Ensure `effectiveAddress.notes` is populated for UI rendering.
    if (
      effectiveAddress
      && typeof effectiveAddress === "object"
      && fallbackAddress
      && typeof fallbackAddress === "object"
      && (effectiveAddress.notes === undefined || effectiveAddress.notes === null || effectiveAddress.notes === "")
      && fallbackAddress.notes !== undefined
    ) {
      effectiveAddress = { ...effectiveAddress, notes: fallbackAddress.notes };
    }
    const customSaladsSnapshot = operationalSnapshot && operationalSnapshot.customSalads ? operationalSnapshot.customSalads : (d.customSalads || []);
    const customMealsSnapshot = operationalSnapshot && operationalSnapshot.customMeals ? operationalSnapshot.customMeals : (d.customMeals || []);
    const dayWalletSelections = resolveDayWalletSelections({ subscription: sub, day: d });
    const premiumUpgradeSelections = operationalSnapshot && Array.isArray(operationalSnapshot.premiumUpgradeSelections)
      ? operationalSnapshot.premiumUpgradeSelections
      : dayWalletSelections.premiumUpgradeSelections;
    const addonSelections = operationalSnapshot && Array.isArray(operationalSnapshot.addonSelections)
      ? operationalSnapshot.addonSelections
      : (d.addonSelections || []);

    return {
      ...d,
      ...fulfillmentState,
      subscriptionAddons,
      effectiveAddress,
      deliveryNotes: effectiveAddress && typeof effectiveAddress === "object" ? (effectiveAddress.notes || null) : null,
      effectiveWindow,
      pickupLocationId: operationalSnapshot ? operationalSnapshot.pickupLocationId || null : null,
      pickupLocationName: operationalSnapshot ? operationalSnapshot.pickupLocationName || "" : "",
      pickupAddress: operationalSnapshot ? operationalSnapshot.pickupAddress || null : null,
      customSalads: customSaladsSnapshot,
      customMeals: customMealsSnapshot,
      premiumUpgradeSelections,
      kitchenAddons: addonSelections,
    };
  });

  return res.status(200).json({ ok: true, data: enrichedDays });
}

async function listPickupsByDate(req, res) {
  const { date } = req.params;
  if (!isValidKSADateString(date)) {
    return errorResponse(res, 400, "INVALID_DATE", "Invalid date");
  }

  const days = await SubscriptionDay.find({
    date,
    status: { $in: ["locked", "in_preparation", "ready_for_pickup", "fulfilled", "canceled_at_branch", "no_show"] },
  })
    .populate({ path: "subscriptionId", select: "deliveryMode" })
    .lean();

  const rows = days
    .filter((day) => {
      const snapshot = day.lockedSnapshot || day.fulfilledSnapshot || null;
      if (!snapshot) return false;
      const deliveryMode = snapshot.deliveryMode || (day.subscriptionId && day.subscriptionId.deliveryMode) || null;
      return deliveryMode === "pickup" && isPickupOperationalDay(day);
    })
    .map((day) => buildPickupQueueRow(day))
    .filter(Boolean)
    .sort((left, right) => {
      const statusDelta = resolvePickupQueueStatusOrder(left.status) - resolvePickupQueueStatusOrder(right.status);
      if (statusDelta !== 0) return statusDelta;
      return String(left.subscriptionDayId).localeCompare(String(right.subscriptionDayId));
    });

  return res.status(200).json({ ok: true, data: rows });
}

async function listTodayPickups(req, res) {
  // Dashboard-friendly alias: no need to pass a date param.
  req.params = { ...(req.params || {}), date: getTodayKSADate() };
  return listPickupsByDate(req, res);
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
    // MEDIUM AUDIT FIX: Enforce premium entitlement when kitchen updates day selections.
    const previousPremiumCount = existingDay ? existingDay.premiumSelections.length : 0;
    const premiumEntitlement = getTrackedPremiumCredits(sub) + previousPremiumCount;
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


    if (isCanonicalDayPlanningEligible(sub, {
      flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
    })) {
      applyCanonicalDraftPlanningToDay({
        subscription: sub,
        day,
        selections,
        premiumSelections,
        assignmentSource: "kitchen",
      });
      await day.save({ session });
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

async function ensureLockedSnapshot(sub, day, session, { pickupLocations = [] } = {}) {
  if (day.lockedSnapshot) return;
  day.lockedSnapshot = await buildLockedDaySnapshot({
    subscription: sub,
    day,
    pickupLocations,
    session,
  });
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

    const pickupLocations = await getPickupLocationsSetting();
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
    const invalidDays = [];

    for (const day of openDays) {
      const sub = subscriptionMap.get(String(day.subscriptionId));
      if (!sub) {
        skippedMissingSubscriptionCount += 1;
        continue;
      }
      if (sub.deliveryMode === "pickup") {
        invalidDays.push({
          subscriptionId: String(day.subscriptionId),
          dayId: String(day._id),
          date: day.date,
          code: "PICKUP_PREPARE_REQUIRED",
        });
        continue;
      }
      try {
        validateDayBeforeLockOrPrepare({ subscription: sub, day });
      } catch (err) {
        invalidDays.push({
          subscriptionId: String(day.subscriptionId),
          dayId: String(day._id),
          date: day.date,
          code: err.code || "INVALID",
        });
        continue;
      }
      await ensureLockedSnapshot(sub, day, session, { pickupLocations });
      day.status = "locked";
      await day.save({ session });
      lockedCount += 1;
      lockedDayIds.push(String(day._id));
    }

    summary = {
      date,
      totalDays,
      lockedCount,
      skippedCount: skippedDays.length + skippedMissingSubscriptionCount + invalidDays.length,
      alreadyProcessedCount: skippedDays.length,
      missingSubscriptionCount: skippedMissingSubscriptionCount,
      invalidCount: invalidDays.length,
      invalidDays,
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
  let issuedPickupCode = "";
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
    if (toStatus === "fulfilled") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "PICKUP_VERIFICATION_REQUIRED", "Use pickup verification before fulfillment");
    }
    sub = await Subscription.findById(id).session(session).lean();
    if (toStatus === "locked" && sub) {
      if (sub.deliveryMode === "pickup" && !day.pickupRequested) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "PICKUP_PREPARE_REQUIRED", "Pickup preparation requires an explicit client request");
      }
      try {
        validateDayBeforeLockOrPrepare({ subscription: sub, day });
      } catch (err) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, resolveDayExecutionValidationErrorStatus(err), err.code || "INVALID", err.message);
      }
      const pickupLocations = await getPickupLocationsSetting();
      await ensureLockedSnapshot(sub, day, session, { pickupLocations });
    }
    if (toStatus === "out_for_delivery") {
      if (sub && sub.deliveryMode !== "delivery") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 400, "INVALID", "Not a delivery subscription");
      }
      if (sub) {
        if (!day.lockedSnapshot) {
          await session.abortTransaction();
          session.endSession();
          return errorResponse(res, 409, "INVALID_TRANSITION", "Day snapshot is required before dispatch");
        }
        const effective = {
          address: day.lockedSnapshot.address || null,
          deliveryWindow: day.lockedSnapshot.deliveryWindow || null,
        };
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
    if (sub && sub.deliveryMode === "pickup" && ["in_preparation", "ready_for_pickup"].includes(toStatus)) {
      if (!day.pickupRequested) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "PICKUP_PREPARE_REQUIRED", "Pickup preparation requires an explicit client request");
      }
      if (!day.lockedSnapshot) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "LOCKED_SNAPSHOT_REQUIRED", "Day snapshot is required before pickup preparation");
      }
      if (day.status === "consumed_without_preparation") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "INVALID_TRANSITION", "Consumed pickup days cannot enter preparation");
      }
    }
    if (sub && sub.deliveryMode === "pickup" && toStatus === "ready_for_pickup" && day.status !== "in_preparation") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Pickup days must start preparation before becoming ready");
    }
    fromStatus = day.status;
    day.status = toStatus;
    if (sub && sub.deliveryMode === "pickup" && toStatus === "in_preparation" && !day.pickupPreparationStartedAt) {
      day.pickupPreparationStartedAt = new Date();
    }
    if (sub && sub.deliveryMode === "pickup" && toStatus === "ready_for_pickup") {
      day.pickupPreparedAt = new Date();
    }
    appendOperationAudit(day, {
      action: toStatus,
      actor: req.dashboardUserId || req.userId,
    });
    await day.save({ session });
    if (toStatus === "ready_for_pickup") {
      day = await issuePickupCode(day, { session });
      issuedPickupCode = normalizePickupCode(day && day.pickupCode);
    }

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
        data: {
          subscriptionId: String(sub._id),
          date: day.date,
          ...(issuedPickupCode ? { pickupCode: issuedPickupCode } : {}),
        },
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

    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (normalizePickupCode(day.pickupCode) && !day.pickupVerifiedAt) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "PICKUP_VERIFICATION_REQUIRED", "Pickup verification is required before fulfillment");
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
    appendOperationAudit(result.day, {
      action: "fulfilled",
      actor: req.dashboardUserId || req.userId,
    });
    await result.day.save({ session });

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

async function verifyPickup(req, res) {
  const { dayId } = req.params;
  const submittedCode = normalizePickupCode(req.body && req.body.code);

  try {
    validateObjectId(dayId, "subscriptionDayId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!/^\d{6}$/.test(submittedCode)) {
    return errorResponse(res, 400, "INVALID_PICKUP_CODE", "Pickup code must be a 6-digit value");
  }

  const session = await mongoose.startSession();
  let result;
  try {
    session.startTransaction();

    const day = await SubscriptionDay.findById(dayId).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (day.status === "fulfilled" && day.pickupVerifiedAt) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true, data: day, verified: true, idempotent: true });
    }
    if (day.status !== "ready_for_pickup") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Only ready pickup days can be verified");
    }

    const expectedCode = normalizePickupCode(day.pickupCode);
    if (!expectedCode) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "PICKUP_CODE_NOT_ISSUED", "Pickup code has not been issued yet");
    }
    if (submittedCode !== expectedCode) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 422, "PICKUP_CODE_MISMATCH", "Pickup code does not match");
    }

    const sub = await Subscription.findById(day.subscriptionId).session(session).lean();
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.deliveryMode !== "pickup") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Not a pickup subscription");
    }

    day.pickupVerifiedAt = new Date();
    day.pickupVerifiedByDashboardUserId = req.dashboardUserId || req.userId || null;
    appendOperationAudit(day, {
      action: "pickup_verified",
      actor: req.dashboardUserId || req.userId,
    });
    await day.save({ session });

    result = await fulfillSubscriptionDay({ dayId, session });
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
    appendOperationAudit(result.day, {
      action: "fulfilled",
      actor: req.dashboardUserId || req.userId,
    });
    await result.day.save({ session });

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("kitchenController.verifyPickup failed", { dayId, error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Pickup verification failed");
  }

  try {
    await writeLog({
      entityType: "subscription_day",
      entityId: result.day._id,
      action: "pickup_verified",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: {
        deductedCredits: result.deductedCredits,
        verifiedAt: result.day.pickupVerifiedAt,
      },
    });
  } catch (err) {
    logger.error("Kitchen pickup verification log write failed", { error: err.message, stack: err.stack, dayId });
  }

  return res.status(200).json({
    ok: true,
    data: result.day,
    verified: true,
    alreadyFulfilled: result.alreadyFulfilled,
  });
}

async function markPickupNoShow(req, res) {
  const { dayId } = req.params;
  try {
    validateObjectId(dayId, "subscriptionDayId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const session = await mongoose.startSession();
  let day;
  let deductedCredits = 0;
  try {
    session.startTransaction();

    day = await SubscriptionDay.findById(dayId).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (day.status === "no_show") {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({
        ok: true,
        data: day,
        deductedCredits: 0,
        restoreCreditsPolicy: false,
        idempotent: true,
      });
    }
    if (day.status !== "ready_for_pickup") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Only ready pickup days can be marked as no-show");
    }

    const sub = await Subscription.findById(day.subscriptionId).session(session).lean();
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.deliveryMode !== "pickup") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Not a pickup subscription");
    }
    if (!day.pickupRequested) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "PICKUP_PREPARE_REQUIRED", "Cannot mark no-show without a pickup prepare request");
    }

    try {
      const consumption = await consumeSubscriptionDayCredits({
        day,
        subscription: sub,
        session,
        reason: "pickup_no_show",
      });
      deductedCredits = consumption.deductedCredits;
    } catch (err) {
      if (err.code === "INSUFFICIENT_CREDITS") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "INSUFFICIENT_CREDITS", "Not enough credits");
      }
      throw err;
    }

    day.status = "no_show";
    day.pickupRequested = false;
    day.pickupNoShowAt = new Date();
    appendOperationAudit(day, {
      action: "no_show",
      actor: req.dashboardUserId || req.userId,
    });
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("kitchenController.markPickupNoShow failed", { dayId, error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Pickup no-show update failed");
  }

  try {
    await writeLog({
      entityType: "subscription_day",
      entityId: day._id,
      action: "pickup_no_show",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: {
        deductedCredits,
        restoreCreditsPolicy: false,
      },
    });
  } catch (err) {
    logger.error("Kitchen pickup no-show log write failed", { error: err.message, stack: err.stack, dayId });
  }

  return res.status(200).json({
    ok: true,
    data: day,
    deductedCredits,
    restoreCreditsPolicy: false,
  });
}

async function cancelAtBranch(req, res) {
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
  let restoredCredits = 0;
  try {
    session.startTransaction();

    const sub = await Subscription.findById(id).session(session).lean();
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.deliveryMode !== "pickup") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Not a pickup subscription");
    }

    day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (day.status === "canceled_at_branch") {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true, data: day, restoredCredits: 0, idempotent: true });
    }
    if (day.status === "fulfilled") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }
    if (!["locked", "in_preparation", "ready_for_pickup"].includes(day.status)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }

    if (day.creditsDeducted) {
      restoredCredits = Number(day.lockedSnapshot && day.lockedSnapshot.mealsPerDay)
        || resolveMealsPerDay(sub);
      if (restoredCredits > 0) {
        await Subscription.updateOne(
          { _id: sub._id },
          { $inc: { remainingMeals: restoredCredits } },
          { session }
        );
      }
      day.creditsDeducted = false;
    }

    day.status = "canceled_at_branch";
    day.pickupRequested = false;
    appendOperationAudit(day, {
      action: "canceled_at_branch",
      actor: req.dashboardUserId || req.userId,
    });
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("kitchenController.cancelAtBranch failed", { subscriptionId: id, date, error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Cancel at branch failed");
  }

  try {
    await writeLog({
      entityType: "subscription_day",
      entityId: day._id,
      action: "cancel_at_branch",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: { date, restoredCredits },
    });
  } catch (err) {
    logger.error("Kitchen cancel-at-branch log write failed", { error: err.message, stack: err.stack, dayId: String(day._id) });
  }

  return res.status(200).json({ ok: true, data: day, restoredCredits });
}

module.exports = {
  listDailyOrders,
  listPickupsByDate,
  listTodayPickups,
  assignMeals,
  bulkLockDaysByDate,
  transitionDay,
  reopenLockedDay,
  fulfillPickup,
  verifyPickup,
  markPickupNoShow,
  cancelAtBranch,
};
