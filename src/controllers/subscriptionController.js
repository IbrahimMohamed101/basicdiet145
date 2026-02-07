const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Plan = require("../models/Plan");
const Addon = require("../models/Addon");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Payment = require("../models/Payment");
const Setting = require("../models/Setting");
const {
  getTodayKSADate,
  getTomorrowKSADate,
  isBeforeCutoff,
  isInSubscriptionRange,
  isOnOrAfterKSADate,
  isOnOrAfterTodayKSADate,
  isValidKSADateString,
  toKSADateString,
} = require("../utils/date");
const { canTransition } = require("../utils/state");
const { writeLog } = require("../utils/log");
const { getEffectiveDeliveryDetails } = require("../utils/delivery");
const { createInvoice } = require("../services/moyasarService");
const { fulfillSubscriptionDay } = require("../services/fulfillmentService");
const { applySkipForDate } = require("../services/subscriptionService");
const { logger } = require("../utils/logger");

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

async function calcTotal(plan, premiumCount, addonIds) {
  const premiumPrice = await getSettingValue("premium_price", 20);
  const addonDocs = await Addon.find({ _id: { $in: addonIds } }).lean();

  let addonsSum = 0;
  for (const addon of addonDocs) {
    if (addon.type === "subscription") {
      addonsSum += addon.price * plan.daysCount;
    } else {
      addonsSum += addon.price;
    }
  }

  const total = plan.price + premiumCount * premiumPrice + addonsSum;
  return { total, breakdown: { plan: plan.price, premium: premiumCount * premiumPrice, addons: addonsSum }, premiumPrice, addonDocs };
}

function validateFutureDateOrThrow(date, sub, endDateOverride) {
  if (!isValidKSADateString(date)) {
    const err = new Error("Invalid date format");
    err.code = "INVALID_DATE";
    throw err;
  }
  
  // CR-09 FIX: Add lower bound validation - date must be >= today
  if (!isOnOrAfterTodayKSADate(date)) {
    const err = new Error("Date cannot be in the past");
    err.code = "INVALID_DATE";
    throw err;
  }
  
  const tomorrow = getTomorrowKSADate();
  if (!isOnOrAfterKSADate(date, tomorrow)) {
    const err = new Error("Date must be from tomorrow onward");
    err.code = "INVALID_DATE";
    throw err;
  }
  const endDate = endDateOverride || sub.validityEndDate || sub.endDate;
  if (!isInSubscriptionRange(date, endDate)) {
    const err = new Error("Date outside subscription validity");
    err.code = "INVALID_DATE";
    throw err;
  }
}

function ensureActive(subscription, dateStr) {
  if (subscription.status !== "active") {
    const err = new Error("Subscription not active");
    err.code = "SUB_INACTIVE";
    throw err;
  }
  const endDate = subscription.validityEndDate || subscription.endDate;
  if (endDate) {
    const endStr = toKSADateString(endDate);
    const compareTo = dateStr || getTodayKSADate();
    if (compareTo > endStr) {
      const err = new Error("Subscription expired");
      err.code = "SUB_EXPIRED";
      throw err;
    }
  }
}

function addDaysToKSADateString(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00+03:00`);
  return toKSADateString(addDays(base, days));
}

function mapStatusForClient(status) {
  const map = {
    open: "open",
    locked: "preparing",
    in_preparation: "preparing",
    out_for_delivery: "on_the_way",
    ready_for_pickup: "ready_for_pickup",
    fulfilled: "fulfilled",
    skipped: "skipped"
  };
  return map[status] || status;
}

async function previewSubscription(req, res) {
  const { planId, premiumCount = 0, addons = [] } = req.body || {};
  const plan = await Plan.findById(planId).lean();
  if (!plan) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Plan not found" } });
  }

  const { total, breakdown } = await calcTotal(plan, premiumCount, addons.map((a) => a.addonId));
  return res.status(200).json({ ok: true, data: { total, breakdown } });
}

async function checkoutSubscription(req, res) {
  const {
    planId,
    premiumCount = 0,
    addons = [],
    deliveryMode,
    deliveryAddress,
    deliveryWindow,
    startDate,
  } = req.body || {};

  const plan = await Plan.findById(planId).lean();
  if (!plan) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Plan not found" } });
  }
  if (!deliveryMode) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing deliveryMode" } });
  }
  if (deliveryMode === "delivery") {
    if (!deliveryAddress) {
      return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing deliveryAddress" } });
    }
    const windows = await getSettingValue("delivery_windows", []);
    if (deliveryWindow && windows.length && !windows.includes(deliveryWindow)) {
      return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Invalid delivery window" } });
    }
  }

  const { total, premiumPrice, addonDocs } = await calcTotal(plan, premiumCount, addons.map((a) => a.addonId));
  const totalMeals = plan.daysCount * plan.mealsPerDay;
  const start = startDate ? new Date(startDate) : new Date();
  const end = addDays(start, plan.daysCount - 1);

  const subscription = await Subscription.create({
    userId: req.userId,
    planId,
    status: "pending_payment",
    totalMeals,
    remainingMeals: totalMeals,
    premiumRemaining: premiumCount,
    premiumPrice,
    addonSubscriptions: addonDocs.map((a) => ({
      addonId: a._id,
      name: a.name,
      price: a.price,
      type: a.type,
    })),
    deliveryMode,
    deliveryAddress: deliveryAddress || undefined,
    deliveryWindow: deliveryWindow || undefined,
    startDate: start,
    endDate: end,
    validityEndDate: end,
  });

  return res.status(200).json({
    ok: true,
    data: {
      payment_url: `https://mock-payment.com/${subscription._id}`,
      subscriptionId: subscription.id,
      total,
    },
  });
}

