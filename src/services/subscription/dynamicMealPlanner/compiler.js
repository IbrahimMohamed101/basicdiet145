const MenuCategory = require("../../../models/MenuCategory");
const MenuProduct = require("../../../models/MenuProduct");
const MenuOption = require("../../../models/MenuOption");
const { loadCatalogItemsByIdForDocs } = require("../../catalog/catalogAvailabilityService");
const { listActiveReadyPremiumUpgradeConfigs } = require("../premiumUpgradeConfigService");
const { CONTRACT_VERSION, CONFIG_VERSION, SYSTEM_CURRENCY } = require("./constants");
const {
  stringId,
  localized,
  plainObject,
  slugify,
  stableHash,
  isPremiumDynamicSection,
  normalizeSections,
  draftHashForSections,
  eligibilityForDoc,
  localizedName,
} = require("./core");
const { buildProductCardMap } = require("./catalog");

async function buildDefaultSections() {
  const [categories, products] = await Promise.all([
    MenuCategory.find({}).sort({ sortOrder: 1, createdAt: 1 }).lean(),
    MenuProduct.find({}).sort({ sortOrder: 1, createdAt: 1 }).lean(),
  ]);
  const catalogItemsById = await loadCatalogItemsByIdForDocs(products);
  const eligibleProducts = products.filter((row) => eligibilityForDoc(row, catalogItemsById, "PRODUCT").eligible);
  const byCategory = new Map();
  for (const product of eligibleProducts) {
    const key = String(product.categoryId);
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(product);
  }
  const sections = [{
    key: "premium",
    sectionType: "product_list",
    sourceKind: "premium_visual",
    titleOverride: { ar: "الوجبات المميزة", en: "Premium Meals" },
    selectedProductIds: [],
    includeMode: "selected",
    selectionType: "premium",
    sortOrder: 10,
    required: false,
    visible: true,
    metadata: { premiumDynamic: true, managedBy: "premium_upgrades" },
  }];
  let order = 20;
  for (const category of categories) {
    const rows = byCategory.get(String(category._id)) || [];
    if (!rows.length) continue;
    sections.push({
      key: slugify(category.key || category.name?.en || category.name?.ar, `category_${order}`),
      sectionType: "product_list",
      sourceKind: "product_list",
      titleOverride: localized(category.name),
      sourceCategoryId: String(category._id),
      selectedProductIds: rows.map((row) => String(row._id)),
      includeMode: "selected",
      selectionType: "product",
      sortOrder: order,
      required: false,
      visible: true,
      metadata: { generatedFromMenuCategory: true },
    });
    order += 10;
  }
  return normalizeSections(sections);
}

