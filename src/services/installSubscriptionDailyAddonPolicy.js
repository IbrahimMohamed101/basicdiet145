"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../models/SubscriptionPickupRequest");
const SubscriptionDayAppendOperation = require("../models/SubscriptionDayAppendOperation");
const { logger } = require("../utils/logger");
const { localizeWriteDayPayload } = require("../utils/subscription/subscriptionWriteLocalization");
const {
  serializeSubscriptionDayForClient,
  shapeMealPlannerReadFields,
} = require("./subscription/subscriptionClientSupportService");
const {
  assertSubscriptionDayModifiable,
} = require("./subscription/subscriptionDayModificationPolicyService");
const {
  resolveEffectiveFulfillmentMode,
} = require("./subscription/subscriptionFulfillmentPolicyService");
const {
  transitionAllocation,
} = require("./subscription/subscriptionMealEntitlementService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionDailyAddonPolicy.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionDailyAddonPolicy.wrapped");

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function wrapExport(target, name, factory) {
  const original = target && target[name];
  if (typeof original !== "function" || original[WRAPPED_KEY]) return original;
  const wrapped = factory(original);
  wrapped[WRAPPED_KEY] = true;
  target[name] = wrapped;
  return wrapped;
}

function addSchemaPaths(schema, definition) {
  if (!schema) return;
  const missing = {};
  for (const [key, value] of Object.entries(definition)) {
    if (!schema.path(key)) missing[key] = value;
  }
  if (Object.keys(missing).length) schema.add(missing);
}

function patchSchemas() {
  const addonBalancePath = Subscription.schema.path("addonBalance");
  addSchemaPaths(addonBalancePath && addonBalancePath.schema, {
    reservationKeys: { type: [String], default: undefined },
    consumedAllocationKeys: { type: [String], default: undefined },
    releasedAllocationKeys: { type: [String], default: undefined },
  });

  const selectionDefinition = {
    autoDailyAddon: { type: Boolean, default: false },
    dailyEntitlement: { type: Boolean, default: false },
    selectionOrigin: { type: String, default: "", trim: true },
    dailyAllocationKey: { type: String, default: "", trim: true },
    addonSettlementState: {
      type: String,
      enum: ["", "reserved", "consumed", "released"],
      default: "",
    },
    reservedAt: { type: Date, default: null },
    settledAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    settlementReason: { type: String, default: null, trim: true },
    subscriptionAddonLabelI18n: { type: mongoose.Schema.Types.Mixed, default: undefined },
    resolvedProductNameI18n: { type: mongoose.Schema.Types.Mixed, default: undefined },
    requiresKitchenChoice: { type: Boolean, default: false },
  };

  const dayAddonPath = SubscriptionDay.schema.path("addonSelections");
  addSchemaPaths(dayAddonPath && dayAddonPath.schema, selectionDefinition);
  const subscriptionAddonPath = Subscription.schema.path("addonSelections");
  addSchemaPaths(subscriptionAddonPath && subscriptionAddonPath.schema, selectionDefinition);
}

function patchCarryoverPricing() {
  const pricingService = require("./subscription/subscriptionAddonPricingService");
  wrapExport(pricingService, "buildAddonChoicePricingPreview", (original) => function pooledAddonPricing(args = {}) {
    const entitlement = args.entitlement;
    if (!entitlement || typeof entitlement !== "object") return original(args);
    const balance = pricingService.resolveEntitlementBalance(args.subscription, entitlement);
    const originalMax = entitlement.maxPerDay;
    const carriedLimit = Math.max(
      Number(originalMax || entitlement.quantityPerDay || 1),
      Number(balance && balance.remainingQty || 0),
      Number(args.quantity || 1)
    );
    entitlement.maxPerDay = carriedLimit;
    try {
      const result = original(args);
      return {
        ...result,
        maxPerDay: carriedLimit,
        pooledCarryoverEnabled: true,
      };
    } finally {
      entitlement.maxPerDay = originalMax;
    }
  });

  const balanceService = require("./subscription/subscriptionAddonBalanceService");
  wrapExport(balanceService, "buildClientAddonBalance", (original) => function authoritativeAddonBalance(subscription, businessDate) {
    const result = original(subscription, businessDate);
    const balances = Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : [];
    const reservedUnits = balances.reduce((sum, row) => sum + Number(row && row.reservedQty || 0), 0);
    return {
      ...result,
      reservedUnits,
      pooledCarryoverEnabled: true,
      sourceOfTruth: "subscription.addonBalance",
    };
  });
  wrapExport(balanceService, "buildAddonSubscriptionAllowances", (original) => function pooledAllowances(subscription, day) {
    return (original(subscription, day) || []).map((row) => ({
      ...row,
      maxPerDay: Math.max(
        Number(row.maxPerDay || row.quantityPerDay || 1),
        Number(row.remainingIncludedQty || row.remainingQty || row.freeQtyAvailable || 0)
      ),
      pooledCarryoverEnabled: true,
    }));
  });
}

