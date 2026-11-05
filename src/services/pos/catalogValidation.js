"use strict";

const channels = ["restaurant", "hungerstation", "keeta"];

function invalid(message) {
  throw new Error(message);
}

function validateId(value) {
  if (typeof value !== "string" || !/^[a-z0-9-]{1,64}$/.test(value)) invalid("معرّف غير صالح.");
  return value;
}

function label(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) {
    invalid("الاسم مطلوب ويجب ألا يتجاوز 100 حرف.");
  }
  return value.trim();
}

function uniqueId(value, used) {
  const id = validateId(value);
  if (used.has(id)) invalid("المعرّف مكرر في المنيو.");
  used.add(id);
  return id;
}

function normalizePosCatalog(input) {
  if (!Array.isArray(input?.categories) || input.categories.length > 50
    || !Array.isArray(input?.products) || input.products.length > 500) {
    invalid("هيكل منيو الكاشير غير صالح.");
  }
  const categoryIds = new Set();
  const categories = input.categories.map((category) => ({
    id: uniqueId(category?.id, categoryIds),
    label: label(category.label),
  }));
  const productIds = new Set();
  const products = input.products.map((product) => {
    const id = uniqueId(product?.id, productIds);
    const category = product.category;
    if (!categoryIds.has(category)) invalid("اختر تصنيفًا موجودًا للصنف.");
    if (!Array.isArray(product.variants) || !product.variants.length || product.variants.length > 10
      || (category === "addons" && product.variants.length !== 1)) {
      invalid("يجب تحديد حجم واحد للإضافة، ومن حجم إلى عشرة للصنف.");
    }
    const variantIds = new Set();
    const variants = product.variants.map((variant) => ({
      id: uniqueId(variant?.id, variantIds),
      label: label(variant.label),
      prices: Object.fromEntries(channels.map((channel) => {
        const value = variant.prices?.[channel];
        if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 10_000_000)) {
          invalid("اكتب سعرًا صحيحًا لكل قناة أو اتركه غير مسعّر.");
        }
        return [channel, value];
      })),
    }));
    if (typeof product.active !== "boolean" || (product.hasAddons !== undefined && typeof product.hasAddons !== "boolean")) {
      invalid("حالة الصنف والإضافات غير صالحة.");
    }
    return { id, name: label(product.name), category, variants, active: product.active,
      hasAddons: category !== "addons" && product.hasAddons === true };
  });
  return { categories, products };
}

module.exports = { normalizePosCatalog };
