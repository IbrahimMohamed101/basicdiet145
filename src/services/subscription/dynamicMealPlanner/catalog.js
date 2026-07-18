const MenuCategory = require("../../../models/MenuCategory");
const MenuProduct = require("../../../models/MenuProduct");
const MenuOptionGroup = require("../../../models/MenuOptionGroup");
const MenuOption = require("../../../models/MenuOption");
const ProductOptionGroup = require("../../../models/ProductOptionGroup");
const ProductGroupOption = require("../../../models/ProductGroupOption");
const { loadCatalogItemsByIdForDocs } = require("../../catalog/catalogAvailabilityService");
const { SYSTEM_CURRENCY } = require("./constants");
const {
  uniqueIds,
  localized,
  plainObject,
  eligibilityForDoc,
  relationUsable,
  localizedName,
  pricingForProduct,
  normalizePagination,
  matchesSearch,
} = require("./core");

async function buildProductCardMap(products = [], lang = "en") {
  const uniqueProducts = [...new Map(products.filter(Boolean).map((row) => [String(row._id), row])).values()];
  const productIds = uniqueProducts.map((row) => row._id);
  if (!productIds.length) return new Map();

  const groupRelations = await ProductOptionGroup.find({ productId: { $in: productIds } })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  const groupIds = [...new Set(groupRelations.map((row) => String(row.groupId)))];
  const optionRelations = await ProductGroupOption.find({ productId: { $in: productIds } })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  const optionIds = [...new Set(optionRelations.map((row) => String(row.optionId)))];
  const categoryIds = [...new Set(uniqueProducts.map((row) => String(row.categoryId || "")).filter(Boolean))];

  const [groups, options, categories, catalogItemsById] = await Promise.all([
    groupIds.length ? MenuOptionGroup.find({ _id: { $in: groupIds } }).lean() : [],
    optionIds.length ? MenuOption.find({ _id: { $in: optionIds } }).lean() : [],
    categoryIds.length ? MenuCategory.find({ _id: { $in: categoryIds } }).lean() : [],
    loadCatalogItemsByIdForDocs(uniqueProducts),
  ]);
  const optionCatalogItemsById = await loadCatalogItemsByIdForDocs(options);
  for (const [key, value] of optionCatalogItemsById.entries()) catalogItemsById.set(key, value);

  const groupsById = new Map(groups.map((row) => [String(row._id), row]));
  const optionsById = new Map(options.map((row) => [String(row._id), row]));
  const categoriesById = new Map(categories.map((row) => [String(row._id), row]));
  const groupRelationsByProduct = new Map();
  const optionRelationsByProductGroup = new Map();
  for (const relation of groupRelations) {
    const key = String(relation.productId);
    if (!groupRelationsByProduct.has(key)) groupRelationsByProduct.set(key, []);
    groupRelationsByProduct.get(key).push(relation);
  }
  for (const relation of optionRelations) {
    const key = `${String(relation.productId)}:${String(relation.groupId)}`;
    if (!optionRelationsByProductGroup.has(key)) optionRelationsByProductGroup.set(key, []);
    optionRelationsByProductGroup.get(key).push(relation);
  }

  const cards = new Map();
  for (const product of uniqueProducts) {
    const productId = String(product._id);
    const category = categoriesById.get(String(product.categoryId)) || null;
    const productEligibility = eligibilityForDoc(product, catalogItemsById, "PRODUCT");
    const optionGroups = [];
    for (const groupRelation of groupRelationsByProduct.get(productId) || []) {
      if (!relationUsable(groupRelation)) continue;
      const group = groupsById.get(String(groupRelation.groupId));
      if (!group) continue;
      const groupEligibility = eligibilityForDoc(group, catalogItemsById, "GROUP");
      if (!groupEligibility.eligible) continue;
      const optionRows = [];
      for (const optionRelation of optionRelationsByProductGroup.get(`${productId}:${String(group._id)}`) || []) {
        if (!relationUsable(optionRelation)) continue;
        const option = optionsById.get(String(optionRelation.optionId));
        const optionEligibility = eligibilityForDoc(option, catalogItemsById, "OPTION");
        if (!option || !optionEligibility.eligible) continue;
        optionRows.push({
          id: String(option._id),
          optionId: String(option._id),
          key: option.key || "",
          name: localizedName(option.name, lang),
          nameI18n: localized(option.name),
          description: localizedName(option.description, lang),
          descriptionI18n: localized(option.description),
          imageUrl: option.imageUrl || "",
          sortOrder: Number(optionRelation.sortOrder ?? option.sortOrder ?? 0),
          pricing: {
            extraPriceHalala: Number(optionRelation.extraPriceHalala ?? option.extraPriceHalala ?? 0),
            extraWeightUnitGrams: Number(optionRelation.extraWeightUnitGrams ?? option.extraWeightUnitGrams ?? 0),
            extraWeightPriceHalala: Number(optionRelation.extraWeightPriceHalala ?? option.extraWeightPriceHalala ?? 0),
            currency: option.currency || SYSTEM_CURRENCY,
          },
          premiumKey: option.premiumKey || null,
          proteinFamilyKey: option.proteinFamilyKey || "",
          displayCategoryKey: option.displayCategoryKey || "",
          ruleTags: Array.isArray(option.ruleTags) ? option.ruleTags : [],
        });
      }
      optionGroups.push({
        id: String(group._id),
        groupId: String(group._id),
        key: group.key || "",
        name: localizedName(group.name, lang),
        nameI18n: localized(group.name),
        displayStyle: group.ui?.displayStyle || "list",
        minSelections: Number(groupRelation.minSelections || 0),
        maxSelections: groupRelation.maxSelections === null || groupRelation.maxSelections === undefined
          ? null
          : Number(groupRelation.maxSelections),
        required: groupRelation.isRequired === true || Number(groupRelation.minSelections || 0) > 0,
        sortOrder: Number(groupRelation.sortOrder ?? group.sortOrder ?? 0),
        options: optionRows.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)),
      });
    }

    cards.set(productId, {
      id: productId,
      productId,
      key: product.key || "",
      name: localizedName(product.name, lang),
      nameI18n: localized(product.name),
      description: localizedName(product.description, lang),
      descriptionI18n: localized(product.description),
      imageUrl: product.imageUrl || "",
      category: category ? {
        id: String(category._id),
        key: category.key || "",
        name: localizedName(category.name, lang),
        nameI18n: localized(category.name),
      } : null,
      itemType: product.itemType || "product",
      selectionType: product.itemType || "product",
      sortOrder: Number(product.sortOrder || 0),
      pricing: pricingForProduct(product),
      ui: plainObject(product.ui),
      isCustomizable: product.isCustomizable === true || product.pricingModel === "per_100g" || optionGroups.length > 0,
      action: {
        type: product.isCustomizable === true || product.pricingModel === "per_100g" || optionGroups.length > 0
          ? "open_builder"
          : "direct_add",
        requiresBuilder: product.isCustomizable === true || product.pricingModel === "per_100g" || optionGroups.length > 0,
      },
      optionGroups: optionGroups.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)),
      availability: { eligible: productEligibility.eligible, reasonCodes: productEligibility.reasons },
    });
  }
  return cards;
}

