"use strict";

const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuProduct = require("../../models/MenuProduct");

const INSTALL_MARK = Symbol.for("basicdiet.orders.oneTimeBuilderSelectionContract.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.orders.oneTimeBuilderSelectionContract.wrapped");
const REQUIRED_BASIC_MEAL_GROUPS = Object.freeze(["protein", "carb"]);

function selectionArray(item = {}) {
  const value = item.selectedOptions || item.options || (item.selections && item.selections.options) || [];
  return Array.isArray(value) ? value : [];
}

function normalizeGroupKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (["proteins", "protein"].includes(key)) return "protein";
  if (["carbs", "carb", "carbohydrate", "carbohydrates", "starch", "starches"].includes(key)) return "carb";
  return key;
}

function createIncompleteBuilderError(productId, missingGroups) {
  const err = new Error("Basic meal requires a protein and at least one carb selection");
  err.code = "BUILDER_SELECTION_INCOMPLETE";
  err.status = 422;
  err.details = {
    productId: String(productId),
    requiredGroups: [...REQUIRED_BASIC_MEAL_GROUPS],
    missingGroups,
  };
  return err;
}

async function assertCompleteBuilderItems(items = [], {
  MenuProductModel = MenuProduct,
  MenuOptionGroupModel = MenuOptionGroup,
} = {}) {
  const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const productIds = [...new Set(normalizedItems
    .map((item) => item.productId || item.menuProductId)
    .filter(Boolean)
    .map(String))];
  if (!productIds.length) return;

  const products = await MenuProductModel.find({ _id: { $in: productIds } })
    .select("_id key itemType isCustomizable")
    .lean();
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const basicItems = normalizedItems.filter((item) => {
    const product = productsById.get(String(item.productId || item.menuProductId || ""));
    return product && String(product.key || "").trim().toLowerCase() === "basic_meal";
  });
  if (!basicItems.length) return;

  const groupIds = [...new Set(basicItems.flatMap((item) => selectionArray(item))
    .map((selection) => selection && selection.groupId)
    .filter(Boolean)
    .map(String))];
  const groups = groupIds.length
    ? await MenuOptionGroupModel.find({ _id: { $in: groupIds } }).select("_id key").lean()
    : [];
  const groupKeyById = new Map(groups.map((group) => [String(group._id), normalizeGroupKey(group.key)]));

  for (const item of basicItems) {
    const productId = item.productId || item.menuProductId;
    const selectedGroups = new Set(selectionArray(item)
      .filter((selection) => selection && Number(selection.qty === undefined ? 1 : selection.qty) > 0)
      .map((selection) => normalizeGroupKey(
        selection.canonicalGroupKey
          || selection.groupKey
          || groupKeyById.get(String(selection.groupId || ""))
      ))
      .filter(Boolean));
    const missingGroups = REQUIRED_BASIC_MEAL_GROUPS.filter((group) => !selectedGroups.has(group));
    if (missingGroups.length) throw createIncompleteBuilderError(productId, missingGroups);
  }
}

function installOneTimeBuilderSelectionContract() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./menuPricingService");
  const original = service.priceMenuCart;
  if (typeof original === "function" && !original[WRAPPED_MARK]) {
    const wrapped = async function priceCompleteBuilderCart(args = {}) {
      await assertCompleteBuilderItems(args.items || []);
      return original.call(this, args);
    };
    wrapped[WRAPPED_MARK] = true;
    service.priceMenuCart = wrapped;
  }
  const verification = Object.freeze({
    installed: true,
    basicMealProteinRequired: true,
    basicMealCarbRequired: true,
    quoteAndCheckoutShareValidation: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installOneTimeBuilderSelectionContract();

module.exports = {
  assertCompleteBuilderItems,
  installOneTimeBuilderSelectionContract,
  normalizeGroupKey,
};