function appendRequestHash(args, existingSlotCount) {
  const body = args.body || {};
  return crypto.createHash("sha256").update(JSON.stringify({
    subscriptionId: clean(args.subscriptionId),
    date: clean(args.date),
    existingSlotCount,
    mealSlots: Array.isArray(body.mealSlots) ? body.mealSlots : [],
    addonsOneTime: body.addonsOneTime !== undefined ? body.addonsOneTime : body.oneTimeAddonSelections,
  })).digest("hex");
}

function dayPlanningSnapshot(day) {
  return {
    status: day.status,
    mealSlots: day.mealSlots || [],
    plannerMeta: day.plannerMeta || undefined,
    plannerState: day.plannerState || undefined,
    plannerVersion: day.plannerVersion || undefined,
    plannerRevisionHash: day.plannerRevisionHash || "",
    materializedMeals: day.materializedMeals || [],
    selections: day.selections || [],
    premiumUpgradeSelections: day.premiumUpgradeSelections || [],
    premiumReservationMode: day.premiumReservationMode || undefined,
    baseMealSlots: day.baseMealSlots || [],
    addonSelections: day.addonSelections || [],
    planningState: day.planningState || undefined,
    planningMeta: day.planningMeta || undefined,
    planningVersion: day.planningVersion || undefined,
  };
}

function appendSlotKey(slot, index) {
  return clean(slot && slot.slotKey) || `slot_${Number(slot && slot.slotIndex || index + 1)}`;
}

function mergeAppendSlots(day, requestedSlots) {
  const existing = JSON.parse(JSON.stringify(Array.isArray(day && day.mealSlots) ? day.mealSlots : []));
  const maxIndex = existing.reduce((max, slot) => Math.max(max, Number(slot && slot.slotIndex || 0)), 0);
  const appended = requestedSlots.map((slot, index) => ({
    ...JSON.parse(JSON.stringify(slot)),
    slotIndex: maxIndex + index + 1,
    slotKey: `slot_${maxIndex + index + 1}`,
  }));
  return { merged: existing.concat(appended), appended };
}

async function shapeAppendDay(args, subscription, day, extra = {}) {
  let shaped = day;
  try {
    const serialized = serializeSubscriptionDayForClient(
      subscription,
      day && typeof day.toObject === "function" ? day.toObject() : day,
      args.runtime
    );
    const catalog = args.loadWalletCatalogMapsSafelyFn
      ? await args.loadWalletCatalogMapsSafelyFn({
        days: [serialized],
        lang: args.lang,
        context: "delivery_append_authority_result",
      })
      : { addonNames: new Map() };
    shaped = shapeMealPlannerReadFields({
      subscription,
      day: localizeWriteDayPayload(serialized, {
        lang: args.lang,
        addonNames: catalog.addonNames,
      }),
      lang: args.lang,
    });
  } catch (err) {
    logger.warn("delivery append response shaping fallback", {
      subscriptionId: clean(args.subscriptionId),
      date: clean(args.date),
      error: err.message,
    });
  }
  return {
    ok: true,
    status: 200,
    data: {
      ...(shaped && typeof shaped === "object" ? shaped : {}),
      ...extra,
    },
    idempotent: Boolean(extra.idempotent),
  };
}

