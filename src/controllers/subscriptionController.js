const crypto = require("crypto");
const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Plan = require("../models/Plan");
const PremiumMeal = require("../models/PremiumMeal");
const Addon = require("../models/Addon");
const CheckoutDraft = require("../models/CheckoutDraft");
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
const { applySkipForDate, enforceSkipAllowanceOrThrow } = require("../services/subscriptionService");
const { logger } = require("../utils/logger");
const { getRequestLang, pickLang } = require("../utils/i18n");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../utils/subscriptionDaySelectionSync");
const {
  LEGACY_PREMIUM_MEAL_BUCKET_ID,
  syncPremiumRemainingFromBalance,
  ensureLegacyPremiumBalanceFromRemaining,
} = require("../utils/premiumWallet");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

const SYSTEM_CURRENCY = "SAR";
const LEGACY_DAY_PREMIUM_SLOT_PREFIX = "legacy_day_premium_slot_";

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function parsePositiveInteger(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInteger(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function normalizeCurrencyValue(value) {
  return String(value || SYSTEM_CURRENCY).trim().toUpperCase();
}

function assertSystemCurrencyOrThrow(value, fieldName) {
  const currency = normalizeCurrencyValue(value);
  if (currency !== SYSTEM_CURRENCY) {
    const err = new Error(`${fieldName} must be ${SYSTEM_CURRENCY}`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return currency;
}

function parseIdempotencyKey(rawValue) {
  if (rawValue === undefined || rawValue === null) return "";
  const value = String(rawValue).trim();
  if (!value) return "";
  if (value.length > 128) {
    const err = new Error("idempotencyKey must be at most 128 characters");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return value;
}

function buildCheckoutRequestHash({ userId, quote }) {
  const premiumItems = (quote.premiumItems || [])
    .map((item) => ({
      id: String(item.premiumMeal && item.premiumMeal._id ? item.premiumMeal._id : item.premiumMealId || ""),
      qty: Number(item.qty || 0),
      unitExtraFeeHalala: Number(item.unitExtraFeeHalala || 0),
      currency: normalizeCurrencyValue(item.premiumMeal && item.premiumMeal.currency ? item.premiumMeal.currency : item.currency),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const addonItems = (quote.addonItems || [])
    .map((item) => ({
      id: String(item.addon && item.addon._id ? item.addon._id : item.addonId || ""),
      qty: Number(item.qty || 0),
      unitPriceHalala: Number(item.unitPriceHalala || 0),
      currency: normalizeCurrencyValue(item.addon && item.addon.currency ? item.addon.currency : item.currency),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const canonicalPayload = {
    userId: String(userId),
    planId: String(quote.plan && quote.plan._id ? quote.plan._id : ""),
    planCurrency: normalizeCurrencyValue(quote.plan && quote.plan.currency),
    daysCount: Number(quote.plan && quote.plan.daysCount ? quote.plan.daysCount : 0),
    grams: Number(quote.grams || 0),
    mealsPerDay: Number(quote.mealsPerDay || 0),
    startDate: quote.startDate ? new Date(quote.startDate).toISOString() : null,
    delivery: {
      type: quote.delivery && quote.delivery.type ? quote.delivery.type : "delivery",
      slotType:
        quote.delivery && quote.delivery.slot && quote.delivery.slot.type
          ? quote.delivery.slot.type
          : "delivery",
      window:
        quote.delivery && quote.delivery.slot && quote.delivery.slot.window
          ? String(quote.delivery.slot.window)
          : "",
      slotId:
        quote.delivery && quote.delivery.slot && quote.delivery.slot.slotId
          ? String(quote.delivery.slot.slotId)
          : "",
      address: quote.delivery && quote.delivery.address ? quote.delivery.address : null,
    },
    premiumItems,
    addonItems,
    breakdown: {
      basePlanPriceHalala: Number(quote.breakdown.basePlanPriceHalala || 0),
      premiumTotalHalala: Number(quote.breakdown.premiumTotalHalala || 0),
      addonsTotalHalala: Number(quote.breakdown.addonsTotalHalala || 0),
      deliveryFeeHalala: Number(quote.breakdown.deliveryFeeHalala || 0),
      vatHalala: Number(quote.breakdown.vatHalala || 0),
      totalHalala: Number(quote.breakdown.totalHalala || 0),
    },
  };

  return crypto.createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
}

function buildCheckoutReusePayload(draft, payment) {
  return {
    subscriptionId: draft.subscriptionId ? String(draft.subscriptionId) : null,
    draftId: String(draft._id),
    paymentId: payment ? String(payment._id) : (draft.paymentId ? String(draft.paymentId) : null),
    payment_url: draft.paymentUrl || "",
    totals: draft.breakdown,
    reused: true,
  };
}

function isPendingCheckoutReusable(draft, payment) {
  const hasPaymentUrl = Boolean(draft && draft.paymentUrl && String(draft.paymentUrl).trim());
  return Boolean(
    draft
    && draft.status === "pending_payment"
    && payment
    && payment.status === "initiated"
    && payment.applied !== true
    && hasPaymentUrl
  );
}

function resolveAddonUnitPriceHalala(addon) {
  if (Number.isInteger(addon.priceHalala) && addon.priceHalala >= 0) {
    return addon.priceHalala;
  }
  const parsedPrice = Number(addon.price);
  if (Number.isFinite(parsedPrice) && parsedPrice >= 0) {
    return Math.round(parsedPrice * 100);
  }
  return 0;
}

function toPremiumWalletRowsFIFO(sub) {
  const rows = Array.isArray(sub && sub.premiumBalance) ? sub.premiumBalance : [];
  return rows
    .filter((row) => Number(row && row.remainingQty) > 0)
    .sort((a, b) => new Date(a.purchasedAt || 0).getTime() - new Date(b.purchasedAt || 0).getTime());
}

function parseLegacyDayPremiumSlotIndex(baseSlotKey) {
  const raw = String(baseSlotKey || "");
  if (!raw.startsWith(LEGACY_DAY_PREMIUM_SLOT_PREFIX)) return null;
  const value = Number(raw.slice(LEGACY_DAY_PREMIUM_SLOT_PREFIX.length));
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function getLegacyDayPremiumSelections(sub, { dayId, date }) {
  const rows = Array.isArray(sub && sub.premiumSelections) ? sub.premiumSelections : [];
  const expectedDayId = dayId ? String(dayId) : null;
  return rows.filter((row) => {
    const slotKey = String(row && row.baseSlotKey ? row.baseSlotKey : "");
    if (!slotKey.startsWith(LEGACY_DAY_PREMIUM_SLOT_PREFIX)) return false;
    if (expectedDayId && row.dayId && String(row.dayId) === expectedDayId) return true;
    return Boolean(row.date && date && String(row.date) === String(date));
  });
}

function getNextLegacyDayPremiumSlotIndex(existingRows) {
  const maxIndex = existingRows.reduce((max, row) => {
    const parsed = parseLegacyDayPremiumSlotIndex(row && row.baseSlotKey);
    if (parsed === null) return max;
    return parsed > max ? parsed : max;
  }, -1);
  return maxIndex + 1;
}

function consumePremiumBalanceFifoRows(sub, qty) {
  const rows = toPremiumWalletRowsFIFO(sub);
  const available = rows.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
  if (available < qty) {
    return null;
  }

  const consumed = [];
  let remaining = qty;
  for (const row of rows) {
    if (remaining <= 0) break;
    const rowAvailable = Number(row.remainingQty || 0);
    if (rowAvailable <= 0) continue;
    const used = Math.min(rowAvailable, remaining);
    row.remainingQty = rowAvailable - used;
    remaining -= used;
    for (let i = 0; i < used; i += 1) {
      consumed.push({
        premiumMealId: row.premiumMealId,
        unitExtraFeeHalala: Number(row.unitExtraFeeHalala || 0),
        currency: row.currency || SYSTEM_CURRENCY,
      });
    }
  }
  return consumed;
}

function logWalletIntegrityError(context, meta = {}) {
  logger.error("Wallet integrity error", { context, ...meta });
}

function refundPremiumSelectionRowsToBalanceOrThrow(sub, selections) {
  for (const selection of selections) {
    const match = (sub.premiumBalance || [])
      .find(
        (row) =>
          String(row.premiumMealId) === String(selection.premiumMealId)
          && Number(row.unitExtraFeeHalala || 0) === Number(selection.unitExtraFeeHalala || 0)
          && String(row.currency || SYSTEM_CURRENCY).toUpperCase()
            === String(selection.currency || SYSTEM_CURRENCY).toUpperCase()
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

function normalizeSlotInput(slot = {}) {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
    return { type: "delivery", window: "", slotId: "" };
  }
  const type = slot.type && ["delivery", "pickup"].includes(slot.type) ? slot.type : "delivery";
  return {
    type,
    window: slot.window === undefined || slot.window === null ? "" : String(slot.window).trim(),
    slotId: slot.slotId === undefined || slot.slotId === null ? "" : String(slot.slotId).trim(),
  };
}

function normalizeCheckoutItemsOrThrow(rawItems, idField, itemName) {
  if (rawItems === undefined || rawItems === null) {
    return [];
  }
  if (!Array.isArray(rawItems)) {
    const err = new Error(`${itemName} must be an array`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const byId = new Map();
  for (const item of rawItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      const err = new Error(`${itemName} must contain objects`);
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const itemId = item[idField];
    try {
      validateObjectId(itemId, idField);
    } catch (_err) {
      const err = new Error(`${idField} must be a valid ObjectId`);
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const qty = parsePositiveInteger(item.qty);
    if (!qty) {
      const err = new Error(`qty must be a positive integer for ${itemName}`);
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    byId.set(String(itemId), (byId.get(String(itemId)) || 0) + qty);
  }

  return Array.from(byId.entries()).map(([id, qty]) => ({ id, qty }));
}

function resolveDeliveryInput(payload = {}) {
  const delivery = payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const type = delivery.type || payload.deliveryMode || (delivery.slot && delivery.slot.type) || "delivery";
  const normalizedType = ["delivery", "pickup"].includes(type) ? type : null;
  if (!normalizedType) {
    const err = new Error("delivery.type must be one of: delivery, pickup");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const address = delivery.address || payload.deliveryAddress || null;
  const slot = normalizeSlotInput(delivery.slot || { type: normalizedType, window: delivery.window || payload.deliveryWindow });
  if (!slot.type) {
    slot.type = normalizedType;
  }
  if (slot.type !== normalizedType) {
    slot.type = normalizedType;
  }
  return { type: normalizedType, address, slot };
}

async function resolveCheckoutQuoteOrThrow(payload, { enforceActivePlan = true } = {}) {
  const planId = payload && payload.planId;
  try {
    validateObjectId(planId, "planId");
  } catch (_err) {
    const err = new Error("planId must be a valid ObjectId");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const grams = parsePositiveInteger(payload.grams);
  if (!grams) {
    const err = new Error("grams must be a positive integer");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const mealsPerDay = parsePositiveInteger(payload.mealsPerDay);
  if (!mealsPerDay) {
    const err = new Error("mealsPerDay must be a positive integer");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const delivery = resolveDeliveryInput(payload || {});
  const startValidation = parseFutureStartDate(payload.startDate);
  if (!startValidation.ok) {
    const err = new Error(startValidation.message);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const planQuery = { _id: planId };
  if (enforceActivePlan) {
    planQuery.isActive = true;
  }
  const plan = await Plan.findOne(planQuery).lean();
  if (!plan) {
    const err = new Error("Plan not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const planCurrency = assertSystemCurrencyOrThrow(plan.currency || SYSTEM_CURRENCY, "Plan currency");

  const gramsOptions = Array.isArray(plan.gramsOptions) ? plan.gramsOptions : [];
  const gramsOption = gramsOptions.find((item) => item && item.grams === grams && item.isActive !== false);
  if (!gramsOption) {
    const err = new Error("Selected grams option is not available");
    err.code = "INVALID_SELECTION";
    throw err;
  }

  const mealsOptions = Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [];
  const mealOption = mealsOptions.find((item) => item && item.mealsPerDay === mealsPerDay && item.isActive !== false);
  if (!mealOption) {
    const err = new Error("Selected mealsPerDay option is not available");
    err.code = "INVALID_SELECTION";
    throw err;
  }

  const basePlanPriceHalala = parseNonNegativeInteger(mealOption.priceHalala);
  if (basePlanPriceHalala === null) {
    const err = new Error("Plan price is invalid");
    err.code = "INVALID_SELECTION";
    throw err;
  }

  const premiumItems = normalizeCheckoutItemsOrThrow(payload.premiumItems, "premiumMealId", "premiumItems");
  const addonItems = normalizeCheckoutItemsOrThrow(payload.addons, "addonId", "addons");

  const premiumIds = premiumItems.map((item) => item.id);
  const addonIds = addonItems.map((item) => item.id);

  const [premiumDocs, addonDocs] = await Promise.all([
    premiumIds.length ? PremiumMeal.find({ _id: { $in: premiumIds }, isActive: true }).lean() : Promise.resolve([]),
    addonIds.length ? Addon.find({ _id: { $in: addonIds }, isActive: true }).lean() : Promise.resolve([]),
  ]);

  const premiumById = new Map(premiumDocs.map((doc) => [String(doc._id), doc]));
  const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));

  let premiumTotalHalala = 0;
  const resolvedPremiumItems = [];
  for (const item of premiumItems) {
    const doc = premiumById.get(item.id);
    if (!doc) {
      const err = new Error(`Premium meal ${item.id} not found or inactive`);
      err.code = "NOT_FOUND";
      throw err;
    }
    const unit = parseNonNegativeInteger(doc.extraFeeHalala);
    if (unit === null) {
      const err = new Error(`Premium meal ${item.id} has invalid price`);
      err.code = "INVALID_SELECTION";
      throw err;
    }
    assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Premium meal ${item.id} currency`);
    premiumTotalHalala += unit * item.qty;
    resolvedPremiumItems.push({ premiumMeal: doc, qty: item.qty, unitExtraFeeHalala: unit, currency: SYSTEM_CURRENCY });
  }

  let addonsTotalHalala = 0;
  const resolvedAddonItems = [];
  for (const item of addonItems) {
    const doc = addonById.get(item.id);
    if (!doc) {
      const err = new Error(`Addon ${item.id} not found or inactive`);
      err.code = "NOT_FOUND";
      throw err;
    }
    const unit = resolveAddonUnitPriceHalala(doc);
    assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Addon ${item.id} currency`);
    addonsTotalHalala += unit * item.qty;
    resolvedAddonItems.push({ addon: doc, qty: item.qty, unitPriceHalala: unit, currency: SYSTEM_CURRENCY });
  }

  const windows = await getSettingValue("delivery_windows", []);
  if (delivery.slot.window && Array.isArray(windows) && windows.length && !windows.includes(delivery.slot.window)) {
    const err = new Error("Invalid delivery window");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  if (delivery.type === "delivery" && !delivery.address) {
    const err = new Error("Missing delivery address");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  let deliveryFeeHalala = 0;
  if (delivery.type === "delivery") {
    const configuredFee = parseNonNegativeInteger(await getSettingValue("subscription_delivery_fee_halala", null));
    if (configuredFee !== null) {
      deliveryFeeHalala = configuredFee;
    } else {
      const err = new Error("Server delivery fee configuration is missing");
      err.code = "VALIDATION_ERROR";
      throw err;
    }
  }

  const subtotalHalala = basePlanPriceHalala + premiumTotalHalala + addonsTotalHalala + deliveryFeeHalala;
  const vatPercentageRaw = await getSettingValue("vat_percentage", null);
  const vatPercentage = Number(vatPercentageRaw);
  const vatHalala = Number.isFinite(vatPercentage) && vatPercentage > 0
    ? Math.round((subtotalHalala * vatPercentage) / 100)
    : 0;
  const totalHalala = subtotalHalala + vatHalala;

  return {
    plan,
    grams,
    mealsPerDay,
    startDate: startValidation.value,
    delivery,
    premiumItems: resolvedPremiumItems,
    addonItems: resolvedAddonItems,
    breakdown: {
      basePlanPriceHalala,
      premiumTotalHalala,
      addonsTotalHalala,
      deliveryFeeHalala,
      vatHalala,
      totalHalala,
      currency: planCurrency,
    },
  };
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

function sendValidationError(res, message) {
  // MEDIUM AUDIT FIX: Normalize client input failures under a controlled 400 VALIDATION_ERROR response shape.
  return errorResponse(res, 400, "VALIDATION_ERROR", message);
}

async function writeLogSafely(payload, context = {}) {
  try {
    await writeLog(payload);
  } catch (err) {
    logger.error("Activity log write failed", {
      error: err.message,
      stack: err.stack,
      action: payload && payload.action ? payload.action : undefined,
      entityType: payload && payload.entityType ? payload.entityType : undefined,
      entityId: payload && payload.entityId ? String(payload.entityId) : undefined,
      ...context,
    });
  }
}

function parsePremiumCount(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseFutureStartDate(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { ok: true, value: null };
  }
  const normalized = String(rawValue).trim();
  const bareDateMatch = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const parsed = bareDateMatch
    ? new Date(`${normalized}T00:00:00+03:00`)
    : new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: "startDate must be a valid date" };
  }
  const parsedDate = toKSADateString(parsed);
  const tomorrow = getTomorrowKSADate();
  if (!isOnOrAfterKSADate(parsedDate, tomorrow)) {
    return { ok: false, message: "startDate must be a future date" };
  }
  return { ok: true, value: parsed };
}

async function enforceTomorrowCutoffOrThrow(dateStr) {
  // MEDIUM AUDIT FIX: Centralize tomorrow cutoff validation to avoid bypasses across endpoints.
  const cutoffTime = await getSettingValue("cutoff_time", "00:00");
  const tomorrow = getTomorrowKSADate();
  if (dateStr === tomorrow && !isBeforeCutoff(cutoffTime)) {
    const err = new Error("Cutoff time passed for tomorrow");
    err.code = "LOCKED";
    throw err;
  }
}

function hasDeliveryAddressOverride(day) {
  return Boolean(day && day.deliveryAddressOverride && Object.keys(day.deliveryAddressOverride).length > 0);
}

function hasDeliveryWindowOverride(day) {
  return Boolean(day && day.deliveryWindowOverride);
}

async function quoteSubscription(req, res) {
  try {
    const quote = await resolveCheckoutQuoteOrThrow(req.body || {});
    return res.status(200).json({
      ok: true,
      data: {
        breakdown: quote.breakdown,
        totalSar: quote.breakdown.totalHalala / 100,
      },
    });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    if (err.code === "NOT_FOUND") {
      return errorResponse(res, 404, "NOT_FOUND", err.message);
    }
    if (err.code === "INVALID_SELECTION") {
      return errorResponse(res, 400, "INVALID", err.message);
    }
    throw err;
  }
}

async function previewSubscription(req, res) {
  return quoteSubscription(req, res);
}

async function checkoutSubscription(req, res) {
  let draft;
  let idempotencyKey = "";
  let requestHash = "";
  try {
    const body = req.body || {};
    idempotencyKey = parseIdempotencyKey(
      req.get("Idempotency-Key")
      || req.get("X-Idempotency-Key")
      || body.idempotencyKey
    );
    if (!idempotencyKey) {
      return sendValidationError(
        res,
        "idempotencyKey is required (Idempotency-Key header, X-Idempotency-Key header, or body.idempotencyKey)"
      );
    }
    const quote = await resolveCheckoutQuoteOrThrow(body);
    requestHash = buildCheckoutRequestHash({ userId: req.userId, quote });
    const lang = getRequestLang(req);

    const existingByKey = await CheckoutDraft.findOne({
      userId: req.userId,
      idempotencyKey,
    }).sort({ createdAt: -1 }).lean();

    if (existingByKey) {
      if (existingByKey.requestHash && existingByKey.requestHash !== requestHash) {
        return errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          "idempotencyKey is already used with a different checkout payload"
        );
      }

      const existingPayment = existingByKey.paymentId
        ? await Payment.findById(existingByKey.paymentId).lean()
        : null;
      if (isPendingCheckoutReusable(existingByKey, existingPayment)) {
        return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(existingByKey, existingPayment) });
      }

      if (existingByKey.status === "pending_payment") {
        return errorResponse(
          res,
          409,
          "CHECKOUT_IN_PROGRESS",
          "Checkout initialization is still in progress. Retry with the same idempotency key.",
          { draftId: String(existingByKey._id) }
        );
      }

      if (existingByKey.status === "completed") {
        return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(existingByKey, existingPayment) });
      }

      return errorResponse(
        res,
        409,
        "IDEMPOTENCY_CONFLICT",
        `idempotencyKey is already finalized with status ${existingByKey.status}`
      );
    }

    const existingByHash = await CheckoutDraft.findOne({
      userId: req.userId,
      requestHash,
      status: "pending_payment",
    }).sort({ createdAt: -1 }).lean();

    if (existingByHash) {
      const existingPayment = existingByHash.paymentId ? await Payment.findById(existingByHash.paymentId).lean() : null;
      if (isPendingCheckoutReusable(existingByHash, existingPayment)) {
        return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(existingByHash, existingPayment) });
      }

      return errorResponse(
        res,
        409,
        "CHECKOUT_IN_PROGRESS",
        "Checkout initialization is still in progress. Retry with the same idempotency key.",
        { draftId: String(existingByHash._id) }
      );
    }

    const addonSubscriptions = quote.addonItems.map((item) => ({
      addonId: item.addon._id,
      name: pickLang(item.addon.name, lang),
      price: item.unitPriceHalala / 100,
      type: item.addon.type || "subscription",
    }));

    draft = await CheckoutDraft.create({
      userId: req.userId,
      planId: quote.plan._id,
      idempotencyKey,
      requestHash,
      daysCount: quote.plan.daysCount,
      grams: quote.grams,
      mealsPerDay: quote.mealsPerDay,
      startDate: quote.startDate || undefined,
      delivery: quote.delivery,
      premiumItems: quote.premiumItems.map((item) => ({
        premiumMealId: item.premiumMeal._id,
        qty: item.qty,
        unitExtraFeeHalala: item.unitExtraFeeHalala,
        currency: SYSTEM_CURRENCY,
      })),
      addonItems: quote.addonItems.map((item) => ({
        addonId: item.addon._id,
        qty: item.qty,
        unitPriceHalala: item.unitPriceHalala,
        currency: SYSTEM_CURRENCY,
      })),
      addonSubscriptions,
      breakdown: { ...quote.breakdown, currency: SYSTEM_CURRENCY },
    });

    const appUrl = process.env.APP_URL || "https://example.com";
    const invoice = await createInvoice({
      amount: quote.breakdown.totalHalala,
      description: `Subscription checkout (${quote.plan.daysCount} days)`,
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: body.successUrl || `${appUrl}/payments/success`,
      backUrl: body.backUrl || `${appUrl}/payments/cancel`,
      metadata: {
        type: "subscription_activation",
        draftId: String(draft._id),
        userId: String(req.userId),
        grams: quote.grams,
        mealsPerDay: quote.mealsPerDay,
      },
    });
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

    const payment = await Payment.create({
      provider: "moyasar",
      type: "subscription_activation",
      status: "initiated",
      amount: quote.breakdown.totalHalala,
      currency: invoiceCurrency,
      userId: req.userId,
      providerInvoiceId: invoice.id,
      metadata: invoice.metadata || {},
    });
    draft.paymentId = payment._id;
    draft.providerInvoiceId = invoice.id;
    draft.paymentUrl = invoice.url || "";
    await draft.save();

    return res.status(201).json({
      ok: true,
      data: {
        subscriptionId: null,
        draftId: draft.id,
        paymentId: payment.id,
        payment_url: draft.paymentUrl,
        totals: quote.breakdown,
      },
    });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    if (err.code === "NOT_FOUND") {
      return errorResponse(res, 404, "NOT_FOUND", err.message);
    }
    if (err.code === "INVALID_SELECTION") {
      return errorResponse(res, 400, "INVALID", err.message);
    }
    if (err && err.code === 11000) {
      let existingDraft = null;
      existingDraft = await CheckoutDraft.findOne({ userId: req.userId, idempotencyKey }).lean();
      if (!existingDraft && requestHash) {
        existingDraft = await CheckoutDraft.findOne({
          userId: req.userId,
          requestHash,
          status: "pending_payment",
        }).sort({ createdAt: -1 }).lean();
      }
      if (existingDraft) {
        const existingPayment = existingDraft.paymentId ? await Payment.findById(existingDraft.paymentId).lean() : null;
        if (isPendingCheckoutReusable(existingDraft, existingPayment)) {
          return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(existingDraft, existingPayment) });
        }

        if (existingDraft.status === "pending_payment") {
          return errorResponse(
            res,
            409,
            "CHECKOUT_IN_PROGRESS",
            "Checkout initialization is still in progress. Retry with the same idempotency key.",
            { draftId: String(existingDraft._id) }
          );
        }

        if (existingDraft.status === "completed") {
          return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(existingDraft, existingPayment) });
        }

        return errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          `idempotencyKey is already finalized with status ${existingDraft.status}`
        );
      }
    }
    if (draft && draft.status === "pending_payment") {
      draft.status = "failed";
      draft.failedAt = new Date();
      draft.failureReason = err && err.code ? String(err.code) : "checkout_init_failed";
      await draft.save().catch(() => {});
    }
    logger.error("Subscription checkout failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Checkout failed");
  }
}

async function activateSubscription(req, res) {
  const { id } = req.params;
  // SECURITY FIX: Mock activation endpoint must be disabled in production.
  if (process.env.NODE_ENV === "production") {
    return errorResponse(res, 403, "FORBIDDEN", "Mock activation is disabled in production");
  }
  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

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

async function buildSubscriptionSummaries(subscription, lang) {
  const premiumBalance = Array.isArray(subscription.premiumBalance) ? subscription.premiumBalance : [];
  const addonBalance = Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [];
  const premiumSelections = Array.isArray(subscription.premiumSelections) ? subscription.premiumSelections : [];
  const addonSelections = Array.isArray(subscription.addonSelections) ? subscription.addonSelections : [];

  const premiumById = new Map();
  for (const row of premiumBalance) {
    const key = String(row.premiumMealId);
    const current = premiumById.get(key) || {
      premiumMealId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: null,
      maxUnitPriceHalala: null,
    };
    current.purchasedQtyTotal += Number(row.purchasedQty || 0);
    current.remainingQtyTotal += Number(row.remainingQty || 0);
    const unit = Number(row.unitExtraFeeHalala || 0);
    current.minUnitPriceHalala = current.minUnitPriceHalala === null ? unit : Math.min(current.minUnitPriceHalala, unit);
    current.maxUnitPriceHalala = current.maxUnitPriceHalala === null ? unit : Math.max(current.maxUnitPriceHalala, unit);
    premiumById.set(key, current);
  }
  for (const row of premiumSelections) {
    const key = String(row.premiumMealId);
    const current = premiumById.get(key) || {
      premiumMealId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: Number(row.unitExtraFeeHalala || 0),
      maxUnitPriceHalala: Number(row.unitExtraFeeHalala || 0),
    };
    current.consumedQtyTotal += 1;
    premiumById.set(key, current);
  }

  const addonById = new Map();
  for (const row of addonBalance) {
    const key = String(row.addonId);
    const current = addonById.get(key) || {
      addonId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: null,
      maxUnitPriceHalala: null,
    };
    current.purchasedQtyTotal += Number(row.purchasedQty || 0);
    current.remainingQtyTotal += Number(row.remainingQty || 0);
    const unit = Number(row.unitPriceHalala || 0);
    current.minUnitPriceHalala = current.minUnitPriceHalala === null ? unit : Math.min(current.minUnitPriceHalala, unit);
    current.maxUnitPriceHalala = current.maxUnitPriceHalala === null ? unit : Math.max(current.maxUnitPriceHalala, unit);
    addonById.set(key, current);
  }
  for (const row of addonSelections) {
    const key = String(row.addonId);
    const current = addonById.get(key) || {
      addonId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: Number(row.unitPriceHalala || 0),
      maxUnitPriceHalala: Number(row.unitPriceHalala || 0),
    };
    current.consumedQtyTotal += Number(row.qty || 0);
    addonById.set(key, current);
  }

  const premiumIds = Array.from(premiumById.keys());
  const addonIds = Array.from(addonById.keys());
  const [premiumDocs, addonDocs] = await Promise.all([
    premiumIds.length ? PremiumMeal.find({ _id: { $in: premiumIds } }).lean() : Promise.resolve([]),
    addonIds.length ? Addon.find({ _id: { $in: addonIds } }).lean() : Promise.resolve([]),
  ]);
  const premiumNames = new Map(premiumDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang)]));
  const addonNames = new Map(addonDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang)]));

  const premiumSummary = Array.from(premiumById.values()).map((row) => ({
    premiumMealId: row.premiumMealId,
    name: premiumNames.get(row.premiumMealId) || "",
    purchasedQtyTotal: row.purchasedQtyTotal,
    remainingQtyTotal: row.remainingQtyTotal,
    consumedQtyTotal: row.consumedQtyTotal || Math.max(0, row.purchasedQtyTotal - row.remainingQtyTotal),
    minUnitPriceHalala: row.minUnitPriceHalala || 0,
    maxUnitPriceHalala: row.maxUnitPriceHalala || 0,
  }));

  const addonsSummary = Array.from(addonById.values()).map((row) => ({
    addonId: row.addonId,
    name: addonNames.get(row.addonId) || "",
    purchasedQtyTotal: row.purchasedQtyTotal,
    remainingQtyTotal: row.remainingQtyTotal,
    consumedQtyTotal: row.consumedQtyTotal || Math.max(0, row.purchasedQtyTotal - row.remainingQtyTotal),
    minUnitPriceHalala: row.minUnitPriceHalala || 0,
    maxUnitPriceHalala: row.maxUnitPriceHalala || 0,
  }));

  return { premiumSummary, addonsSummary };
}

async function getSubscription(req, res) {
  const { id } = req.params;
  // MEDIUM AUDIT FIX: Validate ObjectId up front to return 400 INVALID_ID instead of CastError 500.
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const lang = getRequestLang(req);
  const { premiumSummary, addonsSummary } = await buildSubscriptionSummaries(sub, lang);
  const deliverySlot = sub.deliverySlot && typeof sub.deliverySlot === "object"
    ? sub.deliverySlot
    : {
      type: sub.deliveryMode,
      window: sub.deliveryWindow || "",
      slotId: "",
    };
  const data = { ...sub };
  delete data.__v;
  delete data.premiumBalance;
  delete data.addonBalance;
  delete data.premiumSelections;
  delete data.addonSelections;

  return res.status(200).json({
    ok: true,
    data: {
      ...data,
      deliveryAddress: sub.deliveryAddress || null,
      deliverySlot,
      premiumSummary,
      addonsSummary,
    },
  });
}

async function getSubscriptionDays(req, res) {
  const { id } = req.params;
  // MEDIUM AUDIT FIX: Validate ObjectId up front to return 400 INVALID_ID instead of CastError 500.
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const days = await SubscriptionDay.find({ subscriptionId: id }).sort({ date: 1 }).lean();
  const mappedDays = days.map(d => ({ ...d, status: mapStatusForClient(d.status) }));
  return res.status(200).json({ ok: true, data: mappedDays });
}

async function getSubscriptionDay(req, res) {
  const { id, date } = req.params;
  // MEDIUM AUDIT FIX: Validate ObjectId up front to return 400 INVALID_ID instead of CastError 500.
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
  if (!day) {
    return errorResponse(res, 404, "NOT_FOUND", "Day not found" );
  }
  day.status = mapStatusForClient(day.status);
  return res.status(200).json({ ok: true, data: day });
}

async function getSubscriptionToday(req, res) {
  const { id } = req.params;
  // MEDIUM AUDIT FIX: Validate ObjectId up front to return 400 INVALID_ID instead of CastError 500.
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const today = getTodayKSADate();
  const day = await SubscriptionDay.findOne({ subscriptionId: id, date: today }).lean();
  if (!day) {
    return errorResponse(res, 404, "NOT_FOUND", "Day not found" );
  }
  day.status = mapStatusForClient(day.status);
  return res.status(200).json({ ok: true, data: day });
}

async function updateDaySelection(req, res) {
  const body = req.body || {};
  const selections = body.selections || [];
  const premiumSelections = body.premiumSelections || [];
  const { id, date } = req.params;

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    validateFutureDateOrThrow(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
  }

  try {
    await enforceTomorrowCutoffOrThrow(date);
  } catch (err) {
    return errorResponse(res, 400, err.code || "LOCKED", err.message );
  }

  const totalSelected = selections.length + premiumSelections.length;
  const mealsPerDayLimit = resolveMealsPerDay(sub);
  if (totalSelected > mealsPerDayLimit) {
    return errorResponse(res, 400, "DAILY_CAP", "Selections exceed meals per day");
  }
  const premiumPriceSar = Number(await getSettingValue("premium_price", 20));
  const legacyPremiumUnitHalala =
    Number.isFinite(premiumPriceSar) && premiumPriceSar >= 0
      ? Math.round(premiumPriceSar * 100)
      : 0;

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    }
    try {
      ensureActive(subInSession, date);
      validateFutureDateOrThrow(date, subInSession);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return errorResponse(res, status, err.code || "INVALID_DATE", err.message);
    }

    const existingDay = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);

    // CR-04 FIX: Check for idempotency - if same selections, return early
    if (existingDay && existingDay.status === "open") {
      const toStringSet = (values) => new Set((Array.isArray(values) ? values : []).map((value) => String(value)));
      const existingRegSet = toStringSet(existingDay.selections);
      const existingPremSet = toStringSet(existingDay.premiumSelections);
      const newRegSet = toStringSet(selections);
      const newPremSet = toStringSet(premiumSelections);

      const setsEqual = (a, b) => a.size === b.size && [...a].every((value) => b.has(value));

      if (setsEqual(existingRegSet, newRegSet) && setsEqual(existingPremSet, newPremSet)) {
        await session.commitTransaction();
        session.endSession();
        return res.status(200).json({ ok: true, data: existingDay, idempotent: true });
      }
    }

    if (existingDay && existingDay.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked" );
    }

    // Compatibility bridge: migrate legacy numeric premiumRemaining into wallet rows once.
    ensureLegacyPremiumBalanceFromRemaining(subInSession, {
      unitExtraFeeHalala: legacyPremiumUnitHalala,
      currency: SYSTEM_CURRENCY,
    });

    const currentLegacyRows = getLegacyDayPremiumSelections(subInSession, {
      dayId: existingDay ? existingDay._id : null,
      date,
    });
    const diff = premiumSelections.length - currentLegacyRows.length;
    const insertedSelectionIds = [];

    if (diff > 0) {
      const consumedRows = consumePremiumBalanceFifoRows(subInSession, diff);
      if (!consumedRows) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 400, "INSUFFICIENT_PREMIUM", "Not enough premium credits" );
      }
      let nextSlotIndex = getNextLegacyDayPremiumSlotIndex(currentLegacyRows);
      for (const consumed of consumedRows) {
        subInSession.premiumSelections = subInSession.premiumSelections || [];
        subInSession.premiumSelections.push({
          dayId: existingDay ? existingDay._id : undefined,
          date,
          baseSlotKey: `${LEGACY_DAY_PREMIUM_SLOT_PREFIX}${nextSlotIndex}`,
          premiumMealId: consumed.premiumMealId,
          unitExtraFeeHalala: consumed.unitExtraFeeHalala,
          currency: consumed.currency || SYSTEM_CURRENCY,
        });
        insertedSelectionIds.push(String(subInSession.premiumSelections[subInSession.premiumSelections.length - 1]._id));
        nextSlotIndex += 1;
      }
    } else if (diff < 0) {
      const rowsToRefund = currentLegacyRows
        .slice()
        .sort((a, b) => new Date(b.consumedAt || 0).getTime() - new Date(a.consumedAt || 0).getTime())
        .slice(0, -diff);

      refundPremiumSelectionRowsToBalanceOrThrow(subInSession, rowsToRefund);

      const removeIds = new Set(rowsToRefund.map((row) => String(row._id)));
      subInSession.premiumSelections = (subInSession.premiumSelections || []).filter(
        (row) => !removeIds.has(String(row._id))
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

    if (insertedSelectionIds.length > 0) {
      const insertIdSet = new Set(insertedSelectionIds);
      for (const row of subInSession.premiumSelections || []) {
        if (!insertIdSet.has(String(row._id))) continue;
        row.dayId = day._id;
        row.date = day.date;
      }
    }

    syncPremiumRemainingFromBalance(subInSession);
    applyDayWalletSelections({ subscription: subInSession, day });

    await subInSession.save({ session });
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();

    await writeLogSafely({
      entityType: "subscription_day",
      entityId: day._id,
      action: "day_selection_update",
      byUserId: req.userId,
      byRole: "client",
      meta: { date, selectionsCount: selections.length, premiumCount: premiumSelections.length },
    }, { subscriptionId: id, date });
    return res.status(200).json({ ok: true, data: day });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err && err.code === "DATA_INTEGRITY_ERROR") {
      logWalletIntegrityError("update_day_selection_refund", {
        subscriptionId: id,
        date,
        reason: err.message,
      });
      return errorResponse(res, 409, "DATA_INTEGRITY_ERROR", err.message);
    }
    return errorResponse(res, 500, "INTERNAL", "Selection failed" );
  }
}

async function lockDaySnapshot(sub, day, session) {
  if (day.lockedSnapshot) return day.lockedSnapshot;
  const { premiumUpgradeSelections, addonCreditSelections } = applyDayWalletSelections({
    subscription: sub,
    day,
  });
  const { address, deliveryWindow } = getEffectiveDeliveryDetails(sub, day);
  const snapshot = {
    selections: day.selections,
    premiumSelections: day.premiumSelections,
    addonsOneTime: day.addonsOneTime,
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
    mealsPerDay: resolveMealsPerDay(sub),
  };
  day.lockedSnapshot = snapshot;
  day.lockedAt = new Date();
  await day.save({ session });
  return snapshot;
}


async function skipDay(req, res) {
  const { id, date } = req.params;
  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    ensureActive(sub, date);
    validateFutureDateOrThrow(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
  }

  try {
    await enforceTomorrowCutoffOrThrow(date);
  } catch (err) {
    return errorResponse(res, 400, err.code || "LOCKED", err.message );
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    }
    if (subInSession.status !== "active") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 422, "SUB_INACTIVE", "Subscription not active" );
    }

    // MEDIUM AUDIT FIX: Helper returns status only; transaction lifecycle remains owned by this controller.
    const result = await applySkipForDate({ sub: subInSession, date, session });

    if (result.status === "already_skipped") {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true, data: result.day });
    }
    if (result.status === "locked") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Cannot skip after lock" );
    }
    if (result.status === "insufficient_credits") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INSUFFICIENT_CREDITS", "Not enough credits" );
    }
    if (result.status !== "skipped") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Skip failed" );
    }

    await session.commitTransaction();
    session.endSession();
    await writeLogSafely({
      entityType: "subscription_day",
      entityId: result.day._id,
      action: "skip",
      byUserId: req.userId,
      byRole: "client",
      // BUSINESS RULE: Skip operations never generate compensation days; log only the skipped date.
      meta: { date: result.day.date },
    }, { subscriptionId: id, date: result.day.date });
    return res.status(200).json({ ok: true, data: result.day });
  } catch (err) {
    if (err.code === "SKIP_LIMIT_REACHED") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "SKIP_LIMIT_REACHED", "You have reached your maximum allowed skip days");
    }
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Skip failed" );
  }
}