async function buildProductPicker({ section, lang, q, includeUnavailable, page, limit, categoryId } = {}) {
  const products = await MenuProduct.find(categoryId ? { categoryId } : {}).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const categories = await MenuCategory.find({ _id: { $in: products.map((row) => row.categoryId) } }).lean();
  const categoriesById = new Map(categories.map((row) => [String(row._id), row]));
  const catalogItemsById = await loadCatalogItemsByIdForDocs(products);
  const selected = new Set(uniqueIds(section?.selectedProductIds));
  let rows = products.filter((row) => matchesSearch(row, q)).map((product) => {
    const eligibility = eligibilityForDoc(product, catalogItemsById, "PRODUCT");
    const category = categoriesById.get(String(product.categoryId)) || null;
    return {
      id: String(product._id),
      productId: String(product._id),
      type: "product",
      key: product.key || "",
      name: localized(product.name),
      label: localizedName(product.name, lang),
      imageUrl: product.imageUrl || "",
      itemType: product.itemType || "product",
      category: category ? { id: String(category._id), key: category.key || "", name: localized(category.name) } : null,
      pricing: pricingForProduct(product),
      selected: selected.has(String(product._id)),
      eligible: eligibility.eligible,
      selectable: true,
      state: selected.has(String(product._id)) ? "selected" : eligibility.eligible ? "eligible" : "unavailable",
      reasonCodes: eligibility.reasons,
      sortOrder: Number(product.sortOrder || 0),
    };
  });
  if (!includeUnavailable) rows = rows.filter((row) => row.eligible || row.selected);
  rows.sort((a, b) => Number(b.selected) - Number(a.selected) || a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  const pagination = normalizePagination({ page, limit });
  const total = rows.length;
  return {
    candidateType: "product",
    candidates: rows.slice(pagination.skip, pagination.skip + pagination.limit),
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
      eligible: rows.filter((row) => row.eligible).length,
      unavailable: rows.filter((row) => !row.eligible).length,
    },
  };
}

async function buildOptionPicker({ section, lang, q, includeUnavailable, page, limit } = {}) {
  const filter = section?.sourceGroupId ? { groupId: section.sourceGroupId } : {};
  const options = await MenuOption.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(options);
  const selected = new Set(uniqueIds(section?.selectedOptionIds));
  let rows = options.filter((row) => matchesSearch(row, q)).map((option) => {
    const eligibility = eligibilityForDoc(option, catalogItemsById, "OPTION");
    return {
      id: String(option._id),
      optionId: String(option._id),
      type: "option",
      key: option.key || "",
      name: localized(option.name),
      label: localizedName(option.name, lang),
      imageUrl: option.imageUrl || "",
      selected: selected.has(String(option._id)),
      eligible: eligibility.eligible,
      selectable: true,
      state: selected.has(String(option._id)) ? "selected" : eligibility.eligible ? "eligible" : "unavailable",
      reasonCodes: eligibility.reasons,
      sortOrder: Number(option.sortOrder || 0),
    };
  });
  if (!includeUnavailable) rows = rows.filter((row) => row.eligible || row.selected);
  rows.sort((a, b) => Number(b.selected) - Number(a.selected) || a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  const pagination = normalizePagination({ page, limit });
  const total = rows.length;
  return {
    candidateType: "option",
    candidates: rows.slice(pagination.skip, pagination.skip + pagination.limit),
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
      eligible: rows.filter((row) => row.eligible).length,
      unavailable: rows.filter((row) => !row.eligible).length,
    },
  };
}

module.exports = { buildProductCardMap, buildProductPicker, buildOptionPicker };