async function acquireDeliveryAppendOperation({ args, day, requestHash, expectedSlotKeys }) {
  const idempotencyKey = clean(args.body && args.body.idempotencyKey);
  if (!idempotencyKey) {
    return { error: { ok: false, status: 400, code: "IDEMPOTENCY_KEY_REQUIRED", message: "idempotencyKey is required" } };
  }
  let operation = await SubscriptionDayAppendOperation.findOne({
    subscriptionId: args.subscriptionId,
    date: args.date,
    idempotencyKey,
  });
  if (operation) {
    if (operation.requestHash !== requestHash) {
      return { error: { ok: false, status: 409, code: "IDEMPOTENCY_CONFLICT", message: "idempotencyKey was already used with a different append payload" } };
    }
    if (["failed", "compensated"].includes(operation.status)) {
      try {
        operation = await SubscriptionDayAppendOperation.findOneAndUpdate(
          { _id: operation._id, active: false },
          {
            $set: {
              status: "started",
              active: true,
              failedAt: null,
              errorCode: null,
              errorMessage: null,
            },
          },
          { new: true }
        );
      } catch (err) {
        return { error: { ok: false, status: 409, code: "APPEND_IN_PROGRESS", message: "Another meal append is already in progress for this day" } };
      }
    }
    return { operation };
  }

  try {
    operation = await SubscriptionDayAppendOperation.create({
      subscriptionId: args.subscriptionId,
      subscriptionDayId: day._id,
      userId: args.userId,
      date: args.date,
      idempotencyKey,
      requestHash,
      status: "started",
      active: true,
      preSlotCount: Array.isArray(day.mealSlots) ? day.mealSlots.length : 0,
      expectedSlotKeys,
      previousPlannerRevisionHash: day.plannerRevisionHash || "",
      previousDaySnapshot: dayPlanningSnapshot(day),
    });
    return { operation };
  } catch (err) {
    if (err && err.code === 11000) {
      operation = await SubscriptionDayAppendOperation.findOne({
        subscriptionId: args.subscriptionId,
        date: args.date,
        idempotencyKey,
      });
      if (operation && operation.requestHash === requestHash) return { operation };
      return { error: { ok: false, status: 409, code: "APPEND_IN_PROGRESS", message: "Another meal append is already in progress for this day" } };
    }
    throw err;
  }
}

async function compensateDeliveryAppend(operation, reservedKeys = []) {
  for (const key of reservedKeys) {
    try {
      await transitionAllocation({
        subscriptionId: operation.subscriptionId,
        allocationKey: key,
        toState: "released",
      });
    } catch (err) {
      logger.error("delivery append entitlement compensation failed", {
        operationId: clean(operation._id),
        allocationKey: clean(key),
        error: err.message,
      });
    }
  }
  if (operation.previousDaySnapshot) {
    await SubscriptionDay.updateOne(
      { _id: operation.subscriptionDayId },
      { $set: operation.previousDaySnapshot }
    ).catch(() => {});
  }
}

