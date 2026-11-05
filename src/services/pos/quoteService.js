"use strict";

/**
 * Server-side POS catalogue quote. Read-only by design.
 * All amounts are non-negative safe integer halalas from the separate POS
 * published catalogue; never take prices from the client or app menu.
 * A quote is NOT a payable invoice: tax, discount, and settlement are not yet
 * implemented. Do not persist transactions or enable checkout from this result.
 */
const CHANNELS = new Set(["restaurant", "hungerstation", "keeta"]);
const MAX_LINES = 50;
const MAX_QUANTITY = 99;
const MAX_HALALAS = 1_000_000_000;

class PosQuoteError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "PosQuoteError";
    this.code = code;
    this.status = status;
  }
}

function invalid(code, message) {
  throw new PosQuoteError(code, message);
}

function validId(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);
}

function validPrice(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000;
}

function validAmount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_HALALAS) {
    invalid("POS_QUOTE_LIMIT", "مجموع الطلب تجاوز الحد الآمن.");
  }
  return value;
}

function quotePosCart(doc, request) {
  if (!doc?.published?.products || !Number.isSafeInteger(doc.publishedRevision)) {
    throw new PosQuoteError("POS_CATALOG_NOT_FOUND", "منيو الكاشير غير متاح.", 404);
  }
  if (!request || !Number.isSafeInteger(request.revision) || request.revision < 1) {
    invalid("POS_QUOTE_INVALID", "نسخة المنيو مطلوبة.");
  }
  if (doc.publishedRevision !== request.revision) {
    throw new PosQuoteError("POS_CATALOG_CONFLICT", "المنيو تغير. راجع الأسعار الجديدة.", 409);
  }
  if (!CHANNELS.has(request.channel)) {
    invalid("POS_QUOTE_INVALID", "قناة البيع غير صحيحة.");
  }
  if (!Array.isArray(request.items) || request.items.length < 1 || request.items.length > MAX_LINES) {
    invalid("POS_QUOTE_INVALID", "عدد أصناف الطلب غير صحيح.");
  }

  const products = new Map(doc.published.products.filter((p) => p.active === true).map((p) => [p.id, p]));
  const pricedLines = [];
  let units = 0;
  let provisionalSubtotalHalalas = 0;

  for (const line of request.items) {
    if (!validId(line?.productId) || !validId(line?.variantId)
      || !Number.isSafeInteger(line?.quantity)
      || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      invalid("POS_QUOTE_INVALID", "بيانات الصنف أو الكمية غير صحيحة.");
    }
    const product = products.get(line.productId);
    const variant = product?.variants?.find((item) => item.id === line.variantId);
    if (!product || !variant) {
      invalid("POS_PRODUCT_UNAVAILABLE", "الصنف أو الحجم لم يعد متاحًا.");
    }
    const basePrice = variant.prices?.[request.channel];
    if (!validPrice(basePrice)) {
      invalid("POS_PRICE_UNAVAILABLE", "الصنف غير مسعر في قناة البيع الحالية.");
    }

    const addonIds = line.addonIds === undefined ? [] : line.addonIds;
    if (!Array.isArray(addonIds) || addonIds.length > 10 || new Set(addonIds).size !== addonIds.length
      || addonIds.some((id) => !validId(id))) {
      invalid("POS_QUOTE_INVALID", "الإضافات غير صحيحة أو مكررة.");
    }
    if (addonIds.length && (!product.hasAddons || product.category === "addons")) {
      invalid("POS_ADDON_UNAVAILABLE", "الإضافات غير متاحة للصنف.");
    }
    const addons = addonIds.map((id) => {
      const addon = products.get(id);
      if (!addon || addon.category !== "addons" || addon.variants?.length !== 1) {
        invalid("POS_ADDON_UNAVAILABLE", "الإضافة غير متاحة.");
      }
      const amount = addon.variants[0]?.prices?.[request.channel];
      if (!validPrice(amount)) {
        invalid("POS_PRICE_UNAVAILABLE", "الإضافة غير مسعرة في القناة.");
      }
      return { productId: addon.id, name: addon.name, priceHalalas: amount };
    });

    const addonsHalalas = validAmount(addons.reduce((sum, addon) => sum + addon.priceHalalas, 0));
    const unitPriceHalalas = validAmount(basePrice + addonsHalalas);
    const lineTotalHalalas = validAmount(unitPriceHalalas * line.quantity);
    provisionalSubtotalHalalas = validAmount(provisionalSubtotalHalalas + lineTotalHalalas);
    units += line.quantity;
    pricedLines.push({
      productId: product.id,
      name: product.name,
      variantId: variant.id,
      variantLabel: variant.label,
      quantity: line.quantity,
      basePriceHalalas: basePrice,
      addons,
      unitPriceHalalas,
      lineTotalHalalas,
    });
  }

  return {
    revision: doc.publishedRevision,
    currency: "SAR",
    channel: request.channel,
    lines: pricedLines,
    itemCount: units,
    provisionalSubtotalHalalas,
    finalPayableHalalas: null,
    taxHalalas: null,
    discountHalalas: null,
    canCommit: false,
    note: "مراجعة أسعار فقط؛ الضريبة والخصم والفاتورة النهائية تتطلب خدمات محاسبية معتمدة.",
  };
}

module.exports = { PosQuoteError, quotePosCart };
