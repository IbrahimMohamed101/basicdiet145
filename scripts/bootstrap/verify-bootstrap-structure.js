#!/usr/bin/env node

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const Addon = require("../../src/models/Addon");
const AddonPlanPrice = require("../../src/models/AddonPlanPrice");
const CatalogItem = require("../../src/models/CatalogItem");
const MenuCategory = require("../../src/models/MenuCategory");
const MenuOption = require("../../src/models/MenuOption");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuProduct = require("../../src/models/MenuProduct");
const Plan = require("../../src/models/Plan");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const menuCatalogService = require("../../src/services/orders/menuCatalogService");
const { getOneTimeOrderMenu } = require("../../src/services/orders/orderMenuService");
const { getSubscriptionBuilderCatalogWithV2 } = require("../../src/services/catalog/CatalogService");
const {
  normalizeCategoryUiMetadata,
  normalizeGroupUiMetadata,
  normalizeProductUiMetadata,
} = require("../../src/services/catalog/catalogKeyUiHelpers");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");

function id(value) {
  return value === null || value === undefined ? "" : String(value);
}

function same(left, right) {
  try {
    assert.deepStrictEqual(left, right);
    return true;
  } catch (_error) {
    return false;
  }
}

function pushIssue(target, code, message, details) {
  target.push({ code, message, ...(details === undefined ? {} : { details }) });
}

function flattenPreviewProducts(preview) {
  return (preview.categories || []).flatMap((category) => (
    category.products || []
  ).map((product) => ({ category, product })));
}

function flattenPreviewGroups(preview) {
  return flattenPreviewProducts(preview).flatMap(({ product }) => (
    product.optionGroups || []
  ).map((group) => ({ product, group })));
}