async function activateSubscription(req, res) {
  const { id } = req.params;
  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });

  if (sub.status === "active") return res.status(200).json({ ok: true, message: "Already active" });

  sub.status = "active";
  const start = new Date(sub.startDate);
  sub.endDate = addDays(start, sub.planId.daysCount - 1);
  sub.validityEndDate = sub.endDate;
  await sub.save();

  const dayEntries = [];
  for (let i = 0; i < sub.planId.daysCount; i++) {
    const currentDate = addDays(start, i);
    dayEntries.push({
      subscriptionId: sub._id,
      date: toKSADateString(currentDate),
      status: "open",
    });
  }
  await SubscriptionDay.insertMany(dayEntries);

  res.status(200).json({ ok: true, data: sub });
}

async function getSubscription(req, res) {
  const sub = await Subscription.findById(req.params.id).lean();
  if (!sub) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
  }
  return res.status(200).json({ ok: true, data: sub });
}

async function getSubscriptionDays(req, res) {
  const days = await SubscriptionDay.find({ subscriptionId: req.params.id }).sort({ date: 1 }).lean();
  const mappedDays = days.map(d => ({ ...d, status: mapStatusForClient(d.status) }));
  return res.status(200).json({ ok: true, data: mappedDays });
}

async function getSubscriptionDay(req, res) {
  const day = await SubscriptionDay.findOne({ subscriptionId: req.params.id, date: req.params.date }).lean();
  if (!day) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Day not found" } });
  }
  day.status = mapStatusForClient(day.status);
  return res.status(200).json({ ok: true, data: day });
}

async function getSubscriptionToday(req, res) {
  const today = getTodayKSADate();
  const day = await SubscriptionDay.findOne({ subscriptionId: req.params.id, date: today }).lean();
  if (!day) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Day not found" } });
  }
  day.status = mapStatusForClient(day.status);
  return res.status(200).json({ ok: true, data: day });
}