async function skipRange(req, res) {
  const { id } = req.params;
  const { startDate, days } = req.body || {};
  const rangeDays = parseInt(days, 10);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  if (!startDate || !isValidKSADateString(startDate)) {
    return errorResponse(res, 400, "INVALID_DATE", "Invalid startDate" );
  }
  if (!rangeDays || rangeDays <= 0) {
    return errorResponse(res, 400, "INVALID", "Invalid days count" );
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    ensureActive(sub);
  } catch (err) {
    return errorResponse(res, 422, err.code, err.message );
  }

  const tomorrow = getTomorrowKSADate();
  if (!isOnOrAfterKSADate(startDate, tomorrow)) {
    return errorResponse(res, 400, "INVALID_DATE", "startDate must be from tomorrow onward" );
  }

  const cutoffTime = await getSettingValue("cutoff_time", "00:00");
  const summary = {
    skippedDates: [],
    // BUSINESS RULE: Compensation is disabled for all skips, so this list remains empty.
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
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    }
    try {
      ensureActive(subInSession, startDate);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 422, err.code, err.message);
    }
    // BUSINESS RULE: Reject the entire request if requested skip count exceeds remaining global allowance.
    await enforceSkipAllowanceOrThrow({ subscriptionId: subInSession._id, daysToSkip: rangeDays, session });
    const baseEndDate = subInSession.validityEndDate || subInSession.endDate;

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

      // MEDIUM AUDIT FIX: Helper returns status only; controller keeps commit/abort ownership for the full range transaction.
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
        const err = new Error("You have reached your maximum allowed skip days");
        err.code = "SKIP_LIMIT_REACHED";
        throw err;
      }
      if (result.status !== "skipped") {
        summary.rejected.push({ date: dateStr, reason: "UNKNOWN" });
        continue;
      }

      summary.skippedDates.push(dateStr);
      skippedForLog.push({ dayId: result.day._id, date: result.day.date });
    }

    await session.commitTransaction();
    session.endSession();

    for (const item of skippedForLog) {
      await writeLogSafely({
        entityType: "subscription_day",
        entityId: item.dayId,
        action: "skip",
        byUserId: req.userId,
        byRole: "client",
        meta: { date: item.date },
      }, { subscriptionId: id, date: item.date });
    }

    return res.status(200).json({ ok: true, data: summary });
  } catch (err) {
    if (err.code === "SKIP_LIMIT_REACHED") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "SKIP_LIMIT_REACHED", "You have reached your maximum allowed skip days");
    }
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Skip range failed" );
  }
}