async function resolveSectionRows(sections, lang = "en") {
  const premiumRows = await listActiveReadyPremiumUpgradeConfigs();
  const result = [];
  const allProducts = [];
  const allOptions = [];
  for (const section of sections) {
    let productRows = [];
    let optionRows = [];
    if (isPremiumDynamicSection(section)) {
      const premiumProductDocs = premiumRows
        .filter((row) => row.config?.sourceType === "menu_product" && row.sourceDoc)
        .map((row) => row.sourceDoc);
      const manual = section.selectedProductIds.length
        ? await MenuProduct.find({ _id: { $in: section.selectedProductIds } }).lean()
        : [];
      productRows = [...premiumProductDocs, ...manual];
    } else if (section.sectionType === "product_category" && section.includeMode === "all" && section.sourceCategoryId) {
      productRows = await MenuProduct.find({ categoryId: section.sourceCategoryId }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    } else if (section.sectionType !== "option_group" && section.selectedProductIds.length) {
      productRows = await MenuProduct.find({ _id: { $in: section.selectedProductIds } }).lean();
    }
    if (section.sectionType === "option_group" && section.selectedOptionIds.length) {
      optionRows = await MenuOption.find({ _id: { $in: section.selectedOptionIds } }).lean();
      if (section.productContextId) {
        const context = await MenuProduct.findById(section.productContextId).lean();
        if (context) productRows.push(context);
      }
    }
    result.push({ section, productRows, optionRows, premiumRows, lang });
    allProducts.push(...productRows);
    allOptions.push(...optionRows);
  }
  return { rows: result, allProducts, allOptions };
}

function premiumVirtualCards(premiumRows, lang) {
  return premiumRows
    .filter((row) => row.config?.sourceType === "menu_option" && row.sourceDoc)
    .map(({ config, sourceDoc }) => ({
      id: `premium:${String(config._id)}`,
      productId: config.sourceProductId ? String(config.sourceProductId) : null,
      optionId: String(sourceDoc._id),
      entityType: "premium_option",
      key: config.premiumKey || sourceDoc.key || "",
      name: localizedName(sourceDoc.name || config.sourceSnapshot?.name, lang),
      nameI18n: localized(sourceDoc.name || config.sourceSnapshot?.name),
      description: localizedName(sourceDoc.description, lang),
      descriptionI18n: localized(sourceDoc.description),
      imageUrl: sourceDoc.imageUrl || "",
      itemType: "premium_meal",
      selectionType: config.selectionType || "premium_meal",
      pricing: {
        model: "premium_upgrade",
        priceHalala: Number(config.upgradeDeltaHalala || 0),
        currency: config.currency || SYSTEM_CURRENCY,
        weight: { enabled: false },
      },
      premium: {
        premiumKey: config.premiumKey,
        configId: String(config._id),
        revision: Number(config.revision || 0),
        sourceType: config.sourceType,
        sourceId: String(config.sourceId),
        sourceProductId: stringId(config.sourceProductId),
        sourceGroupId: stringId(config.sourceGroupId),
      },
      action: { type: "open_builder", requiresBuilder: true },
      optionGroups: [],
      availability: { eligible: true, reasonCodes: [] },
      sortOrder: Number(config.sortOrder || 0),
    }));
}

async function compileSections(sections, lang = "en") {
  const resolved = await resolveSectionRows(sections, lang);
  const productCardMap = await buildProductCardMap(resolved.allProducts, lang);
  const productCatalogItemsById = await loadCatalogItemsByIdForDocs(resolved.allProducts);
  const optionCatalogItemsById = await loadCatalogItemsByIdForDocs(resolved.allOptions);
  const compiled = [];
  const contractIssues = [];

  for (const entry of resolved.rows) {
    const { section, productRows, optionRows, premiumRows } = entry;
    const sectionIssues = [];
    const productCards = [];
    const seen = new Set();
    for (const product of productRows) {
      const eligibility = eligibilityForDoc(product, productCatalogItemsById, "PRODUCT");
      if (!eligibility.eligible) {
        sectionIssues.push({
          level: section.required ? "error" : "warning",
          code: "MEAL_PLANNER_PRODUCT_NOT_ELIGIBLE",
          sectionKey: section.key,
          productId: String(product._id),
          productKey: product.key || "",
          reasonCodes: eligibility.reasons,
        });
        continue;
      }
      const card = productCardMap.get(String(product._id));
      if (card && !seen.has(card.id)) {
        productCards.push(card);
        seen.add(card.id);
      }
    }

    if (isPremiumDynamicSection(section)) {
      for (const virtual of premiumVirtualCards(premiumRows, lang)) {
        if (!seen.has(virtual.id)) {
          productCards.push(virtual);
          seen.add(virtual.id);
        }
      }
    }

    if (section.sectionType === "option_group") {
      const contextCard = section.productContextId ? productCardMap.get(String(section.productContextId)) : null;
      const optionEligibilityRows = optionRows.map((option) => ({ option, eligibility: eligibilityForDoc(option, optionCatalogItemsById, "OPTION") }));
      const validOptions = optionEligibilityRows.filter((row) => row.eligibility.eligible).map((row) => row.option);
      for (const row of optionEligibilityRows.filter((value) => !value.eligibility.eligible)) {
        sectionIssues.push({
          level: section.required ? "error" : "warning",
          code: "MEAL_PLANNER_OPTION_NOT_ELIGIBLE",
          sectionKey: section.key,
          optionId: String(row.option._id),
          optionKey: row.option.key || "",
          reasonCodes: row.eligibility.reasons,
        });
      }
      if (contextCard) {
        const selectedSet = new Set(validOptions.map((row) => String(row._id)));
        const group = contextCard.optionGroups.find((row) => row.groupId === String(section.sourceGroupId));
        const selectedGroup = group ? {
          ...group,
          minSelections: section.minSelections,
          maxSelections: section.maxSelections,
          required: section.required,
          options: group.options.filter((option) => selectedSet.has(option.optionId)),
        } : null;
        productCards.length = 0;
        productCards.push({
          ...contextCard,
          selectionType: section.selectionType || contextCard.selectionType,
          optionGroups: selectedGroup ? [selectedGroup] : [],
        });
      }
    }

    productCards.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.key).localeCompare(String(b.key)));
    if (section.required && productCards.length === 0) {
      sectionIssues.push({ level: "error", code: "MEAL_PLANNER_REQUIRED_SECTION_EMPTY", sectionKey: section.key });
    } else if (productCards.length === 0) {
      sectionIssues.push({ level: "warning", code: "MEAL_PLANNER_SECTION_EMPTY", sectionKey: section.key });
    }

    contractIssues.push(...sectionIssues);
    compiled.push({
      id: `section:${section.key}`,
      key: section.key,
      name: localizedName(section.titleOverride, lang),
      nameI18n: localized(section.titleOverride),
      type: isPremiumDynamicSection(section)
        ? "premium_dynamic"
        : section.sectionType === "option_group"
          ? "configurable_product"
          : "product_list",
      sourceKind: section.sourceKind,
      selectionType: section.selectionType || "product",
      sortOrder: Number(section.sortOrder || 0),
      required: section.required === true,
      visible: section.visible !== false,
      ui: plainObject(section.metadata?.ui || section.metadata),
      rules: {
        minSelections: Number(section.minSelections || 0),
        maxSelections: section.maxSelections === null || section.maxSelections === undefined ? null : Number(section.maxSelections),
        multiSelect: section.multiSelect === true,
        ...plainObject(section.rules),
      },
      managedBy: isPremiumDynamicSection(section) ? "premium_upgrades" : "dashboard",
      products: productCards,
      issues: sectionIssues,
    });
  }
  return { sections: compiled, issues: contractIssues };
}