async function updateDaySelection(req, res) {
  const body = req.body || {};
  const selections = body.selections || [];
  const premiumSelections = body.premiumSelections || [];
  const { id, date } = req.params;
  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
  try {
    ensureActive(sub, date);
    validateFutureDateOrThrow(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return res.status(status).json({ ok: false, error: { code: err.code || "INVALID_DATE", message: err.message } });
  }

  const cutoffTime = await getSettingValue("cutoff_time", "00:00");
  const tomorrow = getTomorrowKSADate();
  if (date === tomorrow && !isBeforeCutoff(cutoffTime)) {
    return res.status(400).json({ ok: false, error: { code: "LOCKED", message: "Cutoff time passed for tomorrow" } });
  }

  const totalSelected = selections.length + premiumSelections.length;
  if (totalSelected > sub.planId.mealsPerDay) {
    return res.status(400).json({
      ok: false,
      error: { code: "DAILY_CAP", message: "Selections exceed meals per day" },
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const existingDay = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    
    // CR-04 FIX: Check for idempotency - if same selections, return early
    if (existingDay && existingDay.status === "open") {
      const existingRegSet = new Set(existingDay.selections.map(s => s.toString()));
      const existingPremSet = new Set(existingDay.premiumSelections.map(s => s.toString()));
      const newRegSet = new Set(selections.map(s => s));
      const newPremSet = new Set(premiumSelections.map(s => s));
      
      const setsEqual = (a, b) => a.size === b.size && [...a].every(value => b.has(value));
      
      if (setsEqual(existingRegSet, newRegSet) && setsEqual(existingPremSet, newPremSet)) {
        await session.commitTransaction();
        session.endSession();
        return res.status(200).json({ ok: true, data: existingDay, idempotent: true });
      }
    }
    
    if (existingDay && existingDay.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ ok: false, error: { code: "LOCKED", message: "Day is locked" } });
    }

    const prevPremium = existingDay ? existingDay.premiumSelections.length : 0;
    const diff = premiumSelections.length - prevPremium;

    // CR-04 FIX: Atomic premium deduction with conditional update (hard enforcement)
    let premiumUpdateSuccess = true;
    if (diff > 0) {
      const updateRes = await Subscription.updateOne(
        { _id: id, premiumRemaining: { $gte: diff } },
        { $inc: { premiumRemaining: -diff } },
        { session }
      );
      if (!updateRes.modifiedCount) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          ok: false, 
          error: { code: "INSUFFICIENT_PREMIUM", message: "Not enough premium credits" } 
        });
      }
    } else if (diff < 0) {
      // Refund premium when removing selections
      await Subscription.updateOne(
        { _id: id },
        { $inc: { premiumRemaining: -diff } },
        { session }
      );
    }

    const update = { selections, premiumSelections };
    if (body.addonsOneTime !== undefined) {
      update.addonsOneTime = body.addonsOneTime;
    }

    const day = await SubscriptionDay.findOneAndUpdate(
      { subscriptionId: id, date: date },
      update,
      { upsert: true, new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "subscription_day",
      entityId: day._id,
      action: "day_selection_update",
      byUserId: req.userId,
      byRole: "client",
      meta: { date, selectionsCount: selections.length, premiumCount: premiumSelections.length },
    });
    return res.status(200).json({ ok: true, data: day });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Selection failed" } });
  }
}

async function lockDaySnapshot(sub, day, session) {
  if (day.lockedSnapshot) return day.lockedSnapshot;
  const { address, deliveryWindow } = getEffectiveDeliveryDetails(sub, day);
  const snapshot = {
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
    mealsPerDay: sub.totalMeals ? Math.ceil(sub.totalMeals / sub.planId.daysCount) : sub.planId.mealsPerDay,
  };
  day.lockedSnapshot = snapshot;
  day.lockedAt = new Date();
  await day.save({ session });
  return snapshot;
}


async function skipDay(req, res) {
  const { id, date } = req.params;
  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
  try {
    ensureActive(sub, date);
    validateFutureDateOrThrow(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return res.status(status).json({ ok: false, error: { code: err.code || "INVALID_DATE", message: err.message } });
  }

  const cutoffTime = await getSettingValue("cutoff_time", "00:00");
  const tomorrow = getTomorrowKSADate();
  if (date === tomorrow && !isBeforeCutoff(cutoffTime)) {
    return res.status(400).json({ ok: false, error: { code: "LOCKED", message: "Cutoff time passed for tomorrow" } });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
    }
    if (subInSession.status !== "active") {
      await session.abortTransaction();
      session.endSession();
      return res.status(422).json({ ok: false, error: { code: "SUB_INACTIVE", message: "Subscription not active" } });
    }

    const result = await applySkipForDate({ sub: subInSession, date, session });

    if (result.status === "already_skipped") {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true, data: result.day });
    }
    if (result.status === "locked") {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ ok: false, error: { code: "LOCKED", message: "Cannot skip after lock" } });
    }
    if (result.status === "insufficient_credits") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, error: { code: "INSUFFICIENT_CREDITS", message: "Not enough credits" } });
    }
    if (result.status !== "skipped") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Skip failed" } });
    }

    await session.commitTransaction();
    session.endSession();
    await writeLog({
      entityType: "subscription_day",
      entityId: result.day._id,
      action: "skip",
      byUserId: req.userId,
      byRole: "client",
      meta: { compensated: Boolean(result.compensatedDateAdded), date: result.day.date },
    });
    return res.status(200).json({ ok: true, data: result.day });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Skip failed" } });
  }
}

