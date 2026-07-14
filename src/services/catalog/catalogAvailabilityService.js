const CatalogItem = require("../../models/CatalogItem");

function catalogItemIdOf(doc) {
  if (!doc || !doc.catalogItemId) return null;
  return String(doc.catalogItemId);
}

function isDocumentUsable(doc) {
  return Boolean(doc)
    && doc.isActive !== false
    && doc.isAvailable !== false
    && doc.isVisible !== false
    && doc.isArchived !== true
    && doc.isDeleted !== true
    && !doc.archivedAt
    && !doc.deletedAt;
}

function isCatalogItemUsable(catalogItem) {
  return isDocumentUsable(catalogItem);
}

function isLinkedDocGloballyAvailable(doc, catalogItemsById = new Map()) {
  if (!isDocumentUsable(doc)) return false;
  const catalogItemId = catalogItemIdOf(doc);
  if (!catalogItemId) return true;
  return isCatalogItemUsable(catalogItemsById.get(catalogItemId));
}

function filterGloballyAvailable(rows = [], catalogItemsById = new Map()) {
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    isLinkedDocGloballyAvailable(row, catalogItemsById)
  ));
}

function collectCatalogItemIds(...collections) {
  const ids = new Set();
  collections.flat().forEach((row) => {
    const id = catalogItemIdOf(row);
    if (id) ids.add(id);
  });
  return [...ids];
}

async function loadCatalogItemsByIdForDocs(...collections) {
  const ids = collectCatalogItemIds(...collections);
  if (!ids.length) return new Map();
  const rows = await CatalogItem.find({ _id: { $in: ids } }).lean();
  return new Map(rows.map((row) => [String(row._id), row]));
}

function createCatalogAvailabilityError(message = "Catalog item is unavailable") {
  const err = new Error(message);
  err.code = "CATALOG_ITEM_UNAVAILABLE";
  err.status = 409;
  err.messageAr = "الصنف غير متاح حاليا";
  return err;
}

function assertLinkedDocGloballyAvailable(doc, catalogItemsById = new Map(), message) {
  if (!isLinkedDocGloballyAvailable(doc, catalogItemsById)) {
    throw createCatalogAvailabilityError(message);
  }
}

async function assertCatalogItemLinkable(catalogItemId, { allowInactive = false } = {}) {
  if (!catalogItemId) return null;
  const row = await CatalogItem.findById(catalogItemId).lean();
  if (!row) {
    const err = new Error("CatalogItem not found");
    err.code = "CATALOG_ITEM_NOT_FOUND";
    err.status = 404;
    err.messageAr = "لم يتم العثور على الصنف";
    throw err;
  }
  if (!allowInactive && !isCatalogItemUsable(row)) {
    const err = new Error("CatalogItem is inactive or unavailable");
    err.code = "CATALOG_ITEM_INACTIVE";
    err.status = 409;
    err.messageAr = "الصنف غير نشط";
    throw err;
  }
  return row;
}

module.exports = {
  assertCatalogItemLinkable,
  assertLinkedDocGloballyAvailable,
  catalogItemIdOf,
  collectCatalogItemIds,
  createCatalogAvailabilityError,
  filterGloballyAvailable,
  isCatalogItemUsable,
  isDocumentUsable,
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
};