async function validateConfigObject(config) {
  const sections = normalizeSections(config?.sections || []);
  const compiled = await compileSections(sections, "en");
  const errors = compiled.issues.filter((issue) => issue.level === "error");
  const warnings = compiled.issues.filter((issue) => issue.level !== "error");
  if (!sections.length) errors.push({ level: "error", code: "MEAL_PLANNER_SECTIONS_EMPTY" });
  return {
    status: errors.length ? "error" : warnings.length ? "warning" : "ready",
    ready: errors.length === 0,
    contractVersion: CONTRACT_VERSION,
    errors,
    warnings,
    checks: [...errors, ...warnings],
    summary: {
      sections: sections.length,
      visibleSections: compiled.sections.filter((row) => row.visible).length,
      products: compiled.sections.reduce((sum, row) => sum + row.products.length, 0),
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

async function compileContract({ config = null, lang = "en", source = "published_config" } = {}) {
  let effective = config;
  let effectiveSource = source;
  if (!effective) {
    effectiveSource = "catalog_fallback";
    effective = {
      _id: null,
      status: "virtual",
      isCurrent: true,
      contractVersion: CONFIG_VERSION,
      versionNumber: 0,
      revisionHash: "",
      sections: await buildDefaultSections(),
    };
  }
  const sections = normalizeSections(effective.sections || []);
  const compiled = await compileSections(sections, lang);
  const errors = compiled.issues.filter((issue) => issue.level === "error");
  const warnings = compiled.issues.filter((issue) => issue.level !== "error");
  const stablePayload = {
    contractVersion: CONTRACT_VERSION,
    currency: SYSTEM_CURRENCY,
    source: effectiveSource,
    published: effectiveSource === "published_config",
    publishedVersionId: stringId(effective._id),
    versionNumber: Number(effective.versionNumber || 0),
    revisionHash: effective.revisionHash || draftHashForSections(sections),
    ready: errors.length === 0,
    sections: compiled.sections.filter((section) => section.visible),
    issues: { errors, warnings },
  };
  return { ...stablePayload, catalogHash: stableHash(stablePayload) };
}

module.exports = { buildDefaultSections, compileSections, validateConfigObject, compileContract };