async function skipRange(req, res) {
  const { id } = req.params;
  const { startDate, days } = req.body || {};
  const rangeDays = parseInt(days, 10);

  if (!startDate || !isValidKSADateString(startDate)) {
    return res.status(400).json({ ok: false, error: { code: "INVALID_DATE", message: "Invalid startDate" } });
  }
  if (!rangeDays || rangeDays <= 0) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Invalid days count" } });
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
  try {
    ensureActive(sub);
  } catch (err) {
    return res.status(422).json({ ok: false, error: { code: err.code, message: err.message } });
  }

  const tomorrow = getTomorrowKSADate();
  if (!isOnOrAfterKSADate(startDate, tomorrow)) {
    return res.status(400).json({ ok: false, error: { code: "INVALID_DATE", message: "startDate must be from tomorrow onward" } });
  }

  const cutoffTime = await getSettingValue("cutoff_time", "00:00");
  const baseEndDate = sub.validityEndDate || sub.endDate;
  const summary = {
    skippedDates: [],
    compensatedDatesAdded: [],
    alreadySkipped: [],
    rejected: [],
  };
  const skippedForLog = [];

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
    }

    for (let i = 0; i < rangeDays; i++) {
      const dateStr = addDaysToKSADateString(startDate, i);
      if (!isOnOrAfterKSADate(dateStr, tomorrow)) {
        summary.rejected.push({ date: dateStr, reason: "BEFORE_TOMORROW" });
        continue;
      }
      if (!isInSubscriptionRange(dateStr, baseEndDate)) {
        summary.rejected.push({ date: dateStr, reason: "OUTSIDE_VALIDITY" });
        continue;
      }
      if (dateStr === tomorrow && !isBeforeCutoff(cutoffTime)) {
        summary.rejected.push({ date: dateStr, reason: "CUTOFF_PASSED" });
        continue;
      }

      const result = await applySkipForDate({ sub: subInSession, date: dateStr, session });
      if (result.status === "already_skipped") {
        summary.alreadySkipped.push(dateStr);
        continue;
      }
      if (result.status === "locked") {
        summary.rejected.push({ date: dateStr, reason: "LOCKED" });
        continue;
      }
      if (result.status === "insufficient_credits") {
        summary.rejected.push({ date: dateStr, reason: "INSUFFICIENT_CREDITS" });
        continue;
      }
      if (result.status !== "skipped") {
        summary.rejected.push({ date: dateStr, reason: "UNKNOWN" });
        continue;
      }

      summary.skippedDates.push(dateStr);
      if (result.compensatedDateAdded) {
        summary.compensatedDatesAdded.push(result.compensatedDateAdded);
      }
      skippedForLog.push({ dayId: result.day._id, date: result.day.date, compensated: Boolean(result.compensatedDateAdded) });
    }

    await session.commitTransaction();
    session.endSession();

    for (const item of skippedForLog) {
      await writeLog({
        entityType: "subscription_day",
        entityId: item.dayId,
        action: "skip",
        byUserId: req.userId,
        byRole: "client",
        meta: { compensated: item.compensated, date: item.date },
      });
    }

    return res.status(200).json({ ok: true, data: summary });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Skip range failed" } });
  }
}

async function topupPremium(_req, res) {
  try {
    const { id } = _req.params;
    const { count, successUrl, backUrl } = _req.body || {};
    const premiumCount = parseInt(count, 10);
    if (!premiumCount || premiumCount <= 0) {
      return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Invalid premium count" } });
    }

    const sub = await Subscription.findById(id);
    if (!sub) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
    try {
      ensureActive(sub);
    } catch (err) {
      return res.status(422).json({ ok: false, error: { code: err.code, message: err.message } });
    }

    const premiumPrice = await getSettingValue("premium_price", 20);
    const amount = Math.round(premiumPrice * premiumCount * 100);
    const appUrl = process.env.APP_URL || "https://example.com";

    const invoice = await createInvoice({
      amount,
      description: `Premium top-up (${premiumCount})`,
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: successUrl || `${appUrl}/payments/success`,
      backUrl: backUrl || `${appUrl}/payments/cancel`,
      metadata: {
        type: "premium_topup",
        subscriptionId: String(sub._id),
        userId: String(_req.userId),
        premiumCount,
      },
    });

    const payment = await Payment.create({
      provider: "moyasar",
      type: "premium_topup",
      status: "initiated",
      amount,
      currency: invoice.currency || "SAR",
      userId: _req.userId,
      subscriptionId: sub._id,
      providerInvoiceId: invoice.id,
      metadata: invoice.metadata || {},
    });

    return res.status(200).json({
      ok: true,
      data: { payment_url: invoice.url, invoice_id: invoice.id, payment_id: payment.id },
    });
  } catch (err) {
    logger.error("Topup error", { error: err.message, stack: err.stack });
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Top-up failed" } });
  }
}