async function appendDeliveryMealsWithAuthority(args, updateSelectionFn, authority, dailyAddonService) {
  let operation = null;
  let changedAllocationKeys = [];
  try {
    const requestedSlots = Array.isArray(args.body && args.body.mealSlots) ? args.body.mealSlots : [];
    if (!requestedSlots.length) {
      return { ok: false, status: 400, code: "INVALID_MEAL_SLOTS", message: "mealSlots must contain at least one meal" };
    }
    const subscription = await Subscription.findById(args.subscriptionId);
    if (!subscription) return { ok: false, status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    if (clean(subscription.userId) !== clean(args.userId)) return { ok: false, status: 403, code: "FORBIDDEN", message: "Forbidden" };
    if (subscription.status !== "active") return { ok: false, status: 422, code: "SUB_INACTIVE", message: "Subscription not active" };

    let day = await SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date });
    if (!day) return { ok: false, status: 404, code: "DAY_NOT_FOUND", message: "Subscription day not found" };
    const effectiveMode = resolveEffectiveFulfillmentMode({ subscription, day, date: args.date });
    await assertSubscriptionDayModifiable({ subscription, day, date: args.date });
    if (day.status !== "open") {
      return { ok: false, status: 409, code: "LOCKED", message: "Day is already in operations and cannot be edited" };
    }

    const { merged, appended } = mergeAppendSlots(day, requestedSlots);
    const expectedSlotKeys = appended.map(appendSlotKey);
    const requestHash = appendRequestHash(args, Array.isArray(day.mealSlots) ? day.mealSlots.length : 0);
    const acquired = await acquireDeliveryAppendOperation({ args, day, requestHash, expectedSlotKeys });
    if (acquired.error) return acquired.error;
    operation = acquired.operation;

    if (operation.status === "completed") {
      const currentDay = await SubscriptionDay.findById(day._id);
      const currentSubscription = await Subscription.findById(args.subscriptionId);
      const wallet = await authority.readWallet(args.subscriptionId);
      const dailyAddonWallet = dailyAddonService.buildDailyAddonWallet(currentSubscription);
      return shapeAppendDay(args, currentSubscription, currentDay, {
        idempotent: true,
        effectiveFulfillmentMode: effectiveMode,
        entitlementWallet: wallet,
        dailyAddonWallet,
      });
    }

    const presentKeys = new Set((Array.isArray(day.mealSlots) ? day.mealSlots : []).map(appendSlotKey));
    let daySaved = expectedSlotKeys.every((key) => presentKeys.has(key));
    const wasConfirmed = operation.previousDaySnapshot
      && (operation.previousDaySnapshot.plannerState === "confirmed" || operation.previousDaySnapshot.planningState === "confirmed");

    if (!daySaved) {
      if (wasConfirmed) {
        const unlocked = await SubscriptionDay.findOneAndUpdate(
          { _id: day._id, status: "open", plannerState: "confirmed" },
          { $set: { plannerState: "draft", planningState: "draft" } },
          { new: true }
        );
        if (!unlocked) {
          return { ok: false, status: 409, code: "DAY_CHANGED", message: "The day changed while adding meals; reload and retry" };
        }
      }

      const result = await updateSelectionFn({
        ...args,
        body: {
          ...(args.body || {}),
          mealSlots: merged,
        },
      });
      if (!result || result.ok !== true) {
        await compensateDeliveryAppend(operation, changedAllocationKeys);
        await SubscriptionDayAppendOperation.updateOne(
          { _id: operation._id },
          {
            $set: {
              status: "compensated",
              active: false,
              failedAt: new Date(),
              errorCode: result && result.code || "APPEND_FAILED",
              errorMessage: result && result.message || "Append failed",
            },
          }
        );
        return result;
      }
      day = await SubscriptionDay.findById(day._id);
      daySaved = Boolean(day) && expectedSlotKeys.every((key) => (
        Array.isArray(day.mealSlots) && day.mealSlots.some((slot, index) => appendSlotKey(slot, index) === key)
      ));
      if (!daySaved) throw Object.assign(new Error("Appended meal slots were not persisted as expected"), { code: "APPEND_PROJECTION_MISMATCH", status: 409 });
      operation = await SubscriptionDayAppendOperation.findOneAndUpdate(
        { _id: operation._id },
        {
          $set: {
            status: "day_saved",
            appendedSlotKeys: expectedSlotKeys,
            appliedPlannerRevisionHash: day.plannerRevisionHash || "",
          },
        },
        { new: true }
      );
    }

    const reservation = await authority.reserveMissingDaySlotAllocations({
      subscriptionId: args.subscriptionId,
      dayId: day._id,
      slotKeys: expectedSlotKeys,
    });
    changedAllocationKeys = reservation.newlyChangedAllocationKeys || [];

    const requiresPayment = Boolean(day.premiumExtraPayment && ["pending", "revision_mismatch"].includes(day.premiumExtraPayment.status));
    if (wasConfirmed && !requiresPayment) {
      await SubscriptionDay.updateOne(
        { _id: day._id, status: "open" },
        { $set: { plannerState: "confirmed", planningState: "confirmed" } }
      );
    }

    await SubscriptionDayAppendOperation.updateOne(
      { _id: operation._id },
      {
        $set: {
          status: "completed",
          active: false,
          allocationKeys: reservation.allocationKeys || [],
          appendedSlotKeys: expectedSlotKeys,
          completedAt: new Date(),
          appliedPlannerRevisionHash: day.plannerRevisionHash || operation.appliedPlannerRevisionHash || "",
        },
      }
    );

    await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
    const [currentDay, currentSubscription] = await Promise.all([
      SubscriptionDay.findById(day._id),
      Subscription.findById(args.subscriptionId),
    ]);
    const wallet = await authority.readWallet(args.subscriptionId);
    const dailyAddonWallet = dailyAddonService.buildDailyAddonWallet(currentSubscription);
    return shapeAppendDay(args, currentSubscription, currentDay, {
      idempotent: false,
      effectiveFulfillmentMode: effectiveMode,
      entitlementWallet: wallet,
      dailyAddonWallet,
      balanceChange: {
        event: "meals_appended_before_fulfillment_cutoff",
        reservedDelta: Number(reservation.reservedDelta || 0),
        remainingMeals: wallet.remainingMeals,
        reservedMeals: wallet.reservedMeals,
      },
    });
  } catch (err) {
    if (operation) {
      await compensateDeliveryAppend(operation, changedAllocationKeys);
      await SubscriptionDayAppendOperation.updateOne(
        { _id: operation._id, status: { $ne: "completed" } },
        {
          $set: {
            status: "compensated",
            active: false,
            failedAt: new Date(),
            errorCode: clean(err.code) || "APPEND_FAILED",
            errorMessage: clean(err.message).slice(0, 500),
          },
        }
      ).catch(() => {});
    }
    return {
      ok: false,
      status: Number(err.status || 500),
      code: err.code || "INTERNAL",
      message: err.message || "Append meals failed",
      details: err.details,
    };
  }
}

