"use strict";

const { normalizePosChannels } = require("./catalogValidation");
const { pricePosInvoice, PosInvoiceMathError } = require("./invoiceMath");

class PosFinancialError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.name = "PosFinancialError"; this.code = code; this.status = status;
  }
}
function fail(code, message, status = 400) { throw new PosFinancialError(code, message, status); }
const validId = (id) => typeof id === "string" && /^[a-z0-9-]{1,64}$/.test(id);
const validPrice = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000;

function pricePosCheckout(doc, request, options = {}) {
  if (!doc?.published || !Array.isArray(doc.published.products)) {
    fail("POS_CATALOG_NOT_FOUND", "منيو الكاشير غير متاح.", 404);
  }
  if (!Number.isSafeInteger(request?.revision) || request.revision < 1
    || doc.publishedRevision !== request.revision) {
    fail("POS_CATALOG_CONFLICT", "تم نشر منيو جديد. راجع الأسعار مرة أخرى قبل البيع.", 409);
  }
  if (!normalizePosChannels(doc.published.channels).some(c => c.id === request.channel)) {
    fail("POS_CHANNEL_INVALID", "قناة البيع غير صالحة.");
  }
  if (!Array.isArray(request.items) || !request.items.length || request.items.length > 50) {
    fail("POS_CART_INVALID", "عدد أصناف السلة غير صحيح.");
  }
  const products = new Map(doc.published.products.filter(p => p.active === true).map(p => [p.id, p]));
  const lines = [];
  for (const [index, entry] of request.items.entries()) {
    const { productId, variantId, quantity } = entry || {};
    if (!validId(productId) || !validId(variantId)
      || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      fail("POS_CART_INVALID", "راجع أصناف السلة والكميات.");
    }
    const item = products.get(productId);
    const variant = item?.variants?.find(v => v.id === variantId);
    if (!item || !variant || (item.category === "addons" && item.sellStandalone !== true)) {
      fail("POS_PRODUCT_UNAVAILABLE", "الصنف أو الحجم غير متاح للبيع.");
    }
    if (!validPrice(variant.prices?.[request.channel])) {
      fail("POS_PRICE_UNAVAILABLE", "الصنف غير مسعّر في هذه القناة.");
    }
    const mainLineId = "i" + index;
    lines.push({
      id: mainLineId, parentLineId: null, kind: "product",
      productId, variantId, name: item.name, variantLabel: variant.label,
      unitPriceHalalas: variant.prices[request.channel], quantity,
      discount: entry.discount ?? null,
    });
    if (entry.addonIds !== undefined && entry.addons !== undefined) {
      fail("POS_ADDON_INVALID", "اختر صيغة واحدة للإضافات.");
    }
    const additions = entry.addons ?? (entry.addonIds ?? []).map(id => ({ productId: id, quantity: 1 }));
    if (!Array.isArray(additions) || additions.length > 10
      || (additions.length && (!item.hasAddons || item.category === "addons"))) {
      fail("POS_ADDON_UNAVAILABLE", "الإضافات غير مسموحة لهذا الصنف.");
    }
    const used = new Set();
    for (const [addonIndex, row] of additions.entries()) {
      if (!validId(row?.productId) || used.has(row.productId)) {
        fail("POS_ADDON_INVALID", "الإضافة مكررة أو معرّفها غير صحيح.");
      }
      if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 10) {
        fail("POS_ADDON_INVALID", "كمية الإضافة يجب أن تكون بين 1 و10.");
      }
      used.add(row.productId);
      const addon = products.get(row.productId);
      if (!addon || addon.category !== "addons" || addon.variants.length !== 1
        || (Array.isArray(item.allowedAddonIds) && !item.allowedAddonIds.includes(addon.id))) {
        fail("POS_ADDON_UNAVAILABLE", "الإضافة غير متاحة لهذا الصنف.");
      }
      const price = addon.variants[0].prices?.[request.channel];
      if (!validPrice(price)) fail("POS_PRICE_UNAVAILABLE", "الإضافة غير مسعّرة في هذه القناة.");
      lines.push({
        id: mainLineId + ":a" + addonIndex, parentLineId: mainLineId, kind: "addon",
        productId: addon.id, variantId: addon.variants[0].id,
        name: addon.name, variantLabel: addon.variants[0].label,
        unitPriceHalalas: price, quantity: quantity * row.quantity,
        perMealAddonQuantity: row.quantity, discount: row.discount ?? null,
      });
    }
  }
  try {
    const priced = pricePosInvoice({ lines, invoiceDiscount: request.invoiceDiscount ?? null },
      { cashierDiscountCapHalalas: options.cashierDiscountCapHalalas ?? null });
    return {
      revision: doc.publishedRevision, channel: request.channel,
      currency: "SAR", lines: priced.lines, totals: priced.totals,
      rounding: priced.rounding, vatRate: priced.vatRate,
      invoiceDiscount: request.invoiceDiscount ?? null,
      kind: "STAGING_TEST_NON_TAX",
      note: "فاتورة تجريبية — غير ضريبية",
    };
  } catch (err) {
    if (err instanceof PosInvoiceMathError) fail(err.code, err.message);
    throw err;
  }
}
module.exports = { PosFinancialError, pricePosCheckout };