async function addOneTimeAddon(_req, res) {
  try {
    const { id } = _req.params;
    const { addonId, date, successUrl, backUrl } = _req.body || {};
    if (!addonId || !date) {
      return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing addonId or date" } });
    }

    const sub = await Subscription.findById(id).populate("planId");
    if (!sub) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
    try {
      ensureActive(sub, date);
      validateFutureDateOrThrow(date, sub);
    } catch (err) {
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return res.status(status).json({ ok: false, error: { code: err.code || "INVALID_DATE", message: err.message } });
    }

    const addon = await Addon.findById(addonId).lean();
    if (!addon || addon.type !== "one_time" || addon.isActive === false) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Addon not found" } });
    }

    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
    if (day && day.status !== "open") {
      return res.status(409).json({ ok: false, error: { code: "LOCKED", message: "Day is locked" } });
    }

    const amount = Math.round(addon.price * 100);
    const appUrl = process.env.APP_URL || "https://example.com";

    const invoice = await createInvoice({
      amount,
      description: `Add-on (${addon.name})`,
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: successUrl || `${appUrl}/payments/success`,
      backUrl: backUrl || `${appUrl}/payments/cancel`,
      metadata: {
        type: "one_time_addon",
        subscriptionId: String(sub._id),
        userId: String(_req.userId),
        addonId: String(addon._id),
        date,
      },
    });

    const payment = await Payment.create({
      provider: "moyasar",
      type: "one_time_addon",
      status: "initiated",
      amount,
      currency: invoice.currency || "SAR",
      userId: _req.userId,
      subscriptionId: sub._id,
      providerInvoiceId: invoice.id,
      metadata: invoice.metadata || {},
    });

    return res.status(200).json({
      ok: true,
      data: { payment_url: invoice.url, invoice_id: invoice.id, payment_id: payment.id },
    });
  } catch (err) {
    logger.error("Addon error", { error: err.message, stack: err.stack });
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Addon purchase failed" } });
  }
}

async function preparePickup(req, res) {
  const { id, date } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).populate("planId").session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
    }

    try {
      ensureActive(sub, date);
      validateFutureDateOrThrow(date, sub);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return res.status(status).json({ ok: false, error: { code: err.code || "INVALID_DATE", message: err.message } });
    }

    const cutoffTime = await getSettingValue("cutoff_time", "00:00");
    const tomorrow = getTomorrowKSADate();
    if (date === tomorrow && !isBeforeCutoff(cutoffTime)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, error: { code: "LOCKED", message: "Cutoff time passed for tomorrow" } });
    }

    if (sub.deliveryMode !== "pickup") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Delivery mode is not pickup" } });
    }

    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    
    // CR-03 FIX: Check if already processed (idempotency)
    if (day && day.pickupRequested) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true, data: day });
    }
    
    if (day && day.creditsDeducted) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true, data: day });
    }

    if (day && !canTransition(day.status, "locked")) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ ok: false, error: { code: "INVALID_TRANSITION", message: "Invalid state transition" } });
    }

    const mealsToDeduct = sub.planId.mealsPerDay;

    let updatedDay;
    if (!day) {
      const created = await SubscriptionDay.create([{
        subscriptionId: id,
        date,
        pickupRequested: true,
        status: "locked",
        creditsDeducted: true
      }], { session });
      updatedDay = created[0];
    } else {
      updatedDay = await SubscriptionDay.findOneAndUpdate(
        { _id: day._id, status: { $in: ["open", null] } },
        { $set: { pickupRequested: true, status: "locked", creditsDeducted: true } },
        { new: true, session }
      );
      if (!updatedDay) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ ok: false, error: { code: "LOCKED", message: "Day already locked" } });
      }
    }

    // Capture Snapshot (Rule requirement)
    await lockDaySnapshot(sub, updatedDay, session);

    // CR-03 FIX: Atomic credit deduction with conditional update
    const subUpdate = await Subscription.updateOne(
      { _id: id, remainingMeals: { $gte: mealsToDeduct } },
      { $inc: { remainingMeals: -mealsToDeduct } },
      { session }
    );

    if (!subUpdate.modifiedCount) {
      // Rollback day update
      await SubscriptionDay.updateOne(
        { _id: updatedDay._id },
        { $set: { pickupRequested: false, status: "open", creditsDeducted: false } },
        { session }
      );
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, error: { code: "INSUFFICIENT_CREDITS", message: "Not enough credits" } });
    }

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "subscription_day",
      entityId: updatedDay._id,
      action: "pickup_prepare",
      byUserId: req.userId,
      byRole: "client",
      meta: { date: updatedDay.date, deductedCredits: mealsToDeduct },
    });
    return res.status(200).json({ ok: true, data: updatedDay });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("Pickup prepare failed", { error: err.message, stack: err.stack });
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Pickup prepare failed" } });
  }
}

