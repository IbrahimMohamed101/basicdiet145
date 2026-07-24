"use strict";

const MOBILE_HOME_PRODUCT_KEY_ALIASES = Object.freeze({
  salads_fruit_salad_150g: "fruit_salad",
  greek_yogurt_greek_yogurt_200g: "greek_yogurt",
});

function text(value) {
  return String(value || "").trim();
}

function productLists(menu = {}) {
  const lists = [];
  for (const category of Array.isArray(menu.categories) ? menu.categories : []) {
    lists.push(Array.isArray(category.products) ? category.products : []);
  }
  for (const section of Array.isArray(menu.publicMenuV2?.sections)
    ? menu.publicMenuV2.sections
    : []) {
    lists.push(Array.isArray(section.products) ? section.products : []);
  }
  return lists;
}

function resolveActiveAliases(menu = {}) {
  const existingKeys = new Set(
    productLists(menu)
      .flat()
      .map((product) => text(product && product.key))
      .filter(Boolean)
  );

  return new Map(
    Object.entries(MOBILE_HOME_PRODUCT_KEY_ALIASES).filter(
      ([canonicalKey, aliasKey]) => (
        existingKeys.has(canonicalKey)
        && (!existingKeys.has(aliasKey) || aliasKey === canonicalKey)
      )
    )
  );
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function aliasProduct(product, activeAliases) {
  if (!product || typeof product !== "object") return product;
  const canonicalKey = text(product.key);
  const aliasKey = activeAliases.get(canonicalKey);
  if (!aliasKey) return product;

  return {
    ...product,
    key: aliasKey,
    canonicalKey,
    keyAliases: uniqueStrings([
      ...(Array.isArray(product.keyAliases) ? product.keyAliases : []),
      canonicalKey,
      aliasKey,
    ]),
  };
}

function aliasProducts(products, activeAliases) {
  return (Array.isArray(products) ? products : []).map(
    (product) => aliasProduct(product, activeAliases)
  );
}

function updateProductIndex(publicMenuV2, sections) {
  const originalIndex = publicMenuV2?.productIndex || {};
  const byId = { ...(originalIndex.byId || {}) };
  const byKey = { ...(originalIndex.byKey || {}) };

  for (const section of sections) {
    for (const product of Array.isArray(section.products) ? section.products : []) {
      const productId = text(product.id || product.productId);
      const productKey = text(product.key);
      const canonicalKey = text(product.canonicalKey);
      if (!productId || !productKey) continue;

      const sectionKey = text(section.key || section.id);
      byId[productId] = {
        ...(byId[productId] || {}),
        ...(sectionKey ? { sectionKey } : {}),
        productKey,
        ...(canonicalKey ? { canonicalKey } : {}),
      };

      const canonicalEntry = canonicalKey ? (byKey[canonicalKey] || {}) : {};
      byKey[productKey] = {
        ...canonicalEntry,
        ...(byKey[productKey] || {}),
        ...(sectionKey ? { sectionKey } : {}),
        productId,
        ...(canonicalKey ? { canonicalKey } : {}),
      };

      // Keep canonical lookup metadata for newer consumers without duplicating
      // the product card returned in sections/categories.
      if (canonicalKey) {
        byKey[canonicalKey] = {
          ...canonicalEntry,
          ...(sectionKey ? { sectionKey } : {}),
          productId,
          aliasKey: productKey,
        };
      }
    }
  }

  return { byId, byKey };
}

function applyMobileHomeProductKeyCompatibility(menu = {}) {
  if (!menu || typeof menu !== "object") return menu;
  const activeAliases = resolveActiveAliases(menu);
  if (!activeAliases.size) return menu;

  const categories = (Array.isArray(menu.categories) ? menu.categories : []).map(
    (category) => ({
      ...category,
      products: aliasProducts(category.products, activeAliases),
    })
  );

  const publicMenuV2 = menu.publicMenuV2 && typeof menu.publicMenuV2 === "object"
    ? (() => {
      const sections = (Array.isArray(menu.publicMenuV2.sections)
        ? menu.publicMenuV2.sections
        : []).map((section) => ({
        ...section,
        products: aliasProducts(section.products, activeAliases),
      }));
      return {
        ...menu.publicMenuV2,
        sections,
        productIndex: updateProductIndex(menu.publicMenuV2, sections),
      };
    })()
    : menu.publicMenuV2;

  return {
    ...menu,
    categories,
    ...(publicMenuV2 ? { publicMenuV2 } : {}),
  };
}

function isDashboardRequest(req = {}) {
  return req.auth && req.auth.authContext === "dashboard";
}

function mobileHomeProductKeyCompatibility(req, res, next) {
  if (isDashboardRequest(req)) return next();

  const originalJson = res.json.bind(res);
  res.json = function compatibleMobileMenuJson(payload) {
    if (
      payload
      && payload.status === true
      && payload.data
      && typeof payload.data === "object"
    ) {
      return originalJson({
        ...payload,
        data: applyMobileHomeProductKeyCompatibility(payload.data),
      });
    }
    return originalJson(payload);
  };

  return next();
}

module.exports = mobileHomeProductKeyCompatibility;
module.exports.MOBILE_HOME_PRODUCT_KEY_ALIASES = MOBILE_HOME_PRODUCT_KEY_ALIASES;
module.exports.applyMobileHomeProductKeyCompatibility = applyMobileHomeProductKeyCompatibility;
module.exports.isDashboardRequest = isDashboardRequest;
module.exports.resolveActiveAliases = resolveActiveAliases;
