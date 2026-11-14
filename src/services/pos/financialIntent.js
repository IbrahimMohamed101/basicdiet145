"use strict";
const crypto = require("node:crypto");
const { PosFinancialError } = require("./financialQuoteService");
const deny = (msg) => { throw new PosFinancialError("POS_INTENT_INVALID", msg); };
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined)
      .map(k => [k, canonical(value[k])]));
  }
  return value;
}
function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
function validateIdempotencyKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new PosFinancialError("POS_IDEMPOTENCY_REQUIRED",
      "مفتاح منع التكرار Idempotency-Key إجباري (16 إلى 128 حرفًا).");
  }
  return value;
}
function discount(source) {
  if (source == null) return null;
  if (!source || !["fixed", "percent"].includes(source.type)
    || typeof source.value !== "number") deny("بيانات الخصم غير صالحة.");
  return { type: source.type, value: source.value };
}
function normalizeSaleIntent(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.items)
    || body.items.length < 1 || body.items.length > 50) deny("السلة غير صالحة.");
  const channel = body.channel;
  const restaurant = channel === "restaurant";
  const tender = restaurant ? {
    method: body.tender?.method,
    ...(body.tender?.method === "cash" ? { receivedHalalas: body.tender.receivedHalalas } : {}),
  } : null;
  if (restaurant) {
    if (!["cash", "network"].includes(tender.method)
      || (tender.method === "cash" && (!Number.isSafeInteger(tender.receivedHalalas)
        || tender.receivedHalalas < 0 || tender.receivedHalalas > 1_000_000_000))) {
      deny("اختر كاش أو شبكة وأدخل المبلغ المستلم بالهللة عند الدفع النقدي.");
    }
  } else if (!["paid", "cash"].includes(body.appPaymentStatus)) {
    deny("حدد حالة دفع التطبيق مدفوع أو كاش.");
  }
  const serviceMode = restaurant ? (body.serviceMode ?? "restaurant") : "external-app";
  if (restaurant && !["restaurant", "dine-in", "takeaway", "delivery"].includes(serviceMode)) {
    deny("نوع طلب المطعم غير صالح.");
  }
  const externalOrderNumber = restaurant ? null : (body.externalOrderNumber ?? "");
  if (!restaurant && (typeof externalOrderNumber !== "string" || externalOrderNumber.length > 60)) {
    deny("رقم طلب التطبيق غير صالح.");
  }
  return {
    revision: body.revision,
    channel,
    serviceMode,
    ...(restaurant ? { tender } : {
      appPaymentStatus: body.appPaymentStatus,
      externalOrderNumber: externalOrderNumber.trim(),
    }),
    invoiceDiscount: discount(body.invoiceDiscount),
    items: body.items.map(item => ({
      productId: item?.productId, variantId: item?.variantId, quantity: item?.quantity,
      discount: discount(item?.discount),
      addons: (item?.addons ?? (item?.addonIds ?? []).map(productId => ({ productId, quantity: 1 })))
        .map(addon => ({ productId: addon?.productId, quantity: addon?.quantity, discount: discount(addon?.discount) })),
    })),
  };
}
function normalizeRefundIntent(body) {
  if (!body || typeof body !== "object"
    || typeof body.invoiceId !== "string"
    || !/^[a-f0-9]{24}$/i.test(body.invoiceId)
    || typeof body.reason !== "string" || body.reason.trim().length < 3
    || body.reason.trim().length > 500
    || !["cash", "network", "external"].includes(body.method)
    || !Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) {
    deny("سبب المرتجع وطريقته ورقم الفاتورة والسطور مطلوبة.");
  }
  const used = new Set();
  const lines = body.lines.map(row => {
    if (!row || typeof row.lineId !== "string" || used.has(row.lineId)
      || !/^i\d+(?::a\d+)?$/.test(row.lineId)
      || !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 990) {
      deny("سطور المرتجع مكررة أو كميتها غير صالحة.");
    }
    used.add(row.lineId);
    return { lineId: row.lineId, quantity: row.quantity };
  });
  return { invoiceId: body.invoiceId.toLowerCase(), reason: body.reason.trim(), method: body.method, lines };
}
module.exports = { canonicalHash, validateIdempotencyKey, normalizeSaleIntent, normalizeRefundIntent };