function attachDailyWalletToResult(result, wallet, day = null) {
  if (!result || result.ok !== true || !result.data || typeof result.data !== "object") return result;
  return {
    ...result,
    data: {
      ...result.data,
      ...(day && Array.isArray(day.addonSelections) ? { addonSelections: day.addonSelections } : {}),
      dailyAddonWallet: wallet,
    },
  };
}

function patchPlanningService(dailyAddonService, authority) {
  const planningService = require("./subscription/subscriptionPlanningClientService");
  const baseUpdate = planningService.updateDaySelectionForClient;
  const pickupAppend = planningService.appendDayMealsForClient;

  wrapExport(planningService, "updateDaySelectionForClient", () => async function dailyAddonAwareUpdate(args = {}) {
    const body = args.body || {};
    const explicitlySubmittedAddons = Object.prototype.hasOwnProperty.call(body, "addonsOneTime")
      || Object.prototype.hasOwnProperty.call(body, "oneTimeAddonSelections");
    if (explicitlySubmittedAddons) {
      const day = await SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).select("_id").lean();
      if (day) {
        await dailyAddonService.releaseDailyAddonReservationsForDay({
          dayId: day._id,
          reason: "customer_explicit_addon_selection_replaced_default",
          removeSelections: true,
        });
      }
    }
    const result = await baseUpdate(args);
    if (!result || result.ok !== true) return result;
    const day = await SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).lean();
    const subscription = await Subscription.findById(args.subscriptionId).lean();
    return attachDailyWalletToResult(result, dailyAddonService.buildDailyAddonWallet(subscription), day);
  });

  wrapExport(planningService, "confirmDayPlanningForClient", (original) => async function dailyAddonAwareConfirm(args = {}) {
    const result = await original(args);
    if (!result || result.ok !== true) return result;
    const day = await SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).lean();
    if (!day) return result;
    const reconciliation = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
    const subscription = await Subscription.findById(args.subscriptionId).lean();
    return attachDailyWalletToResult(
      result,
      reconciliation.wallet || dailyAddonService.buildDailyAddonWallet(subscription),
      reconciliation.day || await SubscriptionDay.findById(day._id).lean()
    );
  });

  planningService.appendDayMealsForClient = async function fulfillmentModeAwareAppend(args = {}) {
    const subscription = await Subscription.findById(args.subscriptionId).select("deliveryMode").lean();
    if (!subscription || subscription.deliveryMode === "pickup") {
      const result = await pickupAppend(args);
      if (!result || result.ok !== true) return result;
      const day = await SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).lean();
      if (day) await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
      const currentSubscription = await Subscription.findById(args.subscriptionId).lean();
      return attachDailyWalletToResult(result, dailyAddonService.buildDailyAddonWallet(currentSubscription), day);
    }
    return appendDeliveryMealsWithAuthority(args, baseUpdate, authority, dailyAddonService);
  };
  planningService.appendDayMealsForClient[WRAPPED_KEY] = true;
}