async function verifyBootstrapStructure({ strict = true, log = console } = {}) {
  const errors = [];
  const warnings = [];

  const [
    categories,
    products,
    optionGroups,
    options,
    productGroups,
    productOptions,
    catalogItems,
    plans,
    addons,
    addonPrices,
  ] = await Promise.all([
    MenuCategory.find({}).lean(),
    MenuProduct.find({}).lean(),
    MenuOptionGroup.find({}).lean(),
    MenuOption.find({}).lean(),
    ProductOptionGroup.find({}).lean(),
    ProductGroupOption.find({}).lean(),
    CatalogItem.find({}).lean(),
    Plan.find({}).lean(),
    Addon.find({}).lean(),
    AddonPlanPrice.find({}).lean(),
  ]);

  if (categories.length === 0) pushIssue(errors, "BOOTSTRAP_NO_CATEGORIES", "No menu categories were found");
  if (products.length === 0) pushIssue(errors, "BOOTSTRAP_NO_PRODUCTS", "No menu products were found");
  if (plans.length === 0) pushIssue(errors, "BOOTSTRAP_NO_PLANS", "No subscription plans were found");

  const categoryById = new Map(categories.map((row) => [id(row._id), row]));
  const productById = new Map(products.map((row) => [id(row._id), row]));
  const groupById = new Map(optionGroups.map((row) => [id(row._id), row]));
  const optionById = new Map(options.map((row) => [id(row._id), row]));
  const catalogItemById = new Map(catalogItems.map((row) => [id(row._id), row]));
  const planById = new Map(plans.map((row) => [id(row._id), row]));
  const addonById = new Map(addons.map((row) => [id(row._id), row]));

  for (const product of products) {
    if (!categoryById.has(id(product.categoryId))) {
      pushIssue(errors, "PRODUCT_CATEGORY_MISSING", `Product ${product.key} references a missing category`, {
        productId: id(product._id),
        categoryId: id(product.categoryId),
      });
    }
    if (product.catalogItemId && !catalogItemById.has(id(product.catalogItemId))) {
      pushIssue(errors, "PRODUCT_CATALOG_ITEM_MISSING", `Product ${product.key} references a missing CatalogItem`, {
        productId: id(product._id),
        catalogItemId: id(product.catalogItemId),
      });
    }
    if (!Number.isInteger(product.priceHalala) || product.priceHalala < 0) {
      pushIssue(errors, "PRODUCT_PRICE_INVALID", `Product ${product.key} has an invalid priceHalala`);
    }
    if (!Array.isArray(product.availableFor) || product.availableFor.some((value) => !["one_time", "subscription"].includes(value))) {
      pushIssue(errors, "PRODUCT_CHANNEL_INVALID", `Product ${product.key} has invalid availableFor values`, product.availableFor);
    }
  }

  for (const option of options) {
    if (!groupById.has(id(option.groupId))) {
      pushIssue(errors, "OPTION_GROUP_MISSING", `Option ${option.key} references a missing option group`, {
        optionId: id(option._id),
        groupId: id(option.groupId),
      });
    }
    if (option.catalogItemId && !catalogItemById.has(id(option.catalogItemId))) {
      pushIssue(errors, "OPTION_CATALOG_ITEM_MISSING", `Option ${option.key} references a missing CatalogItem`, {
        optionId: id(option._id),
        catalogItemId: id(option.catalogItemId),
      });
    }
  }

  for (const relation of productGroups) {
    const product = productById.get(id(relation.productId));
    const group = groupById.get(id(relation.groupId));
    if (!product) pushIssue(errors, "PRODUCT_GROUP_PRODUCT_MISSING", "Product-option-group relation references a missing product", { relationId: id(relation._id) });
    if (!group) pushIssue(errors, "PRODUCT_GROUP_GROUP_MISSING", "Product-option-group relation references a missing group", { relationId: id(relation._id) });
    const min = Number(relation.minSelections || 0);
    const max = relation.maxSelections === null || relation.maxSelections === undefined ? null : Number(relation.maxSelections);
    if (!Number.isInteger(min) || min < 0 || (max !== null && (!Number.isInteger(max) || max < min))) {
      pushIssue(errors, "PRODUCT_GROUP_SELECTION_RULE_INVALID", "Product-option-group relation has invalid selection limits", {
        relationId: id(relation._id), minSelections: relation.minSelections, maxSelections: relation.maxSelections,
      });
    }
    if (relation.isRequired === true && min < 1) {
      pushIssue(errors, "PRODUCT_GROUP_REQUIRED_RULE_INVALID", "Required product-option-group relation must have minSelections >= 1", {
        relationId: id(relation._id),
      });
    }
  }

  for (const relation of productOptions) {
    const product = productById.get(id(relation.productId));
    const group = groupById.get(id(relation.groupId));
    const option = optionById.get(id(relation.optionId));
    if (!product) pushIssue(errors, "PRODUCT_OPTION_PRODUCT_MISSING", "Product-option relation references a missing product", { relationId: id(relation._id) });
    if (!group) pushIssue(errors, "PRODUCT_OPTION_GROUP_MISSING", "Product-option relation references a missing group", { relationId: id(relation._id) });
    if (!option) pushIssue(errors, "PRODUCT_OPTION_OPTION_MISSING", "Product-option relation references a missing option", { relationId: id(relation._id) });
    if (option && id(option.groupId) !== id(relation.groupId)) {
      pushIssue(errors, "PRODUCT_OPTION_GROUP_MISMATCH", `Option ${option.key} belongs to a different group than its product relation`, {
        relationId: id(relation._id),
        optionGroupId: id(option.groupId),
        relationGroupId: id(relation.groupId),
      });
    }
  }

  const sellablePlans = plans.filter((plan) => (
    plan.isActive !== false
    && plan.isDeleted !== true
    && plan.isAvailable !== false
    && plan.active !== false
    && plan.available !== false
  ));
  if (sellablePlans.length === 0) {
    pushIssue(errors, "BOOTSTRAP_NO_SELLABLE_PLANS", "No sellable subscription plans were found");
  }
  for (const plan of sellablePlans) {
    if (!Plan.isViable(plan)) {
      pushIssue(errors, "PLAN_STRUCTURE_INVALID", `Subscription plan ${plan.key || id(plan._id)} has no valid sellable price path`);
    }
  }

  for (const addon of addons) {
    if (addon.kind === "plan") {
      for (const productId of addon.menuProductIds || []) {
        if (!productById.has(id(productId))) {
          pushIssue(errors, "ADDON_PRODUCT_MISSING", `Add-on plan ${addon.category} references a missing MenuProduct`, {
            addonId: id(addon._id), productId: id(productId),
          });
        }
      }
    }
    if (addon.kind === "item" && addon.menuProductId && !productById.has(id(addon.menuProductId))) {
      pushIssue(errors, "ADDON_ITEM_PRODUCT_MISSING", `Add-on item ${id(addon._id)} references a missing MenuProduct`, {
        menuProductId: id(addon.menuProductId),
      });
    }
  }

  for (const row of addonPrices) {
    if (!addonById.has(id(row.addonPlanId))) {
      pushIssue(errors, "ADDON_PRICE_PLAN_MISSING", "Add-on matrix price references a missing add-on plan", { priceId: id(row._id) });
    }
    if (!planById.has(id(row.basePlanId))) {
      pushIssue(errors, "ADDON_PRICE_BASE_PLAN_MISSING", "Add-on matrix price references a missing base plan", { priceId: id(row._id) });
    }
    if (!Number.isInteger(row.priceHalala) || row.priceHalala < 0) {
      pushIssue(errors, "ADDON_PRICE_INVALID", "Add-on matrix price has invalid priceHalala", { priceId: id(row._id) });
    }
  }

  let publicMenuV2 = null;
  try {
    const oneTimeMenu = await getOneTimeOrderMenu({ lang: "en", includePublicV2: true });
    publicMenuV2 = oneTimeMenu.publicMenuV2;
    if (!publicMenuV2 || publicMenuV2.contractVersion !== "one_time_menu.v2") {
      pushIssue(errors, "PUBLIC_MENU_V2_MISSING", "The seeded catalog did not produce one_time_menu.v2");
    } else {
      const seenProductIds = new Set();
      for (const section of publicMenuV2.sections || []) {
        if (!categoryById.has(id(section.id))) {
          pushIssue(errors, "PUBLIC_MENU_CATEGORY_UNKNOWN", `Public menu section ${section.key} does not map to MenuCategory`, { categoryId: id(section.id) });
        }
        for (const product of section.products || []) {
          const stored = productById.get(id(product.id));
          if (!stored) {
            pushIssue(errors, "PUBLIC_MENU_PRODUCT_UNKNOWN", `Public menu product ${product.key} does not map to MenuProduct`, { productId: id(product.id) });
            continue;
          }
          if (id(stored.categoryId) !== id(section.id) || id(product.categoryId) !== id(section.id)) {
            pushIssue(errors, "PUBLIC_MENU_CATEGORY_MISMATCH", `Public menu product ${product.key} is returned under the wrong category`);
          }
          if (seenProductIds.has(id(product.id))) {
            pushIssue(errors, "PUBLIC_MENU_PRODUCT_DUPLICATE", `Public menu product ${product.key} is returned more than once`);
          }
          seenProductIds.add(id(product.id));
        }
      }
    }
  } catch (error) {
    pushIssue(errors, "PUBLIC_MENU_BUILD_FAILED", error.message, { code: error.code });
  }

  try {
    const preview = await menuCatalogService.getDashboardMenuPreview({ lang: "en", includeInactive: true });
    const storedCategoryById = categoryById;
    for (const category of preview.categories || []) {
      const stored = storedCategoryById.get(id(category.id));
      if (!stored) continue;
      const expectedUi = normalizeCategoryUiMetadata(stored.ui);
      if (!same(category.ui || {}, expectedUi)) {
        pushIssue(errors, "CATEGORY_UI_NOT_DATABASE_DRIVEN", `Dashboard preview overrides stored UI for category ${stored.key}`, {
          expected: expectedUi,
          actual: category.ui || {},
        });
      }
    }

    for (const { product } of flattenPreviewProducts(preview)) {
      const stored = productById.get(id(product.id));
      if (!stored) continue;
      const expectedUi = normalizeProductUiMetadata(stored.ui);
      if (!same(product.ui || {}, expectedUi)) {
        pushIssue(errors, "PRODUCT_UI_NOT_DATABASE_DRIVEN", `Dashboard preview overrides stored UI for product ${stored.key}`, {
          expected: expectedUi,
          actual: product.ui || {},
        });
      }
    }

    for (const { group } of flattenPreviewGroups(preview)) {
      const stored = groupById.get(id(group.id));
      if (!stored) continue;
      const expectedUi = normalizeGroupUiMetadata(stored.ui);
      if (!same(group.ui || {}, expectedUi)) {
        pushIssue(errors, "OPTION_GROUP_UI_NOT_DATABASE_DRIVEN", `Dashboard preview overrides stored UI for option group ${stored.key}`, {
          expected: expectedUi,
          actual: group.ui || {},
        });
      }
    }
  } catch (error) {
    pushIssue(errors, "DASHBOARD_MENU_PREVIEW_FAILED", error.message, { code: error.code });
  }

  try {
    const subscriptionCatalogs = await getSubscriptionBuilderCatalogWithV2({
      lang: "en",
      includeV2: true,
      includeV3: true,
      ignorePublishedMealBuilder: true,
    });
    const builderCatalogV2 = subscriptionCatalogs && subscriptionCatalogs.builderCatalogV2;
    const plannerCatalog = subscriptionCatalogs && subscriptionCatalogs.plannerCatalog;
    if (!builderCatalogV2 && !plannerCatalog) {
      pushIssue(errors, "SUBSCRIPTION_CATALOG_MISSING", "The seeded data did not produce a subscription builder catalog");
    }
    for (const [label, catalog] of [["builderCatalogV2", builderCatalogV2], ["plannerCatalog", plannerCatalog]]) {
      if (!catalog) continue;
      if (!Array.isArray(catalog.sections) || catalog.sections.length === 0) {
        pushIssue(errors, "SUBSCRIPTION_CATALOG_SECTIONS_EMPTY", `${label} has no sections`);
      }
      for (const section of catalog.sections || []) {
        if (!section.key) pushIssue(errors, "SUBSCRIPTION_SECTION_KEY_MISSING", `${label} contains a section without a key`);
        if (!Array.isArray(section.products)) pushIssue(errors, "SUBSCRIPTION_SECTION_PRODUCTS_INVALID", `${label}.${section.key} products must be an array`);
      }
    }
  } catch (error) {
    pushIssue(errors, "SUBSCRIPTION_CATALOG_BUILD_FAILED", error.message, { code: error.code });
  }

  if (products.some((product) => product.isCustomizable === true) && productGroups.length === 0) {
    pushIssue(warnings, "CUSTOMIZABLE_PRODUCTS_WITHOUT_RELATIONS", "Customizable products exist but no product option-group relations were found");
  }

  const summary = {
    categories: categories.length,
    products: products.length,
    optionGroups: optionGroups.length,
    options: options.length,
    productGroups: productGroups.length,
    productOptions: productOptions.length,
    catalogItems: catalogItems.length,
    plans: plans.length,
    sellablePlans: sellablePlans.length,
    addons: addons.length,
    addonPrices: addonPrices.length,
    publicSections: publicMenuV2 && Array.isArray(publicMenuV2.sections) ? publicMenuV2.sections.length : 0,
    errors: errors.length,
    warnings: warnings.length,
  };

  log.log(`Bootstrap structure verification: categories=${summary.categories} products=${summary.products} optionGroups=${summary.optionGroups} options=${summary.options} plans=${summary.plans} addons=${summary.addons} errors=${summary.errors} warnings=${summary.warnings}`);
  for (const warning of warnings) (log.warn || log.log).call(log, `[bootstrap-verify:warning] ${warning.code}: ${warning.message}`);

  if (strict && errors.length > 0) {
    const error = new Error(`Bootstrap structure verification failed with ${errors.length} error(s)`);
    error.code = "BOOTSTRAP_STRUCTURE_INVALID";
    error.details = errors;
    throw error;
  }

  return { ok: errors.length === 0, summary, errors, warnings };
}

async function main() {
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    await verifyBootstrapStructure({ strict: true, log: console });
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[bootstrap:verify] ${error.code ? `${error.code}: ` : ""}${error.message}`);
    if (Array.isArray(error.details)) console.error(JSON.stringify(error.details, null, 2));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  verifyBootstrapStructure,
};
