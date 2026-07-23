"use strict";

const CatalogItem = require("../models/CatalogItem");
const MenuProduct = require("../models/MenuProduct");

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function firstImageUrl(...values) {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized) return normalized;
  }
  return "";
}

function workbookSourceProductKey(config = {}) {
  return firstImageUrl(
    config.metadata && config.metadata.workbookSourceProductKey,
    config.metadata && config.metadata.sourceProductKey,
    config.sourceSnapshot && config.sourceSnapshot.context && config.sourceSnapshot.context.workbookSourceProductKey,
    config.sourceSnapshot && config.sourceSnapshot.context && config.sourceSnapshot.context.sourceProductKey
  );
}

function applySession(query, session) {
  return session && query && typeof query.session === "function" ? query.session(session) : query;
}

async function hydratePremiumUpgradeRowsWithImages(rows, { session = null } = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (sourceRows.length === 0) return sourceRows;

  const sourceCatalogItemIds = new Set();
  const relatedProductIds = new Set();
  const relatedProductKeys = new Set();

  for (const row of sourceRows) {
    const config = row && row.config ? row.config : {};
    const sourceDoc = row && row.sourceDoc ? row.sourceDoc : {};
    if (sourceDoc.catalogItemId) sourceCatalogItemIds.add(String(sourceDoc.catalogItemId));
    if (config.sourceProductId) relatedProductIds.add(String(config.sourceProductId));
    const originalProductKey = workbookSourceProductKey(config);
    if (originalProductKey) relatedProductKeys.add(originalProductKey);
  }

  const productFilter = [];
  if (relatedProductIds.size > 0) {
    productFilter.push({ _id: { $in: [...relatedProductIds] } });
  }
  if (relatedProductKeys.size > 0) {
    productFilter.push({ key: { $in: [...relatedProductKeys] } });
  }

  const [sourceCatalogItems, relatedProducts] = await Promise.all([
    sourceCatalogItemIds.size > 0
      ? applySession(CatalogItem.find({ _id: { $in: [...sourceCatalogItemIds] } }), session).lean()
      : [],
    productFilter.length > 0
      ? applySession(MenuProduct.find({ $or: productFilter }), session).lean()
      : [],
  ]);

  const productCatalogItemIds = [...new Set(
    relatedProducts.map((product) => clean(product && product.catalogItemId)).filter(Boolean)
  )];
  const productCatalogItems = productCatalogItemIds.length > 0
    ? await applySession(CatalogItem.find({ _id: { $in: productCatalogItemIds } }), session).lean()
    : [];

  const catalogById = new Map(
    [...sourceCatalogItems, ...productCatalogItems].map((item) => [String(item._id), item])
  );
  const productsById = new Map(relatedProducts.map((product) => [String(product._id), product]));
  const productsByKey = new Map(relatedProducts.map((product) => [clean(product.key), product]));

  return sourceRows.map((row) => {
    if (!row || !row.sourceDoc) return row;

    const config = row.config || {};
    const sourceDoc = row.sourceDoc;
    const sourceCatalog = sourceDoc.catalogItemId
      ? catalogById.get(String(sourceDoc.catalogItemId))
      : null;
    const originalProduct = productsByKey.get(workbookSourceProductKey(config)) || null;
    const originalProductCatalog = originalProduct && originalProduct.catalogItemId
      ? catalogById.get(String(originalProduct.catalogItemId))
      : null;
    const linkedProduct = config.sourceProductId
      ? productsById.get(String(config.sourceProductId)) || null
      : null;
    const linkedProductCatalog = linkedProduct && linkedProduct.catalogItemId
      ? catalogById.get(String(linkedProduct.catalogItemId))
      : null;

    const imageUrl = firstImageUrl(
      sourceDoc.imageUrl,
      sourceCatalog && sourceCatalog.imageUrl,
      originalProduct && originalProduct.imageUrl,
      originalProductCatalog && originalProductCatalog.imageUrl,
      config.sourceSnapshot && config.sourceSnapshot.context && config.sourceSnapshot.context.imageUrl,
      config.sourceSnapshot && config.sourceSnapshot.imageUrl,
      linkedProduct && linkedProduct.imageUrl,
      linkedProductCatalog && linkedProductCatalog.imageUrl
    );

    if (!imageUrl || imageUrl === clean(sourceDoc.imageUrl)) return row;
    return {
      ...row,
      sourceDoc: {
        ...sourceDoc,
        imageUrl,
      },
    };
  });
}

module.exports = {
  clean,
  firstImageUrl,
  hydratePremiumUpgradeRowsWithImages,
  workbookSourceProductKey,
};