function patchPickupRequestService(dailyAddonService) {
  const pickupService = require("./subscription/subscriptionPickupRequestClientService");
  wrapExport(pickupService, "createSubscriptionPickupRequestForClient", (original) => async function dailyAddonAwarePickupCreate(args = {}) {
    const day = await SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).select("_id").lean();
    if (day) await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
    const result = await original(args);
    const subscription = await Subscription.findById(args.subscriptionId).lean();
    if (result && result.data && typeof result.data === "object") {
      result.data.dailyAddonWallet = dailyAddonService.buildDailyAddonWallet(subscription);
    }
    return result;
  });

  for (const name of ["getSubscriptionPickupRequestStatusForClient", "listSubscriptionPickupRequestsForClient"]) {
    wrapExport(pickupService, name, (original) => async function dailyAddonAwarePickupRead(args = {}) {
      const result = await original(args);
      const subscription = await Subscription.findById(args.subscriptionId).lean();
      if (result && typeof result === "object") {
        result.dailyAddonWallet = dailyAddonService.buildDailyAddonWallet(subscription);
      }
      return result;
    });
  }
}

async function resolveActionDay(context = {}) {
  const entityType = context.entityType === "subscription_day" || context.entityType === "pickup_day"
    ? "subscription"
    : context.entityType;
  if (entityType === "subscription") return SubscriptionDay.findById(context.entityId).lean();
  if (entityType === "subscription_pickup_request") {
    const request = await SubscriptionPickupRequest.findById(context.entityId).lean();
    if (!request) return null;
    if (request.subscriptionDayId) {
      const linked = await SubscriptionDay.findById(request.subscriptionDayId).lean();
      if (linked) return linked;
    }
    return SubscriptionDay.findOne({ subscriptionId: request.subscriptionId, date: request.date }).lean();
  }
  return null;
}

function normalizeAction(actionId) {
  if (actionId === "ready-for-pickup") return "ready_for_pickup";
  if (actionId === "ready-for-delivery") return "ready_for_delivery";
  if (actionId === "start_preparation") return "prepare";
  return actionId;
}

function patchOpsTransitionService(dailyAddonService) {
  const service = require("./dashboard/opsTransitionService");
  wrapExport(service, "executeAction", (original) => async function dailyAddonAwareAction(actionId, context = {}) {
    const action = normalizeAction(actionId);
    let day = await resolveActionDay(context);
    if (day && ["prepare", "ready_for_pickup", "ready_for_delivery", "dispatch", "fulfill"].includes(action)) {
      await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
    }
    const result = await original(actionId, context);
    day = await resolveActionDay(context);
    if (!day) return result;
    if (action === "fulfill") {
      await dailyAddonService.consumeDailyAddonReservationsForDay({ dayId: day._id, reason: "fulfilled" });
    } else if (["no_show", "cancel"].includes(action)) {
      await dailyAddonService.releaseSubscriptionAddonSelectionsForDay({
        dayId: day._id,
        reason: action === "no_show" ? "pickup_no_show_returned_to_balance" : "operation_canceled_returned_to_balance",
      });
    } else if (action === "reopen") {
      await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
    }
    return result;
  });
}

function patchSkipService(dailyAddonService) {
  const service = require("./subscription/subscriptionSkipService");
  wrapExport(service, "performSkipDay", (original) => async function dailyAddonAwareSkip(args = {}) {
    const result = await original(args);
    const day = result && result.day
      ? result.day
      : await SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).lean();
    if (day && day.status === "skipped") {
      await dailyAddonService.releaseSubscriptionAddonSelectionsForDay({
        dayId: day._id,
        reason: "delivery_skip_returned_to_balance",
      });
    }
    return result;
  });
  wrapExport(service, "performSkipRange", (original) => async function dailyAddonAwareSkipRange(args = {}) {
    const result = await original(args);
    const dates = result && result.summary && Array.isArray(result.summary.appliedDates)
      ? result.summary.appliedDates
      : [];
    const days = await SubscriptionDay.find({ subscriptionId: args.subscriptionId, date: { $in: dates } }).select("_id").lean();
    for (const day of days) {
      await dailyAddonService.releaseSubscriptionAddonSelectionsForDay({
        dayId: day._id,
        reason: "delivery_skip_range_returned_to_balance",
      });
    }
    return result;
  });
  wrapExport(service, "performUnskipDay", (original) => async function dailyAddonAwareUnskip(args = {}) {
    const result = await original(args);
    const day = result && result.day
      ? result.day
      : await SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).lean();
    if (day) await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
    return result;
  });
}

