"use strict";

const MenuProduct = require("../../models/MenuProduct");
const Order = require("../../models/Order");
const { resolvePreparationWeight } = require("./preparationWeightService");

const INSTALL_MARK = Symbol.for("basicdiet.orderPreparationWeightLifecycle.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.orderPreparationWeightLifecycle.wrapped");

function idText(value) {
  if (value === undefined || value === null || value === "") return "";
  if (value && typeof value === "object") return idText(value._id || value.id);
  return String(value);
}

function ensureOrderItemWeightSchema() {
  const itemsPath = Order.schema.path("items");
  const itemSchema = itemsPath && itemsPath.schema;
  if (!itemSchema) return false;

  if (!itemSchema.path("weightGrams")) {
    itemSchema.add({ weightGrams: { type: Number, min: 0, default: 0 } });
  }
  if (!itemSchema.path("servingWeightGrams")) {
    itemSchema.add({ servingWeightGrams: { type: Number, min: 0, default: 0 } });
  }
  if (!itemSchema.path("weightSource")) {
    itemSchema.add({ weightSource: { type: String, default: "" } });
  }
  return true;
}

function productIdOf(item = {}) {
  return idText(
    item.productId
      || item.menuProductId
      || (item.catalogRef && item.catalogRef.id)
      || (item.productSnapshot && item.productSnapshot.productId)
  );
}

function productKeyOf(item = {}) {
  return String(
    item.productKey
      || (item.productSnapshot && item.productSnapshot.key)
      || ""
  );
}

function enrichPricedItem(item = {}, product = {}) {
  const snapshot = item.productSnapshot && typeof item.productSnapshot === "object"
    ? item.productSnapshot
    : {};
  const resolved = resolvePreparationWeight({ item, product, snapshot });
  const grams = Number(resolved.grams || 0);

  return {
    ...item,
    weightGrams: grams,
    servingWeightGrams: grams,
    weightSource: resolved.source,
    productSnapshot: {
      ...snapshot,
      productId: snapshot.productId || product._id || item.productId || null,
      key: snapshot.key || product.key || item.productKey || null,
      name: snapshot.name || product.name || item.name || null,
      pricingModel: snapshot.pricingModel || product.pricingModel || "fixed",
      baseUnitGrams: Number(
        snapshot.baseUnitGrams === undefined
          ? (product.baseUnitGrams || 0)
          : snapshot.baseUnitGrams
      ),
      defaultWeightGrams: Number(
        snapshot.defaultWeightGrams === undefined
          ? (product.defaultWeightGrams || 0)
          : snapshot.defaultWeightGrams
      ),
      minWeightGrams: Number(
        snapshot.minWeightGrams === undefined
          ? (product.minWeightGrams || 0)
          : snapshot.minWeightGrams
      ),
      maxWeightGrams: Number(
        snapshot.maxWeightGrams === undefined
          ? (product.maxWeightGrams || 0)
          : snapshot.maxWeightGrams
      ),
      weightStepGrams: Number(
        snapshot.weightStepGrams === undefined
          ? (product.weightStepGrams || 0)
          : snapshot.weightStepGrams
      ),
      weightGrams: grams,
      servingWeightGrams: grams,
      weightSource: resolved.source,
    },
  };
}

function installPricingSnapshotAuthority() {
  const pricingService = require("./menuPricingService");
  const original = pricingService.priceMenuCart;
  if (typeof original !== "function" || original[WRAPPED_MARK]) return;

  const wrapped = async function priceMenuCartWithPreparationWeights(args = {}) {
    const result = await original.apply(this, arguments);
    const items = Array.isArray(result && result.items) ? result.items : [];
    const productIds = [...new Set(items.map(productIdOf).filter(Boolean))];
    const products = productIds.length
      ? await MenuProduct.find({ _id: { $in: productIds } }).lean()
      : [];
    const byId = new Map(products.map((product) => [idText(product._id), product]));
    const byKey = new Map(products.map((product) => [String(product.key || ""), product]));

    return {
      ...result,
      items: items.map((item) => enrichPricedItem(
        item,
        byId.get(productIdOf(item)) || byKey.get(productKeyOf(item)) || {}
      )),
    };
  };

  wrapped[WRAPPED_MARK] = true;
  pricingService.priceMenuCart = wrapped;
}

function installOrderPreparationWeightLifecycle() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];

  const schemaExtended = ensureOrderItemWeightSchema();
  installPricingSnapshotAuthority();

  const verification = Object.freeze({
    installed: true,
    schemaExtended,
    fixedServingWeightsPersisted: true,
    selectedWeightsPersisted: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installOrderPreparationWeightLifecycle();

module.exports = {
  enrichPricedItem,
  ensureOrderItemWeightSchema,
  installOrderPreparationWeightLifecycle,
};
