"use strict";

const assert = require("assert");
const mongoose = require("mongoose");

const MenuProduct = require("../src/models/MenuProduct");
const MenuCategory = require("../src/models/MenuCategory");
const CatalogItem = require("../src/models/CatalogItem");
const Addon = require("../src/models/Addon");
const {
  lifecycleRequested,
  syncLifecycleUpdate,
} = require("../src/models/plugins/archivableLifecycle");
const {
  isDocumentUsable,
} = require("../src/services/catalog/catalogAvailabilityService");

const LIFECYCLE_PATHS = ["isArchived", "archivedAt", "isDeleted", "deletedAt"];

function assertLifecyclePaths(Model) {
  for (const path of LIFECYCLE_PATHS) {
    assert(Model.schema.path(path), `${Model.modelName}.${path} must be persisted`);
  }
}

function applyFakeUpdate(update, deactivatePaths) {
  let finalUpdate = update;
  const query = {
    getUpdate: () => finalUpdate,
    setUpdate: (value) => {
      finalUpdate = value;
    },
  };
  syncLifecycleUpdate(query, deactivatePaths);
  return finalUpdate;
}

async function run() {
  for (const Model of [MenuProduct, MenuCategory, CatalogItem, Addon]) {
    assertLifecyclePaths(Model);
  }

  const category = new MenuCategory({
    key: "archived-category-contract",
    name: { en: "Archived category" },
    isArchived: true,
  });
  await category.validate();
  assert.strictEqual(category.isActive, false);
  assert.strictEqual(category.isVisible, false);
  assert.strictEqual(category.isAvailable, false);
  assert.strictEqual(isDocumentUsable(category.toObject()), false);

  const product = new MenuProduct({
    categoryId: new mongoose.Types.ObjectId(),
    key: "archived-product-contract",
    name: { en: "Archived product" },
    pricingModel: "fixed",
    priceHalala: 1000,
    deletedAt: new Date(),
  });
  await product.validate();
  assert.strictEqual(product.isActive, false);
  assert.strictEqual(product.isVisible, false);
  assert.strictEqual(product.isAvailable, false);
  assert.strictEqual(isDocumentUsable(product.toObject()), false);

  const catalogItem = new CatalogItem({
    key: "archived-canonical-contract",
    nameI18n: { en: "Archived canonical item" },
    isDeleted: true,
  });
  await catalogItem.validate();
  assert.strictEqual(catalogItem.isActive, false);
  assert.strictEqual(catalogItem.isAvailable, false);
  assert.strictEqual(isDocumentUsable(catalogItem.toObject()), false);

  const addon = new Addon({
    name: { en: "Archived add-on" },
    priceHalala: 500,
    category: "drinks",
    isArchived: true,
  });
  await addon.validate();
  assert.strictEqual(addon.isActive, false);
  assert.strictEqual(isDocumentUsable(addon.toObject()), false);

  assert.strictEqual(lifecycleRequested({ isArchived: true }), true);
  assert.strictEqual(lifecycleRequested({ deletedAt: new Date() }), true);
  assert.strictEqual(lifecycleRequested({ isArchived: false, deletedAt: null }), false);

  const operatorUpdate = applyFakeUpdate(
    { $set: { isDeleted: true } },
    ["isActive", "isVisible", "isAvailable"]
  );
  assert.deepStrictEqual(operatorUpdate.$set, {
    isDeleted: true,
    isActive: false,
    isVisible: false,
    isAvailable: false,
  });

  const directUpdate = applyFakeUpdate(
    { archivedAt: new Date("2026-07-23T00:00:00.000Z") },
    ["isActive", "isAvailable"]
  );
  assert.strictEqual(directUpdate.isActive, false);
  assert.strictEqual(directUpdate.isAvailable, false);

  console.log("catalog lifecycle persistence checks passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