function patchOverviewService(dailyAddonService) {
  const service = require("./subscription/subscriptionClientOverviewService");
  wrapExport(service, "buildCurrentSubscriptionOverview", (original) => async function dailyAddonAwareOverview(args = {}) {
    await dailyAddonService.reconcileDailyAddonsForUser({ userId: args.userId });
    const result = await original(args);
    if (!result || !result.data || !result.data.subscriptionId) return result;
    const subscription = await Subscription.findById(result.data.subscriptionId).lean();
    result.data.dailyAddonWallet = dailyAddonService.buildDailyAddonWallet(subscription);
    return result;
  });
}

function patchOpsPayloadService() {
  const service = require("./dashboard/opsPayloadService");
  wrapExport(service, "buildKitchenDetailsPayload", (original) => function dailyAddonKitchenPayload(day = {}, subscription = {}, lang = "en", catalogMaps = {}) {
    const result = original(day, subscription, lang, catalogMaps);
    const sourceAddons = []
      .concat(Array.isArray(day.addonSelections) ? day.addonSelections : [])
      .concat(Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : [])
      .concat(Array.isArray(day.recurringAddons) ? day.recurringAddons : []);
    const addons = (Array.isArray(result && result.addons) ? result.addons : []).map((addon, index) => {
      const source = sourceAddons[index] || {};
      return {
        ...addon,
        autoDailyAddon: Boolean(source.autoDailyAddon),
        dailyEntitlement: Boolean(source.dailyEntitlement),
        selectionOrigin: source.selectionOrigin || (source.autoDailyAddon ? "subscription_daily_default" : "customer_selected"),
        addonSettlementState: source.addonSettlementState || (source.autoDailyAddon ? "reserved" : "consumed"),
        requiresKitchenChoice: Boolean(source.requiresKitchenChoice),
        subscriptionAddonLabelI18n: source.subscriptionAddonLabelI18n || undefined,
        resolvedProductNameI18n: source.resolvedProductNameI18n || undefined,
        sourceOfTruth: source.autoDailyAddon ? "subscription.addonBalance" : undefined,
      };
    });
    return {
      ...result,
      addons,
      dailyAddonSummary: {
        total: addons.filter((addon) => addon.autoDailyAddon).length,
        requiresKitchenChoice: addons.filter((addon) => addon.autoDailyAddon && addon.requiresKitchenChoice).length,
        sourceOfTruth: "subscription.addonBalance",
      },
    };
  });
}

function patchOpsReadService(dailyAddonService) {
  const service = require("./dashboard/opsReadServiceV2");
  wrapExport(service, "listOperations", (original) => async function dailyAddonAwareOpsList(args = {}) {
    await dailyAddonService.reconcileDailyAddonsForDate({ date: args.date });
    return original(args);
  });
  wrapExport(service, "getEnrichedDTO", (original) => async function dailyAddonAwareOpsEntity(args = {}) {
    let day = null;
    if (args.entityType === "subscription") {
      day = await SubscriptionDay.findById(args.entityId).select("_id").lean();
    } else if (args.entityType === "subscription_pickup_request") {
      const request = await SubscriptionPickupRequest.findById(args.entityId).lean();
      if (request) {
        day = request.subscriptionDayId
          ? await SubscriptionDay.findById(request.subscriptionDayId).select("_id").lean()
          : await SubscriptionDay.findOne({ subscriptionId: request.subscriptionId, date: request.date }).select("_id").lean();
      }
    }
    if (day) await dailyAddonService.reconcileDayDailyAddonState({ dayId: day._id });
    return original(args);
  });
}

function installSubscriptionDailyAddonPolicy() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  patchSchemas();
  patchCarryoverPricing();

  // The pickup installer loads planner and transition modules. Run it only after
  // schema/pricing authority has been installed so all destructured imports use
  // the pooled add-on policy.
  require("./installPickupMultiCyclePolicy");

  const dailyAddonService = require("./subscription/subscriptionDailyAddonService");
  const pickupAuthority = require("./subscription/subscriptionPickupCycleAuthorityService");

  patchPlanningService(dailyAddonService, pickupAuthority);
  patchPickupRequestService(dailyAddonService);
  patchOpsTransitionService(dailyAddonService);
  patchSkipService(dailyAddonService);
  patchOverviewService(dailyAddonService);
  patchOpsPayloadService();
  patchOpsReadService(dailyAddonService);
}

installSubscriptionDailyAddonPolicy();

module.exports = {
  installSubscriptionDailyAddonPolicy,
  patchSchemas,
};
