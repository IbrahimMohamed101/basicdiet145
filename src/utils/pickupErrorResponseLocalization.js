"use strict";

const { getRequestLang, pickLang } = require("./i18n");

const PICKUP_ERROR_COPY = Object.freeze({
  MEAL_SLOT_UNAVAILABLE: {
    ar: "تعذر حجز الوجبة المحددة للاستلام. حدّث اختيارات اليوم ثم حاول مرة أخرى.",
    en: "The selected meal could not be reserved for pickup. Refresh today's choices and try again.",
  },
  PICKUP_ITEM_UNAVAILABLE: {
    ar: "العنصر المحدد غير متاح للاستلام الآن.",
    en: "The selected item is not currently available for pickup.",
  },
  PICKUP_ITEM_NOT_FOUND: {
    ar: "العنصر المحدد لم يعد موجودًا ضمن اختيارات اليوم. حدّث الصفحة وحاول مرة أخرى.",
    en: "The selected item is no longer part of today's choices. Refresh and try again.",
  },
  INSUFFICIENT_CREDITS: {
    ar: "رصيد الوجبات غير كافٍ لإتمام طلب الاستلام.",
    en: "There are not enough meal credits to create this pickup request.",
  },
  PREMIUM_PAYMENT_REQUIRED: {
    ar: "يجب إتمام دفع ترقية الوجبة أولاً.",
    en: "The premium meal upgrade must be paid first.",
  },
  ADDON_PAYMENT_REQUIRED: {
    ar: "يجب إتمام دفع الإضافات أولاً.",
    en: "The add-ons must be paid first.",
  },
  PAYMENT_REQUIRED: {
    ar: "يجب إتمام الدفع أولاً.",
    en: "Payment must be completed first.",
  },
  INVALID_DATE: {
    ar: "تاريخ طلب الاستلام غير صالح.",
    en: "The pickup request date is invalid.",
  },
  INVALID_DELIVERY_MODE: {
    ar: "هذا الاشتراك غير مضبوط على الاستلام من الفرع.",
    en: "This subscription is not configured for branch pickup.",
  },
  DAY_NOT_FOUND: {
    ar: "لم يتم العثور على يوم الاشتراك المطلوب.",
    en: "The requested subscription day was not found.",
  },
  NOT_FOUND: {
    ar: "لم يتم العثور على الاشتراك المطلوب. حدّث بيانات الاشتراك ثم حاول مرة أخرى.",
    en: "The requested subscription was not found. Refresh the subscription data and try again.",
  },
  PICKUP_REQUEST_NOT_FOUND: {
    ar: "لم يتم العثور على طلب الاستلام المطلوب.",
    en: "The requested pickup request was not found.",
  },
  IDEMPOTENCY_CONFLICT: {
    ar: "تم استخدام مفتاح الطلب نفسه مع اختيارات مختلفة.",
    en: "The same request key was already used with different selections.",
  },
  FORBIDDEN: {
    ar: "هذا الاشتراك غير مرتبط بالحساب الحالي. سجّل الدخول برقم الهاتف المرتبط بالاشتراك.",
    en: "This subscription is not linked to the current account. Sign in with the phone number linked to the subscription.",
  },
  PICKUP_SUBSCRIPTION_AMBIGUOUS: {
    ar: "يوجد أكثر من اشتراك استلام نشط على الحساب. يرجى التواصل مع الدعم.",
    en: "More than one active pickup subscription is linked to this account. Please contact support.",
  },
  SUBSCRIPTION_OWNERSHIP_RECOVERY_CONFLICT: {
    ar: "الحساب مرتبط بالفعل باشتراك نشط آخر. لم يتم نقل أي بيانات.",
    en: "This account is already linked to another active subscription. No data was transferred.",
  },
  INTERNAL: {
    ar: "تعذر إتمام طلب الاستلام بسبب خطأ داخلي. حاول مرة أخرى.",
    en: "The pickup request could not be completed because of an internal error. Try again.",
  },
  INTERNAL_ERROR: {
    ar: "تعذر إتمام طلب الاستلام بسبب خطأ داخلي. حاول مرة أخرى.",
    en: "The pickup request could not be completed because of an internal error. Try again.",
  },
});

function isPickupClientPath(requestUrl = "") {
  const path = String(requestUrl).split("?")[0];
  return /^\/api\/subscriptions\/[^/]+\/pickup-(?:availability|requests)(?:\/[^/]+\/status)?$/.test(path);
}

function normalizePair(value, fallback) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const ar = String(source.ar || source.messageAr || fallback.ar || fallback.en || "").trim();
  const en = String(source.en || source.messageEn || fallback.en || fallback.ar || "").trim();
  return { ar: ar || en, en: en || ar };
}

function normalizePickupErrorResponse(payload, req, requestUrl = "") {
  if (!isPickupClientPath(requestUrl)) return payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (payload.ok !== false || !payload.error || typeof payload.error !== "object") return payload;

  const code = String(payload.error.code || "INTERNAL");
  const fallback = PICKUP_ERROR_COPY[code] || PICKUP_ERROR_COPY.INTERNAL;
  const details = payload.error.details && typeof payload.error.details === "object"
    ? payload.error.details
    : {};
  const messageI18n = normalizePair(details.messageI18n || details, fallback);
  const lang = getRequestLang(req);

  return {
    ...payload,
    error: {
      ...payload.error,
      message: pickLang(messageI18n, lang) || messageI18n.en,
      details: {
        ...details,
        messageI18n,
        messageAr: messageI18n.ar,
        messageEn: messageI18n.en,
      },
    },
  };
}

module.exports = {
  PICKUP_ERROR_COPY,
  isPickupClientPath,
  normalizePickupErrorResponse,
};