async function updateDeliveryDetails(req, res) {
  const { id } = req.params;
  const { deliveryAddress, deliveryWindow } = req.body || {};
  if (!deliveryAddress && !deliveryWindow) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing delivery update fields" } });
  }

  const sub = await Subscription.findById(id);
  if (!sub) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
  try {
    ensureActive(sub);
  } catch (err) {
    return res.status(422).json({ ok: false, error: { code: err.code, message: err.message } });
  }
  if (sub.deliveryMode !== "delivery") {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Delivery mode is not delivery" } });
  }

  const windows = await getSettingValue("delivery_windows", []);
  if (deliveryWindow && windows.length && !windows.includes(deliveryWindow)) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Invalid delivery window" } });
  }

  sub.deliveryAddress = deliveryAddress || sub.deliveryAddress;
  sub.deliveryWindow = deliveryWindow || sub.deliveryWindow;
  await sub.save();
  await writeLog({
    entityType: "subscription",
    entityId: sub._id,
    action: "delivery_update",
    byUserId: req.userId,
    byRole: "client",
    meta: { deliveryWindow: sub.deliveryWindow },
  });
  return res.status(200).json({ ok: true, data: sub });
}

async function updateDeliveryDetailsForDate(req, res) {
  const { id, date } = req.params;
  const { deliveryAddress, deliveryWindow } = req.body || {};
  if (deliveryAddress === undefined && deliveryWindow === undefined) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing delivery update fields" } });
  }

  const sub = await Subscription.findById(id);
  if (!sub) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
  try {
    ensureActive(sub, date);
    validateFutureDateOrThrow(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return res.status(status).json({ ok: false, error: { code: err.code || "INVALID_DATE", message: err.message } });
  }

  const cutoffTime = await getSettingValue("cutoff_time", "00:00");
  const tomorrow = getTomorrowKSADate();
  if (date === tomorrow && !isBeforeCutoff(cutoffTime)) {
    return res.status(400).json({ ok: false, error: { code: "LOCKED", message: "Cutoff time passed for tomorrow" } });
  }

  if (sub.deliveryMode !== "delivery") {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Delivery mode is not delivery" } });
  }

  const windows = await getSettingValue("delivery_windows", []);
  if (deliveryWindow && windows.length && !windows.includes(deliveryWindow)) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Invalid delivery window" } });
  }

  const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
  if (day && day.status !== "open") {
    return res.status(409).json({ ok: false, error: { code: "LOCKED", message: "Day is locked" } });
  }

  const update = {};
  if (deliveryAddress !== undefined) update.deliveryAddressOverride = deliveryAddress;
  if (deliveryWindow !== undefined) update.deliveryWindowOverride = deliveryWindow;

  const updatedDay = await SubscriptionDay.findOneAndUpdate(
    { subscriptionId: id, date },
    { $set: update },
    { upsert: true, new: true }
  );

  await writeLog({
    entityType: "subscription_day",
    entityId: updatedDay._id,
    action: "delivery_update_day",
    byUserId: req.userId,
    byRole: "client",
    meta: { date, deliveryWindow: updatedDay.deliveryWindowOverride },
  });

  return res.status(200).json({ ok: true, data: updatedDay });
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

    const sub = await Subscription.findById(id).populate("planId").session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
    }

    if (toStatus === "locked") {
      await lockDaySnapshot(sub, day, session);
    }

    day.status = toStatus;
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ ok: true, data: day });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Transition failed" } });
  }
}

async function fulfillDay(req, res) {
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
    return res.status(200).json({ ok: true, data: result.day, alreadyFulfilled: result.alreadyFulfilled });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Fulfillment failed" } });
  }
}

module.exports = {
  previewSubscription,
  checkoutSubscription,
  activateSubscription,
  getSubscription,
  getSubscriptionDays,
  getSubscriptionToday,
  getSubscriptionDay,
  updateDaySelection,
  skipDay,
  skipRange,
  topupPremium,
  addOneTimeAddon,
  preparePickup,
  updateDeliveryDetails,
  updateDeliveryDetailsForDate,
  transitionDay,
  fulfillDay,
};
