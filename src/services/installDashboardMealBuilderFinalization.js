"use strict";

const MealBuilderConfig = require("../models/MealBuilderConfig");
const MenuOption = require("../models/MenuOption");
const MenuProduct = require("../models/MenuProduct");
const {
  MEAL_SELECTION_TYPES,
} = require("../config/mealPlannerContract");
const menuCatalogService = require("./orders/menuCatalogService");
const baseMealBuilderService = require("./subscription/mealBuilderConfigService");
const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");
const completeCatalogService = require("./subscription/dashboardMealBuilderCatalogService");
const {
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("./catalog/catalogAvailabilityService");
const {
  buildMealPlannerClassification,
  classifyMealProduct,
  directSelectionType,
  isProductionDirectProduct,
} = require("./catalog/mealProductClassificationService");
const {
  applyOptionMealMetadata,
  hasOptionMealMetadata,
  prepareOptionMealMetadataPatch,
  serializeOptionMealMetadata,
} = require("./catalog/dashboardOptionMealMetadataService");

const DEFAULT_SECTION_KEYS = Object.freeze([
  "premium",
  "sandwich",
  "chicken",
  "beef",
  "fish",
  "eggs",
  "carbs",
]);
const IGNORED_DEFAULT_SEED_ISSUE_CODES = new Set([
  "MEAL_BUILDER_DEFAULT_SANDWICH_SOURCE_MISSING",
]);

let installed = false;

function sectionKeyOf(section = {}) {
  return String(section.key || section.sectionKey || "").trim().toLowerCase();
}

function isSubscriptionEnabled(product = {}) {
  if (product.availableForSubscription === false) return false;
  if (!Array.isArray(product.availableFor) || product.availableFor.length === 0) {
    return true;
  }
  return product.availableFor.includes("subscription");
}

function productIsCustomerReady(product = {}, catalogItemsById = new Map()) {
  return (
    product.isActive !== false &&
    product.isVisible !== false &&
    product.isAvailable !== false &&
    Boolean(product.publishedAt) &&
    isSubscriptionEnabled(product) &&
    isLinkedDocGloballyAvailable(product, catalogItemsById)
  );
}

async function loadReadyDirectProducts() {
  const products = await MenuProduct.find({})
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(products);
  return products.filter(
    (product) =>
      isProductionDirectProduct(product) &&
      productIsCustomerReady(product, catalogItemsById)
  );
}

function buildDirectDefaultSection(products = []) {
  return {
    key: "sandwich",
    sectionType: "product_list",
    sourceKind: "product_list",
    includeMode: "selected",
    selectedProductIds: products.map((product) => product._id),
    selectionType: MEAL_SELECTION_TYPES.SANDWICH,
    titleOverride: {
      ar: "ساندويتشات ووجبات جاهزة",
      en: "Sandwiches & Full Meals",
    },
    required: false,
    minSelections: 0,
    maxSelections: 1,
    multiSelect: false,
    visible: true,
    availableFor: ["subscription"],
    metadata: {
      requiresBuilder: false,
      treatAsFullMeal: true,
      classificationAuthority: "meal_product_classification.v1",
    },
    rules: { carbsRequired: false },
    sortOrder: 20,
  };
}

function seedIssuesWithoutLegacyDirectProductGap(built = {}) {
  return [...(built.errors || []), ...(built.warnings || [])].filter(
    (issue) => !IGNORED_DEFAULT_SEED_ISSUE_CODES.has(issue?.code)
  );
}

async function buildCompatibleDefaultSeedSections() {
  const [built, directProducts] = await Promise.all([
    baseMealBuilderService.buildDefaultVisualTemplateSections({
      returnDetails: true,
    }),
    loadReadyDirectProducts(),
  ]);

  if (!directProducts.length) {
    throw new baseMealBuilderService.MealBuilderError(
      "Default Meal Builder seed has no ready direct meal products",
      "MEAL_BUILDER_DEFAULT_SANDWICH_SOURCE_MISSING",
      422
    );
  }

  const sections = [
    ...(built.sections || []).filter(
      (section) => sectionKeyOf(section) !== "sandwich"
    ),
    buildDirectDefaultSection(directProducts),
  ];
  const normalized = baseMealBuilderService.normalizeSections(sections);
  const actualKeys = normalized.map(sectionKeyOf);
  const missingKeys = DEFAULT_SECTION_KEYS.filter(
    (key) => !actualKeys.includes(key)
  );
  const unexpectedKeys = actualKeys.filter(
    (key) => !DEFAULT_SECTION_KEYS.includes(key)
  );
  const duplicateKeys = [
    ...new Set(
      actualKeys.filter((key, index) => actualKeys.indexOf(key) !== index)
    ),
  ];
  const orderMatches =
    actualKeys.length === DEFAULT_SECTION_KEYS.length &&
    actualKeys.every((key, index) => key === DEFAULT_SECTION_KEYS[index]);
  const validation = await baseMealBuilderService.validateConfigObject({
    sections: normalized,
  });
  const issues = [
    ...seedIssuesWithoutLegacyDirectProductGap(built),
    ...(validation.errors || []),
    ...(validation.warnings || []),
  ];

  if (
    missingKeys.length ||
    unexpectedKeys.length ||
    duplicateKeys.length ||
    !orderMatches ||
    issues.length
  ) {
    throw new baseMealBuilderService.MealBuilderError(
      "Default Meal Builder seed is incomplete",
      "MEAL_BUILDER_DEFAULT_SEED_INCOMPLETE",
      422,
      {
        expectedSectionKeys: [...DEFAULT_SECTION_KEYS],
        actualSectionKeys: actualKeys,
        missingSectionKeys: missingKeys,
        unexpectedSectionKeys: unexpectedKeys,
        duplicateSectionKeys: duplicateKeys,
        orderMatches,
        issues,
      }
    );
  }

  return normalized;
}

async function createCompatibleDefaultDraft({ actor = {}, notes = "" } = {}) {
  const [published, existingDraft] = await Promise.all([
    baseMealBuilderService.getCurrentPublishedConfig(),
    MealBuilderConfig.findOne({ status: "draft", isCurrent: true })
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  if (!published && existingDraft) {
    return baseMealBuilderService.serializeConfig(existingDraft);
  }
  if (published) {
    return mealBuilderService.__originalCreateDraft({ actor, notes });
  }

  const sections = await buildCompatibleDefaultSeedSections();
  await MealBuilderConfig.updateMany(
    { status: "draft", isCurrent: true },
    { $set: { isCurrent: false } }
  );
  const draft = await MealBuilderConfig.create({
    status: "draft",
    isCurrent: true,
    contractVersion: baseMealBuilderService.CONTRACT_VERSION,
    basedOnPublishedVersionId: null,
    source: "dashboard",
    createdBySystem: false,
    bootstrapKey: "",
    sections,
    notes: String(notes || ""),
    createdBy: actor.userId || null,
    updatedBy: actor.userId || null,
  });
  return baseMealBuilderService.serializeConfig(draft.toObject());
}

function mergeOptionMetadata(result = {}, option = {}) {
  return {
    ...result,
    ...serializeOptionMealMetadata(option),
  };
}

function installOptionMetadataWrites() {
  if (menuCatalogService.createOption.__mealMetadataFinalized === true) return;

  const originalCreateOption = menuCatalogService.createOption.bind(
    menuCatalogService
  );
  const originalUpdateOption = menuCatalogService.updateOption.bind(
    menuCatalogService
  );

  menuCatalogService.createOption = async function finalizedCreateOption(
    body = {},
    actor = {}
  ) {
    const prepared = prepareOptionMealMetadataPatch(body, {});
    const result = await originalCreateOption(body, actor);
    if (!prepared.hasChanges) return result;
    const optionId = result.id || result._id;
    const option = await applyOptionMealMetadata({
      optionId,
      preparedPatch: prepared,
      actor,
      action: "option_meal_metadata_created",
    });
    return mergeOptionMetadata(result, option);
  };

  menuCatalogService.updateOption = async function finalizedUpdateOption(
    optionId,
    body = {},
    actor = {}
  ) {
    if (!hasOptionMealMetadata(body)) {
      return originalUpdateOption(optionId, body, actor);
    }
    const existing = await MenuOption.findById(optionId).lean();
    const prepared = prepareOptionMealMetadataPatch(body, existing || {});
    const result = await originalUpdateOption(optionId, body, actor);
    const option = await applyOptionMealMetadata({
      optionId,
      preparedPatch: prepared,
      actor,
      action: "option_meal_metadata_changed",
    });
    return mergeOptionMetadata(result, option);
  };

  menuCatalogService.createOption.__mealMetadataFinalized = true;
  menuCatalogService.updateOption.__mealMetadataFinalized = true;
}

async function assertCanonicalDirectProductIds(value = []) {
  const ids = [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    ),
  ];
  if (!ids.length) return;

  const products = await MenuProduct.find({ _id: { $in: ids } })
    .select("itemType ui.cardVariant key")
    .lean();
  const productsById = new Map(
    products.map((product) => [String(product._id), product])
  );
  const missingProductIds = ids.filter((id) => !productsById.has(id));
  if (missingProductIds.length) {
    throw new mealBuilderService.MealBuilderError(
      "Some products do not exist",
      "MEAL_BUILDER_PRODUCT_NOT_FOUND",
      404,
      { productIds: missingProductIds }
    );
  }

  const invalidProducts = products
    .filter((product) => !isProductionDirectProduct(product))
    .map((product) => ({
      id: String(product._id),
      key: product.key || "",
      itemType: product.itemType || "",
      cardVariant: product?.ui?.cardVariant || "",
      classification: classifyMealProduct(product).kind,
    }));
  if (invalidProducts.length) {
    throw new mealBuilderService.MealBuilderError(
      "Only canonical direct meal products can be added to this card",
      "MEAL_BUILDER_PRODUCT_TYPE_INVALID",
      422,
      { products: invalidProducts }
    );
  }
}

function installDirectProductActions() {
  if (mealBuilderService.createProductSection.__canonicalClassification === true) {
    return;
  }

  const originalCreateProductSection =
    mealBuilderService.createProductSection.bind(mealBuilderService);
  const originalAddProductsToSection =
    mealBuilderService.addProductsToSection.bind(mealBuilderService);
  const originalUpdateProductSection =
    mealBuilderService.updateProductSection.bind(mealBuilderService);

  mealBuilderService.createProductSection = async function canonicalCreateSection(
    args = {}
  ) {
    const section = args.section || {};
    await assertCanonicalDirectProductIds(
      section.selectedProductIds || section.productIds || []
    );
    return originalCreateProductSection(args);
  };
  mealBuilderService.addProductsToSection = async function canonicalAddProducts(
    args = {}
  ) {
    await assertCanonicalDirectProductIds(args.productIds || []);
    return originalAddProductsToSection(args);
  };
  mealBuilderService.updateProductSection = async function canonicalUpdateSection(
    args = {}
  ) {
    const patch = args.patch || {};
    if (
      Object.prototype.hasOwnProperty.call(patch, "selectedProductIds") ||
      Object.prototype.hasOwnProperty.call(patch, "productIds")
    ) {
      await assertCanonicalDirectProductIds(
        patch.selectedProductIds || patch.productIds || []
      );
    }
    return originalUpdateProductSection(args);
  };

  mealBuilderService.createProductSection.__canonicalClassification = true;
  mealBuilderService.addProductsToSection.__canonicalClassification = true;
  mealBuilderService.updateProductSection.__canonicalClassification = true;
}

async function canonicalizePickerResponse(response = {}) {
  const candidates = Array.isArray(response.candidates)
    ? response.candidates
    : [];
  const ids = candidates
    .map((candidate) => String(candidate.productId || candidate.id || ""))
    .filter(Boolean);
  if (!ids.length) return response;

  const products = await MenuProduct.find({ _id: { $in: ids } })
    .select("itemType ui.cardVariant")
    .lean();
  const productsById = new Map(
    products.map((product) => [String(product._id), product])
  );
  const canonicalCandidates = candidates.map((candidate) => {
    const id = String(candidate.productId || candidate.id || "");
    const product = productsById.get(id);
    if (!product) return candidate;
    const classification = classifyMealProduct(product);
    return {
      ...candidate,
      selectionType:
        classification.directSelectionType || candidate.selectionType || "",
      classification: {
        authority: classification.canonicalAuthority,
        kind: classification.kind,
        directCompatible: classification.directCompatible,
      },
    };
  });
  return {
    ...response,
    rules: {
      ...(response.rules || {}),
      classificationAuthority: "meal_product_classification.v1",
    },
    candidates: canonicalCandidates,
  };
}

function installCanonicalPickerOutput() {
  if (mealBuilderService.getSectionPicker.__canonicalClassification === true) {
    return;
  }
  const originalGetSectionPicker =
    mealBuilderService.getSectionPicker.bind(mealBuilderService);
  const originalGetDirectProductPicker =
    mealBuilderService.getDirectProductPicker.bind(mealBuilderService);

  mealBuilderService.getDirectProductPicker = async function canonicalDirectPicker(
    options = {}
  ) {
    return canonicalizePickerResponse(
      await originalGetDirectProductPicker(options)
    );
  };
  mealBuilderService.getSectionPicker = async function canonicalSectionPicker(
    options = {}
  ) {
    const response = await originalGetSectionPicker(options);
    return response?.candidateType === "product"
      ? canonicalizePickerResponse(response)
      : response;
  };

  mealBuilderService.getDirectProductPicker.__canonicalClassification = true;
  mealBuilderService.getSectionPicker.__canonicalClassification = true;
}

function installCompleteCatalogClassification() {
  if (completeCatalogService.getCompleteCatalog.__canonicalClassification === true) {
    return;
  }
  const originalGetCompleteCatalog =
    completeCatalogService.getCompleteCatalog.bind(completeCatalogService);

  completeCatalogService.getCompleteCatalog = async function canonicalCompleteCatalog(
    options = {}
  ) {
    const payload = await originalGetCompleteCatalog(options);
    return {
      ...payload,
      products: (payload.products || []).map((product) => ({
        ...product,
        mealPlanner: buildMealPlannerClassification({
          product,
          optionGroups: product.optionGroups || [],
          status: product.status || {},
        }),
      })),
    };
  };
  completeCatalogService.getCompleteCatalog.__canonicalClassification = true;
}

function installCompatibleDefaultDraft() {
  if (mealBuilderService.createDraft.__compatibleDefaultSeed === true) return;

  const originalCreateDraft = mealBuilderService.createDraft.bind(
    mealBuilderService
  );
  mealBuilderService.__originalCreateDraft = originalCreateDraft;

  mealBuilderService.createDraft = async function compatibleCreateDraft(
    args = {}
  ) {
    if (args.sections !== undefined && args.sections !== null) {
      return originalCreateDraft(args);
    }
    return createCompatibleDefaultDraft(args);
  };

  mealBuilderService.openWorkingDraft = async function compatibleOpenWorkingDraft(
    { actor = {} } = {}
  ) {
    const existing = await MealBuilderConfig.findOne({
      status: "draft",
      isCurrent: true,
    })
      .sort({ updatedAt: -1 })
      .lean();
    if (existing) return baseMealBuilderService.serializeConfig(existing);
    return mealBuilderService.createDraft({ actor });
  };

  mealBuilderService.createDraft.__compatibleDefaultSeed = true;
  mealBuilderService.openWorkingDraft.__compatibleDefaultSeed = true;
}

function installDashboardMealBuilderFinalization() {
  if (installed) return;
  installed = true;
  installOptionMetadataWrites();
  installCompleteCatalogClassification();
  installDirectProductActions();
  installCanonicalPickerOutput();
  installCompatibleDefaultDraft();
}

installDashboardMealBuilderFinalization();

module.exports = {
  buildCompatibleDefaultSeedSections,
  buildDirectDefaultSection,
  directSelectionType,
  installDashboardMealBuilderFinalization,
  loadReadyDirectProducts,
};