function matchSelectionDay(selection, { dayId, date }) {
  if (dayId) {
    return String(selection.dayId) === String(dayId);
  }
  return selection.date === date;
}

async function resolveSubscriptionDay({ subscriptionId, dayId, date, session }) {
  if (dayId) {
    return SubscriptionDay.findOne({ _id: dayId, subscriptionId }).session(session);
  }
  return SubscriptionDay.findOne({ subscriptionId, date }).session(session);
}

function buildAddonUnitFromDoc(addonDoc) {
  return resolveAddonUnitPriceHalala(addonDoc);
}

async function consumePremiumSelection(req, res) {
  const { id } = req.params;
  const { dayId, date, baseSlotKey, premiumMealId } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
    validateObjectId(premiumMealId, "premiumMealId");
    if (dayId) validateObjectId(dayId, "dayId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!dayId && !date) {
    return sendValidationError(res, "dayId or date is required");
  }
  if (!baseSlotKey || !String(baseSlotKey).trim()) {
    return sendValidationError(res, "baseSlotKey is required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.userId.toString() !== req.userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    ensureActive(sub, date);

    const day = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (day.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }

    const existingSelection = (sub.premiumSelections || []).find(
      (item) =>
        matchSelectionDay(item, { dayId: day._id, date: day.date })
        && String(item.baseSlotKey) === String(baseSlotKey)
    );
    const existingDaySelection = (day.premiumUpgradeSelections || []).find(
      (item) => String(item.baseSlotKey) === String(baseSlotKey)
    );
    if (existingSelection || existingDaySelection) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "CONFLICT", "baseSlotKey already upgraded for this day");
    }

    const hasPremiumBalanceRows = Array.isArray(sub.premiumBalance) && sub.premiumBalance.length > 0;
    const hasLegacyPremiumOnly = Number(sub.premiumRemaining || 0) > 0 && !hasPremiumBalanceRows;
    if (hasLegacyPremiumOnly) {
      const subPremiumPriceSar = Number(sub.premiumPrice);
      const settingsPremiumPriceSar = Number(await getSettingValue("premium_price", 20));
      const fallbackPremiumPriceSar = Number.isFinite(subPremiumPriceSar) && subPremiumPriceSar >= 0
        ? subPremiumPriceSar
        : Number.isFinite(settingsPremiumPriceSar) && settingsPremiumPriceSar >= 0
          ? settingsPremiumPriceSar
          : 0;
      const legacyUnitExtraFeeHalala = Math.round(fallbackPremiumPriceSar * 100);
      const migrated = ensureLegacyPremiumBalanceFromRemaining(sub, {
        premiumMealId,
        unitExtraFeeHalala: legacyUnitExtraFeeHalala,
        currency: SYSTEM_CURRENCY,
      });
      if (migrated) {
        syncPremiumRemainingFromBalance(sub);
      }
    }

    // Legacy compatibility: if prior migration created a generic legacy bucket, bind it
    // to the requested premium meal before itemized consumption.
    const hasRequestedPremiumBucket = (sub.premiumBalance || []).some(
      (row) => String(row.premiumMealId) === String(premiumMealId)
    );
    if (!hasRequestedPremiumBucket) {
      for (const row of sub.premiumBalance || []) {
        if (String(row.premiumMealId) !== LEGACY_PREMIUM_MEAL_BUCKET_ID) continue;
        if (Number(row.remainingQty || 0) <= 0 && Number(row.purchasedQty || 0) <= 0) continue;
        row.premiumMealId = premiumMealId;
      }
    }

    const candidates = (sub.premiumBalance || [])
      .filter((row) => String(row.premiumMealId) === String(premiumMealId) && Number(row.remainingQty) > 0)
      .sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime());
    if (!candidates.length) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INSUFFICIENT_PREMIUM", "Not enough premium credits");
    }

    candidates[0].remainingQty = Number(candidates[0].remainingQty) - 1;
    sub.premiumSelections.push({
      dayId: day._id,
      date: day.date,
      baseSlotKey: String(baseSlotKey),
      premiumMealId,
      unitExtraFeeHalala: Number(candidates[0].unitExtraFeeHalala || 0),
      currency: candidates[0].currency || "SAR",
    });
    syncPremiumRemainingFromBalance(sub);
    applyDayWalletSelections({ subscription: sub, day });
    await sub.save({ session });
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();

    const remainingQtyTotal = (sub.premiumBalance || [])
      .filter((row) => String(row.premiumMealId) === String(premiumMealId))
      .reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);

    return res.status(200).json({
      ok: true,
      data: {
        subscriptionId: sub.id,
        premiumMealId: String(premiumMealId),
        remainingQtyTotal,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    return errorResponse(res, 500, "INTERNAL", "Premium selection failed");
  }
}

async function removePremiumSelection(req, res) {
  const { id } = req.params;
  const { dayId, date, baseSlotKey } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
    if (dayId) validateObjectId(dayId, "dayId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!dayId && !date) {
    return sendValidationError(res, "dayId or date is required");
  }
  if (!baseSlotKey || !String(baseSlotKey).trim()) {
    return sendValidationError(res, "baseSlotKey is required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.userId.toString() !== req.userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }

    const targetDay = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!targetDay) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    try {
      ensureActive(sub, targetDay.date);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return errorResponse(res, status, err.code || "INVALID", err.message);
    }
    if (targetDay.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }
    const targetDayId = String(targetDay._id);
    const targetDate = targetDay.date;
    const rows = sub.premiumSelections || [];
    const index = rows.findIndex(
      (row) =>
        matchSelectionDay(row, { dayId: targetDayId, date: targetDate })
        && String(row.baseSlotKey) === String(baseSlotKey)
    );

    if (index === -1) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Premium selection not found");
    }

    const [removed] = rows.splice(index, 1);
    try {
      refundPremiumSelectionRowsToBalanceOrThrow(sub, [removed]);
    } catch (err) {
      logWalletIntegrityError("premium_refund_remove_selection", {
        subscriptionId: id,
        dayId: targetDayId,
        date: targetDate,
        baseSlotKey: String(baseSlotKey),
        premiumMealId: String(removed.premiumMealId),
        unitExtraFeeHalala: Number(removed.unitExtraFeeHalala || 0),
        reason: err.message,
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(
        res,
        409,
        "DATA_INTEGRITY_ERROR",
        err.message
      );
    }

    syncPremiumRemainingFromBalance(sub);
    applyDayWalletSelections({ subscription: sub, day: targetDay });
    await sub.save({ session });
    await targetDay.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({ ok: true, data: { subscriptionId: sub.id } });
  } catch (_err) {
    await session.abortTransaction();
    session.endSession();
    if (_err && _err.code === "DATA_INTEGRITY_ERROR") {
      return errorResponse(res, 409, "DATA_INTEGRITY_ERROR", _err.message);
    }
    return errorResponse(res, 500, "INTERNAL", "Premium selection refund failed");
  }
}

async function consumeAddonSelection(req, res) {
  const { id } = req.params;
  const { dayId, date, addonId, qty } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
    validateObjectId(addonId, "addonId");
    if (dayId) validateObjectId(dayId, "dayId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!dayId && !date) {
    return sendValidationError(res, "dayId or date is required");
  }
  const parsedQty = parsePositiveInteger(qty);
  if (!parsedQty) {
    return sendValidationError(res, "qty must be a positive integer");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.userId.toString() !== req.userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    ensureActive(sub, date);

    const day = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (day.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }

    const balances = (sub.addonBalance || [])
      .filter((row) => String(row.addonId) === String(addonId) && Number(row.remainingQty) > 0)
      .sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime());

    const totalAvailable = balances.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
    if (totalAvailable < parsedQty) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INSUFFICIENT_ADDON", "Not enough addon credits");
    }

    let remaining = parsedQty;
    for (const row of balances) {
      if (remaining <= 0) break;
      const available = Number(row.remainingQty || 0);
      const deduct = Math.min(available, remaining);
      if (!deduct) continue;
      row.remainingQty = available - deduct;
      sub.addonSelections.push({
        dayId: day._id,
        date: day.date,
        addonId,
        qty: deduct,
        unitPriceHalala: Number(row.unitPriceHalala || 0),
        currency: row.currency || "SAR",
      });
      remaining -= deduct;
    }

    applyDayWalletSelections({ subscription: sub, day });
    await sub.save({ session });
    await day.save({ session });
    await session.commitTransaction();
    session.endSession();

    const remainingQtyTotal = (sub.addonBalance || [])
      .filter((row) => String(row.addonId) === String(addonId))
      .reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);

    return res.status(200).json({
      ok: true,
      data: { subscriptionId: sub.id, addonId: String(addonId), remainingQtyTotal },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    return errorResponse(res, 500, "INTERNAL", "Addon selection failed");
  }
}

async function removeAddonSelection(req, res) {
  const { id } = req.params;
  const { dayId, date, addonId } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
    validateObjectId(addonId, "addonId");
    if (dayId) validateObjectId(dayId, "dayId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!dayId && !date) {
    return sendValidationError(res, "dayId or date is required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.userId.toString() !== req.userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }

    const targetDay = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!targetDay) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    try {
      ensureActive(sub, targetDay.date);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return errorResponse(res, status, err.code || "INVALID", err.message);
    }
    if (targetDay.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }
    const targetDayId = String(targetDay._id);
    const targetDate = targetDay.date;

    const toRefund = (sub.addonSelections || []).filter(
      (row) =>
        String(row.addonId) === String(addonId)
        && matchSelectionDay(row, { dayId: targetDayId, date: targetDate })
    );
    if (!toRefund.length) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Addon selection not found");
    }

    sub.addonSelections = (sub.addonSelections || []).filter(
      (row) =>
        !(String(row.addonId) === String(addonId) && matchSelectionDay(row, { dayId: targetDayId, date: targetDate }))
    );

    for (const row of toRefund) {
      const match = (sub.addonBalance || []).find(
        (balance) =>
          String(balance.addonId) === String(addonId)
          && Number(balance.unitPriceHalala || 0) === Number(row.unitPriceHalala || 0)
      );
      if (!match) {
        logWalletIntegrityError("addon_refund_remove_selection_missing_bucket", {
          subscriptionId: id,
          dayId: targetDayId,
          date: targetDate,
          addonId: String(addonId),
          unitPriceHalala: Number(row.unitPriceHalala || 0),
        });
        await session.abortTransaction();
        session.endSession();
        return errorResponse(
          res,
          409,
          "DATA_INTEGRITY_ERROR",
          "Cannot refund addon credits because the original wallet bucket was not found"
        );
      }
      const refundQty = Number(row.qty || 0);
      const nextRemainingQty = Number(match.remainingQty || 0) + refundQty;
      const purchasedQty = Number(match.purchasedQty || 0);
      if (nextRemainingQty > purchasedQty) {
        logWalletIntegrityError("addon_refund_remove_selection_exceeds_purchased", {
          subscriptionId: id,
          dayId: targetDayId,
          date: targetDate,
          addonId: String(addonId),
          unitPriceHalala: Number(row.unitPriceHalala || 0),
          attemptedRemainingQty: nextRemainingQty,
          purchasedQty,
        });
        await session.abortTransaction();
        session.endSession();
        return errorResponse(
          res,
          409,
          "DATA_INTEGRITY_ERROR",
          "Cannot refund addon credits because refund exceeds purchased quantity"
        );
      }
      match.remainingQty = nextRemainingQty;
    }

    const hasPremiumBalanceRows = Array.isArray(sub.premiumBalance) && sub.premiumBalance.length > 0;
    const hasLegacyPremiumOnly = Number(sub.premiumRemaining || 0) > 0 && !hasPremiumBalanceRows;
    if (hasLegacyPremiumOnly) {
      const subPremiumPriceSar = Number(sub.premiumPrice);
      const settingsPremiumPriceSar = Number(await getSettingValue("premium_price", 20));
      const fallbackPremiumPriceSar = Number.isFinite(subPremiumPriceSar) && subPremiumPriceSar >= 0
        ? subPremiumPriceSar
        : Number.isFinite(settingsPremiumPriceSar) && settingsPremiumPriceSar >= 0
          ? settingsPremiumPriceSar
          : 0;
      const legacyUnitExtraFeeHalala = Math.round(fallbackPremiumPriceSar * 100);
      ensureLegacyPremiumBalanceFromRemaining(sub, {
        unitExtraFeeHalala: legacyUnitExtraFeeHalala,
        currency: SYSTEM_CURRENCY,
      });
    }
    syncPremiumRemainingFromBalance(sub);
    applyDayWalletSelections({ subscription: sub, day: targetDay });
    await sub.save({ session });
    await targetDay.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({ ok: true, data: { subscriptionId: sub.id } });
  } catch (_err) {
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Addon selection refund failed");
  }
}

async function topupPremium(_req, res) {
  if (_req.body && Object.prototype.hasOwnProperty.call(_req.body, "items")) {
    return topupPremiumCredits(_req, res);
  }

  try {
    const { id } = _req.params;
    const { count, successUrl, backUrl } = _req.body || {};
    const premiumCount = parseInt(count, 10);
    if (!premiumCount || premiumCount <= 0) {
      return errorResponse(res, 400, "INVALID", "Invalid premium count" );
    }

    const sub = await Subscription.findById(id);
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    if (sub.userId.toString() !== _req.userId.toString()) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    try {
      ensureActive(sub);
    } catch (err) {
      return errorResponse(res, 422, err.code, err.message );
    }

    const premiumPrice = await getSettingValue("premium_price", 20);
    const amount = Math.round(premiumPrice * premiumCount * 100);
    const unitExtraFeeHalala = Math.round(Number(premiumPrice || 0) * 100);
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
        unitExtraFeeHalala: unitExtraFeeHalala >= 0 ? unitExtraFeeHalala : 0,
        currency: SYSTEM_CURRENCY,
      },
    });
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

    const payment = await Payment.create({
      provider: "moyasar",
      type: "premium_topup",
      status: "initiated",
      amount,
      currency: invoiceCurrency,
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
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    logger.error("Topup error", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Top-up failed" );
  }
}

async function topupPremiumCredits(req, res) {
  try {
    const { id } = req.params;
    const { items, successUrl, backUrl } = req.body || {};
    const normalizedItems = normalizeCheckoutItemsOrThrow(items, "premiumMealId", "items");
    if (!normalizedItems.length) {
      return sendValidationError(res, "items must contain at least one premium meal");
    }

    const sub = await Subscription.findById(id);
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    if (sub.userId.toString() !== req.userId.toString()) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    ensureActive(sub);

    const premiumDocs = await PremiumMeal.find({
      _id: { $in: normalizedItems.map((item) => item.id) },
      isActive: true,
    }).lean();
    const premiumById = new Map(premiumDocs.map((doc) => [String(doc._id), doc]));

    let amount = 0;
    const itemsForPayment = [];
    for (const item of normalizedItems) {
      const doc = premiumById.get(item.id);
      if (!doc) {
        return errorResponse(res, 404, "NOT_FOUND", `Premium meal ${item.id} not found`);
      }
      assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Premium meal ${item.id} currency`);
      const unit = Number(doc.extraFeeHalala || 0);
      amount += unit * item.qty;
      itemsForPayment.push({
        premiumMealId: item.id,
        qty: item.qty,
        unitExtraFeeHalala: unit,
        currency: SYSTEM_CURRENCY,
      });
    }

    const appUrl = process.env.APP_URL || "https://example.com";
    const invoice = await createInvoice({
      amount,
      description: "Premium credits top-up",
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: successUrl || `${appUrl}/payments/success`,
      backUrl: backUrl || `${appUrl}/payments/cancel`,
      metadata: {
        type: "premium_topup",
        subscriptionId: String(sub._id),
        userId: String(req.userId),
        items: itemsForPayment,
      },
    });
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

    const payment = await Payment.create({
      provider: "moyasar",
      type: "premium_topup",
      status: "initiated",
      amount,
      currency: invoiceCurrency,
      userId: req.userId,
      subscriptionId: sub._id,
      providerInvoiceId: invoice.id,
      metadata: invoice.metadata || {},
    });

    return res.status(200).json({
      ok: true,
      data: {
        payment_url: invoice.url,
        invoice_id: invoice.id,
        payment_id: payment.id,
        totalHalala: amount,
      },
    });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    logger.error("Premium top-up error", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Top-up failed");
  }
}

async function topupAddonCredits(req, res) {
  try {
    const { id } = req.params;
    const { items, successUrl, backUrl } = req.body || {};
    const normalizedItems = normalizeCheckoutItemsOrThrow(items, "addonId", "items");
    if (!normalizedItems.length) {
      return sendValidationError(res, "items must contain at least one addon");
    }

    const sub = await Subscription.findById(id);
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    if (sub.userId.toString() !== req.userId.toString()) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    ensureActive(sub);

    const addonDocs = await Addon.find({
      _id: { $in: normalizedItems.map((item) => item.id) },
      isActive: true,
    }).lean();
    const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));

    let amount = 0;
    const itemsForPayment = [];
    for (const item of normalizedItems) {
      const doc = addonById.get(item.id);
      if (!doc) {
        return errorResponse(res, 404, "NOT_FOUND", `Addon ${item.id} not found`);
      }
      assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Addon ${item.id} currency`);
      const unit = buildAddonUnitFromDoc(doc);
      amount += unit * item.qty;
      itemsForPayment.push({
        addonId: item.id,
        qty: item.qty,
        unitPriceHalala: unit,
        currency: SYSTEM_CURRENCY,
      });
    }

    const appUrl = process.env.APP_URL || "https://example.com";
    const invoice = await createInvoice({
      amount,
      description: "Addon credits top-up",
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: successUrl || `${appUrl}/payments/success`,
      backUrl: backUrl || `${appUrl}/payments/cancel`,
      metadata: {
        type: "addon_topup",
        subscriptionId: String(sub._id),
        userId: String(req.userId),
        items: itemsForPayment,
      },
    });
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

    const payment = await Payment.create({
      provider: "moyasar",
      type: "addon_topup",
      status: "initiated",
      amount,
      currency: invoiceCurrency,
      userId: req.userId,
      subscriptionId: sub._id,
      providerInvoiceId: invoice.id,
      metadata: invoice.metadata || {},
    });

    return res.status(200).json({
      ok: true,
      data: {
        payment_url: invoice.url,
        invoice_id: invoice.id,
        payment_id: payment.id,
        totalHalala: amount,
      },
    });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    logger.error("Addon top-up error", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Top-up failed");
  }
}

async function addOneTimeAddon(_req, res) {
  try {
    const { id } = _req.params;
    const { addonId, date, successUrl, backUrl } = _req.body || {};
    if (!addonId || !date) {
      return errorResponse(res, 400, "INVALID", "Missing addonId or date" );
    }

    const sub = await Subscription.findById(id).populate("planId");
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    if (sub.userId.toString() !== _req.userId.toString()) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    try {
      ensureActive(sub, date);
      validateFutureDateOrThrow(date, sub);
    } catch (err) {
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
    }
    // MEDIUM AUDIT FIX: One-time add-on purchases must obey the same tomorrow cutoff guard as meal edits.
    try {
      await enforceTomorrowCutoffOrThrow(date);
    } catch (err) {
      return errorResponse(res, 400, err.code || "LOCKED", err.message );
    }

    const addon = await Addon.findById(addonId).lean();
    if (!addon || addon.type !== "one_time" || addon.isActive === false) {
      return errorResponse(res, 404, "NOT_FOUND", "Addon not found" );
    }
    assertSystemCurrencyOrThrow(addon.currency || SYSTEM_CURRENCY, `Addon ${addonId} currency`);

    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
    if (day && day.status !== "open") {
      return errorResponse(res, 409, "LOCKED", "Day is locked" );
    }

    const amount = buildAddonUnitFromDoc(addon);
    const appUrl = process.env.APP_URL || "https://example.com";
    const lang = getRequestLang(_req);
    const addonDisplayName = pickLang(addon.name, lang);

    const invoice = await createInvoice({
      amount,
      // Fix: reuse the same language resolver used for persisted string names.
      description: `Add-on (${addonDisplayName})`,
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
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

    const payment = await Payment.create({
      provider: "moyasar",
      type: "one_time_addon",
      status: "initiated",
      amount,
      currency: invoiceCurrency,
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
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    logger.error("Addon error", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Addon purchase failed" );
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
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    }
    if (sub.userId.toString() !== req.userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }

    try {
      ensureActive(sub, date);
      validateFutureDateOrThrow(date, sub);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
    }

    try {
      await enforceTomorrowCutoffOrThrow(date);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, err.code || "LOCKED", err.message );
    }

    if (sub.deliveryMode !== "pickup") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Delivery mode is not pickup" );
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
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition" );
    }

    const mealsToDeduct = resolveMealsPerDay(sub);

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
        return errorResponse(res, 409, "LOCKED", "Day already locked" );
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
      return errorResponse(res, 400, "INSUFFICIENT_CREDITS", "Not enough credits" );
    }

    await session.commitTransaction();
    session.endSession();

    await writeLogSafely({
      entityType: "subscription_day",
      entityId: updatedDay._id,
      action: "pickup_prepare",
      byUserId: req.userId,
      byRole: "client",
      meta: { date: updatedDay.date, deductedCredits: mealsToDeduct },
    }, { subscriptionId: id, date: updatedDay.date });
    return res.status(200).json({ ok: true, data: updatedDay });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("Pickup prepare failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Pickup prepare failed" );
  }
}

async function updateDeliveryDetails(req, res) {
  const { id } = req.params;
  const { deliveryAddress, deliveryWindow } = req.body || {};
  if (deliveryAddress === undefined && deliveryWindow === undefined) {
    return errorResponse(res, 400, "INVALID", "Missing delivery update fields" );
  }

  const sub = await Subscription.findById(id);
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    ensureActive(sub);
  } catch (err) {
    return errorResponse(res, 422, err.code, err.message );
  }
  if (sub.deliveryMode !== "delivery") {
    return errorResponse(res, 400, "INVALID", "Delivery mode is not delivery" );
  }

  const windows = await getSettingValue("delivery_windows", []);
  if (deliveryWindow && windows.length && !windows.includes(deliveryWindow)) {
    return errorResponse(res, 400, "INVALID", "Invalid delivery window" );
  }

  const willChangeAddress =
    deliveryAddress !== undefined &&
    JSON.stringify(deliveryAddress) !== JSON.stringify(sub.deliveryAddress || null);
  const willChangeWindow =
    deliveryWindow !== undefined &&
    deliveryWindow !== (sub.deliveryWindow || null);

  // MEDIUM AUDIT FIX: Global delivery updates must not mutate tomorrow's effective details after cutoff has passed.
  if (willChangeAddress || willChangeWindow) {
    const tomorrow = getTomorrowKSADate();
    const endDate = sub.validityEndDate || sub.endDate;
    if (isInSubscriptionRange(tomorrow, endDate)) {
      const tomorrowDay = await SubscriptionDay.findOne({ subscriptionId: id, date: tomorrow }).lean();
      const isTomorrowEditable = !tomorrowDay || tomorrowDay.status === "open";
      const addressImpactsTomorrow = willChangeAddress && !hasDeliveryAddressOverride(tomorrowDay);
      const windowImpactsTomorrow = willChangeWindow && !hasDeliveryWindowOverride(tomorrowDay);
      if (isTomorrowEditable && (addressImpactsTomorrow || windowImpactsTomorrow)) {
        try {
          await enforceTomorrowCutoffOrThrow(tomorrow);
        } catch (err) {
          return errorResponse(res, 400, err.code || "LOCKED", err.message );
        }
      }
    }
  }

  if (deliveryAddress !== undefined) sub.deliveryAddress = deliveryAddress;
  if (deliveryWindow !== undefined) sub.deliveryWindow = deliveryWindow;
  await sub.save();
  await writeLogSafely({
    entityType: "subscription",
    entityId: sub._id,
    action: "delivery_update",
    byUserId: req.userId,
    byRole: "client",
    meta: { deliveryWindow: sub.deliveryWindow },
  }, { subscriptionId: id });
  return res.status(200).json({ ok: true, data: sub });
}

async function updateDeliveryDetailsForDate(req, res) {
  const { id, date } = req.params;
  const { deliveryAddress, deliveryWindow } = req.body || {};
  if (deliveryAddress === undefined && deliveryWindow === undefined) {
    return errorResponse(res, 400, "INVALID", "Missing delivery update fields" );
  }

  const sub = await Subscription.findById(id);
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    ensureActive(sub, date);
    validateFutureDateOrThrow(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
  }

  try {
    await enforceTomorrowCutoffOrThrow(date);
  } catch (err) {
    return errorResponse(res, 400, err.code || "LOCKED", err.message );
  }

  if (sub.deliveryMode !== "delivery") {
    return errorResponse(res, 400, "INVALID", "Delivery mode is not delivery" );
  }

  const windows = await getSettingValue("delivery_windows", []);
  if (deliveryWindow && windows.length && !windows.includes(deliveryWindow)) {
    return errorResponse(res, 400, "INVALID", "Invalid delivery window" );
  }

  const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
  if (day && day.status !== "open") {
    return errorResponse(res, 409, "LOCKED", "Day is locked" );
  }

  const update = {};
  if (deliveryAddress !== undefined) update.deliveryAddressOverride = deliveryAddress;
  if (deliveryWindow !== undefined) update.deliveryWindowOverride = deliveryWindow;

  const updatedDay = await SubscriptionDay.findOneAndUpdate(
    { subscriptionId: id, date },
    { $set: update },
    { upsert: true, new: true }
  );

  await writeLogSafely({
    entityType: "subscription_day",
    entityId: updatedDay._id,
    action: "delivery_update_day",
    byUserId: req.userId,
    byRole: "client",
    meta: { date, deliveryWindow: updatedDay.deliveryWindowOverride },
  }, { subscriptionId: id, date });

  return res.status(200).json({ ok: true, data: updatedDay });
}

/** @unwired - NOT mounted on any route. Do not call without review. */
async function transitionDay(req, res, toStatus) {
  const { id, date } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found" );
    }
    if (!canTransition(day.status, toStatus)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition" );
    }

    const sub = await Subscription.findById(id).populate("planId").session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
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
    return errorResponse(res, 500, "INTERNAL", "Transition failed" );
  }
}

/** @unwired - NOT mounted on any route. Do not call without review. */
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
      return errorResponse(res, status, result.code, result.message );
    }

    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ ok: true, data: result.day, alreadyFulfilled: result.alreadyFulfilled });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Fulfillment failed" );
  }
}

module.exports = {
  quoteSubscription,
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
  consumePremiumSelection,
  removePremiumSelection,
  consumeAddonSelection,
  removeAddonSelection,
  topupPremium,
  topupPremiumCredits,
  topupAddonCredits,
  addOneTimeAddon,
  preparePickup,
  updateDeliveryDetails,
  updateDeliveryDetailsForDate,
  transitionDay,
  fulfillDay,
};
