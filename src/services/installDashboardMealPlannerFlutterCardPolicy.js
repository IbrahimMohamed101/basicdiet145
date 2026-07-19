"use strict";

const mongoose = require("mongoose");
const MealBuilderConfig = require("../models/MealBuilderConfig");
const MenuProduct = require("../models/MenuProduct");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const MenuOption = require("../models/MenuOption");
const ProductOptionGroup = require("../models/ProductOptionGroup");
const ProductGroupOption = require("../models/ProductGroupOption");
const { MEAL_SELECTION_TYPES } = require("../config/mealPlannerContract");
const {
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("./catalog/catalogAvailabilityService");
const baseService = require("./subscription/mealBuilderConfigService");
const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");
const completeCatalogService = require("./subscription/dashboardMealBuilderCatalogService");
const { pickLang } = require("../utils/i18n");

const CARD_CONTRACT_VERSION = "dashboard_meal_planner_cards.v2";
const CARD_ACTION_VERSION = "dashboard_meal_builder_card_action.v2";
const PICKER_VERSION = "dashboard_meal_builder_picker.v2";
const CARD_TYPES = Object.freeze({
  DIRECT_PRODUCT: "direct_product",
  OPTION_FAMILY: "option_family",
  SYSTEM_PREMIUM: "system_premium",
});
const OPTION_ROLES = Object.freeze({ PROTEIN: "protein", CARBS: "carbs" });
const OPTION_ROLE_VALUES = new Set(Object.values(OPTION_ROLES));
const PROTEIN_GROUP_KEYS = new Set(["protein", "proteins"]);
const CARB_GROUP_KEYS = new Set(["carb", "carbs"]);
const PREMIUM_SELECTION_TYPES = new Set([
  MEAL_SELECTION_TYPES.PREMIUM_MEAL,
  MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
  "premium",
]);
const SYSTEM_CURRENCY = "SAR";
const MAX_PICKER_LIMIT = 1000;

let installed = false;

function error(message, code, status = 400, details) {
  return new baseService.MealBuilderError(message, code, status, details);
}

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function sectionKey(section = {}) {
  return token(section.key || section.sectionKey);
}

function productIds(section = {}) {
  return [...new Set((section.selectedProductIds || section.productIds || []).map(String))];
}

function optionIds(section = {}) {
  return [...new Set((section.selectedOptionIds || section.optionIds || []).map(String))];
}

function ids(value, field) {
  if (!Array.isArray(value)) {
    throw error(`${field} must be an array`, "MEAL_BUILDER_ITEM_IDS_INVALID", 400, { field });
  }
  const values = [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  for (const itemId of values) {
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw error(`${field} contains an invalid ObjectId`, "MEAL_BUILDER_INVALID_REFERENCE", 400, { field, value: itemId });
    }
  }
  return values;
}

function id(value, field) {
  const resolved = String(value || "").trim();
  if (!mongoose.Types.ObjectId.isValid(resolved)) {
    throw error(`${field} must be a valid ObjectId`, "MEAL_BUILDER_INVALID_REFERENCE", 400, { field, value });
  }
  return resolved;
}

function key(value) {
  const resolved = token(value);
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(resolved)) {
    throw error(
      "Card key must contain 2-64 lowercase letters, numbers, underscores, or dashes",
      "MEAL_BUILDER_CARD_KEY_INVALID",
      400,
      { value }
    );
  }
  return resolved;
}

function title(value, fallback) {
  if (typeof value === "string") {
    const text = value.trim();
    return { ar: text, en: text };
  }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const ar = String(source.ar || "").trim();
  const en = String(source.en || "").trim();
  const defaultText = String(fallback || "").replace(/[_-]+/g, " ").trim();
  return { ar: ar || en || defaultText, en: en || ar || defaultText };
}

function integer(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw error("Card numeric values must be non-negative integers", "MEAL_BUILDER_CARD_NUMBER_INVALID", 400, { value });
  }
  return parsed;
}

function currentCardType(section = {}) {
  if (
    sectionKey(section) === "premium" ||
    token(section.sourceKind) === "premium_visual" ||
    section.metadata?.systemManaged === true ||
    section.metadata?.cardType === CARD_TYPES.SYSTEM_PREMIUM
  ) {
    return CARD_TYPES.SYSTEM_PREMIUM;
  }
  const explicit = token(section.cardType || section.metadata?.cardType);
  if (explicit) return explicit;
  const sectionType = token(section.sectionType || section.type);
  if (sectionType === "product_list") return CARD_TYPES.DIRECT_PRODUCT;
  if (sectionType === "option_group" || sectionType === "option_family") {
    return CARD_TYPES.OPTION_FAMILY;
  }
  if (productIds(section).length) return CARD_TYPES.DIRECT_PRODUCT;
  if (optionIds(section).length || section.productContextId || section.sourceGroupId) {
    return CARD_TYPES.OPTION_FAMILY;
  }
  return "";
}

function requestedCardType(section = {}) {
  const explicit = token(section.cardType || section.metadata?.cardType);
  if (explicit) return explicit;
  if (optionIds(section).length || section.productContextId || section.sourceGroupId || section.optionRole) {
    return CARD_TYPES.OPTION_FAMILY;
  }
  return CARD_TYPES.DIRECT_PRODUCT;
}

function optionRole(section = {}, group = null) {
  const explicit = token(section.optionRole || section.metadata?.optionRole);
  if (explicit) return explicit;
  const groupKey = token(group?.key || section.metadata?.sourceGroupKey);
  if (CARB_GROUP_KEYS.has(groupKey) || sectionKey(section) === "carbs") return OPTION_ROLES.CARBS;
  if (PROTEIN_GROUP_KEYS.has(groupKey)) return OPTION_ROLES.PROTEIN;
  return "";
}

function normalizeOptionRole(value) {
  const role = token(value);
  if (!role) {
    throw error(
      "Choose whether the option card contains protein or carbs",
      "MEAL_BUILDER_OPTION_ROLE_REQUIRED",
      422,
      { allowedOptionRoles: [...OPTION_ROLE_VALUES] }
    );
  }
  if (!OPTION_ROLE_VALUES.has(role)) {
    throw error("Option cards only support protein or carbs", "MEAL_BUILDER_OPTION_ROLE_INVALID", 422, {
      optionRole: role,
      allowedOptionRoles: [...OPTION_ROLE_VALUES],
    });
  }
  return role;
}

function relationState(relation) {
  const exists = Boolean(relation);
  const active = exists && relation.isActive !== false;
  const visible = exists && relation.isVisible !== false;
  const available = exists && relation.isAvailable !== false;
  return { exists, active, visible, available, effective: exists && active && visible && available };
}

function subscriptionEnabled(doc = {}) {
  if (doc.availableForSubscription === false) return false;
  return !Array.isArray(doc.availableFor) || doc.availableFor.length === 0 || doc.availableFor.includes("subscription");
}

function entityState(doc = {}, catalogItemsById = new Map(), prefix = "ITEM") {
  const reasonCodes = [];
  if (doc.isActive === false) reasonCodes.push(`${prefix}_INACTIVE`);
  if (doc.isVisible === false) reasonCodes.push(`${prefix}_HIDDEN`);
  if (doc.isAvailable === false) reasonCodes.push(`${prefix}_UNAVAILABLE`);
  if (!doc.publishedAt) reasonCodes.push(`${prefix}_UNPUBLISHED`);
  if (!subscriptionEnabled(doc)) reasonCodes.push(`${prefix}_NOT_SUBSCRIPTION_ENABLED`);
  if (!isLinkedDocGloballyAvailable(doc, catalogItemsById)) reasonCodes.push("CATALOG_ITEM_UNAVAILABLE");
  return {
    active: doc.isActive !== false,
    visible: doc.isVisible !== false,
    available: doc.isAvailable !== false,
    published: Boolean(doc.publishedAt),
    subscriptionEnabled: subscriptionEnabled(doc),
    catalogItemAvailable: isLinkedDocGloballyAvailable(doc, catalogItemsById),
    reasonCodes: [...new Set(reasonCodes)],
    eligible: reasonCodes.length === 0,
  };
}

function premiumOption(option = {}) {
  return (
    option.isPremium === true ||
    Boolean(String(option.premiumKey || "").trim()) ||
    PREMIUM_SELECTION_TYPES.has(String(option.selectionType || "").trim())
  );
}

function editableSection(section = {}) {
  return {
    key: sectionKey(section),
    sectionType: section.sectionType || "option_group",
    sourceKind: section.sourceKind || "",
    titleOverride: title(section.titleOverride || section.title, sectionKey(section)),
    productContextId: section.productContextId || null,
    sourceGroupId: section.sourceGroupId || null,
    sourceCategoryId: section.sourceCategoryId || null,
    selectedOptionIds: optionIds(section),
    selectedProductIds: productIds(section),
    includeMode: section.includeMode || "selected",
    selectionType: String(section.selectionType || "").trim(),
    sortOrder: Number(section.sortOrder || 0),
    required: section.required === true,
    minSelections: Number(section.minSelections || 0),
    maxSelections: section.maxSelections === null || section.maxSelections === undefined ? null : Number(section.maxSelections),
    multiSelect: section.multiSelect === true,
    visible: section.visible !== false,
    availableFor: ["subscription"],
    metadata: { ...(section.metadata || {}) },
    rules: { ...(section.rules || {}) },
  };
}

function decorateSection(section = {}) {
  const cardType = currentCardType(section);
  const role = cardType === CARD_TYPES.OPTION_FAMILY ? optionRole(section) : null;
  return {
    ...section,
    cardType,
    optionRole: role,
    systemManaged: cardType === CARD_TYPES.SYSTEM_PREMIUM,
    itemEntity:
      cardType === CARD_TYPES.DIRECT_PRODUCT
        ? "MenuProduct"
        : cardType === CARD_TYPES.OPTION_FAMILY
          ? "MenuOption"
          : "PremiumUpgradeConfig",
    completeByItself: cardType === CARD_TYPES.DIRECT_PRODUCT,
    flutterSlotContract:
      cardType === CARD_TYPES.DIRECT_PRODUCT
        ? { idField: "sandwichId", requiresCompanionCard: false }
        : cardType === CARD_TYPES.OPTION_FAMILY
          ? {
              idField: role === OPTION_ROLES.CARBS ? "carbs[].carbId" : "proteinId",
              requiresCompanionCard: true,
            }
          : null,
  };
}

function decorateConfig(config) {
  return config && typeof config === "object"
    ? { ...config, sections: (config.sections || []).map(decorateSection) }
    : config;
}

function maxSortOrder(sections) {
  return (sections || []).reduce((max, section) => Math.max(max, Number(section.sortOrder || 0)), 0);
}

function ensureUniqueKey(sections, nextKey, excluded = "") {
  const excludedKey = token(excluded);
  if ((sections || []).some((section) => sectionKey(section) === nextKey && sectionKey(section) !== excludedKey)) {
    throw error("Meal Planner card key already exists", "MEAL_BUILDER_CARD_KEY_DUPLICATE", 409, { sectionKey: nextKey });
  }
}

function groupMatchesRole(groupKey, role) {
  const resolved = token(groupKey);
  return role === OPTION_ROLES.PROTEIN ? PROTEIN_GROUP_KEYS.has(resolved) : CARB_GROUP_KEYS.has(resolved);
}

function optionAssignmentMap(sections, productId, groupId, excluded = "") {
  const result = new Map();
  for (const section of sections || []) {
    if (currentCardType(section) !== CARD_TYPES.OPTION_FAMILY || sectionKey(section) === token(excluded)) continue;
    if (String(section.productContextId || "") !== String(productId)) continue;
    if (String(section.sourceGroupId || "") !== String(groupId)) continue;
    for (const optionId of optionIds(section)) result.set(optionId, sectionKey(section));
  }
  return result;
}

async function validateOptionContext({
  productContextId,
  sourceGroupId,
  selectedOptionIds,
  requestedRole,
  familyKey,
  sections,
  excludedSectionKey = "",
}) {
  const productId = id(productContextId, "productContextId");
  const groupId = id(sourceGroupId, "sourceGroupId");
  const selectedIds = ids(selectedOptionIds, "optionIds");
  if (!selectedIds.length) {
    throw error("An option card must contain at least one option", "MEAL_BUILDER_CARD_OPTIONS_REQUIRED", 422);
  }
  const role = normalizeOptionRole(requestedRole);
  const [product, group, groupRelation, options, optionRelations] = await Promise.all([
    MenuProduct.findById(productId).lean(),
    MenuOptionGroup.findById(groupId).lean(),
    ProductOptionGroup.findOne({ productId, groupId }).lean(),
    MenuOption.find({ _id: { $in: selectedIds } }).lean(),
    ProductGroupOption.find({ productId, groupId, optionId: { $in: selectedIds } }).lean(),
  ]);
  if (!product) throw error("Base product not found", "MEAL_BUILDER_PRODUCT_NOT_FOUND", 404, { productContextId: productId });
  if (!group) throw error("Option group not found", "MEAL_BUILDER_OPTION_GROUP_NOT_FOUND", 404, { sourceGroupId: groupId });
  if (!groupMatchesRole(group.key, role)) {
    throw error(
      "The selected option group does not match the card role",
      "MEAL_BUILDER_OPTION_ROLE_GROUP_MISMATCH",
      422,
      { optionRole: role, groupId, groupKey: group.key || "" }
    );
  }
  if (!relationState(groupRelation).effective) {
    throw error(
      "The option group is not actively linked to the base product",
      "MEAL_BUILDER_PRODUCT_GROUP_RELATION_INVALID",
      422,
      { productContextId: productId, sourceGroupId: groupId, relationStatus: relationState(groupRelation) }
    );
  }
  const optionsById = new Map(options.map((option) => [String(option._id), option]));
  const missing = selectedIds.filter((optionId) => !optionsById.has(optionId));
  if (missing.length) throw error("Some options do not exist", "MEAL_BUILDER_OPTION_NOT_FOUND", 404, { optionIds: missing });
  const wrongGroup = options.filter((option) => String(option.groupId || "") !== groupId);
  if (wrongGroup.length) {
    throw error("Every option must belong to the selected group", "MEAL_BUILDER_OPTION_GROUP_MISMATCH", 422, {
      sourceGroupId: groupId,
      optionIds: wrongGroup.map((option) => String(option._id)),
    });
  }
  const premium = options.filter(premiumOption);
  if (premium.length) {
    throw error(
      "Premium options are managed by the fixed Premium card",
      "MEAL_BUILDER_PREMIUM_OPTION_SYSTEM_MANAGED",
      422,
      { optionIds: premium.map((option) => String(option._id)) }
    );
  }
  const relationByOption = new Map(optionRelations.map((relation) => [String(relation.optionId), relation]));
  const invalidRelations = selectedIds.filter((optionId) => !relationState(relationByOption.get(optionId)).effective);
  if (invalidRelations.length) {
    throw error(
      "Every option must have an active Product + Group + Option relation",
      "MEAL_BUILDER_OPTION_RELATION_INVALID",
      422,
      { productContextId: productId, sourceGroupId: groupId, optionIds: invalidRelations }
    );
  }
  const catalogItemsById = await loadCatalogItemsByIdForDocs([product], options);
  const unavailable = [
    { kind: "product", id: productId, status: entityState(product, catalogItemsById, "PRODUCT") },
    { kind: "group", id: groupId, status: entityState(group, catalogItemsById, "OPTION_GROUP") },
    ...options.map((option) => ({ kind: "option", id: String(option._id), status: entityState(option, catalogItemsById, "OPTION") })),
  ].filter((entry) => !entry.status.eligible);
  if (unavailable.length) {
    throw error(
      "The option card contains records that are not ready for subscriptions",
      "MEAL_BUILDER_OPTION_CARD_UNAVAILABLE",
      422,
      { records: unavailable }
    );
  }
  const assignments = optionAssignmentMap(sections, productId, groupId, excludedSectionKey);
  const conflicts = selectedIds.filter((optionId) => assignments.has(optionId));
  if (conflicts.length) {
    throw error(
      "An option cannot appear in two cards for the same product and group",
      "MEAL_BUILDER_OPTION_ALREADY_ASSIGNED",
      409,
      { conflicts: conflicts.map((optionId) => ({ optionId, sectionKey: assignments.get(optionId) })) }
    );
  }
  const explicitFamily = token(familyKey);
  const discoveredFamilies = [...new Set(options.map((option) => token(option.proteinFamilyKey || option.displayCategoryKey)).filter(Boolean))];
  if (role === OPTION_ROLES.PROTEIN && explicitFamily) {
    const mismatch = options.filter((option) => {
      const actual = token(option.proteinFamilyKey || option.displayCategoryKey);
      return actual && actual !== explicitFamily;
    });
    if (mismatch.length) {
      throw error(
        "Protein options must match the selected visual family",
        "MEAL_BUILDER_OPTION_FAMILY_MISMATCH",
        422,
        { familyKey: explicitFamily, optionIds: mismatch.map((option) => String(option._id)) }
      );
    }
  }
  return {
    productId,
    groupId,
    selectedIds,
    role,
    familyKey:
      role === OPTION_ROLES.CARBS
        ? "carbs"
        : explicitFamily || (discoveredFamilies.length === 1 ? discoveredFamilies[0] : ""),
    group,
    groupRelation,
  };
}

function optionMetadata(metadata, context) {
  return {
    ...(metadata || {}),
    cardType: CARD_TYPES.OPTION_FAMILY,
    dashboardManaged: true,
    optionRole: context.role,
    familyKey: context.familyKey,
    proteinFamilyKey: context.role === OPTION_ROLES.PROTEIN ? context.familyKey : undefined,
    sourceGroupKey: context.group.key || "",
    requiresBuilder: true,
    treatAsFullMeal: false,
    configuredExplicitly: true,
    configuredBy: "dashboard_user",
    flutterSlotField: context.role === OPTION_ROLES.CARBS ? "carbs[].carbId" : "proteinId",
  };
}

function findCard(sections, sectionKeyValue) {
  const cardKey = key(sectionKeyValue);
  const section = (sections || []).find((item) => sectionKey(item) === cardKey);
  if (!section) throw error("Meal Planner card not found", "MEAL_BUILDER_CARD_NOT_FOUND", 404, { sectionKey: cardKey });
  return section;
}

function assertEditable(section) {
  if (currentCardType(section) === CARD_TYPES.SYSTEM_PREMIUM) {
    throw error("The Premium card is managed by the Backend", "MEAL_BUILDER_SYSTEM_CARD_READ_ONLY", 409);
  }
}

async function ensureDraft(actor) {
  const exists = await MealBuilderConfig.exists({ status: "draft", isCurrent: true });
  if (!exists) await mealBuilderService.createDraft({ actor });
}

async function rawDraft(originalGetDashboardState, actor) {
  await ensureDraft(actor);
  const state = await originalGetDashboardState({ lang: "en" });
  if (!state?.draft) throw error("Meal Builder draft not found", "MEAL_BUILDER_DRAFT_NOT_FOUND", 404);
  return state.draft;
}

function cardResponse(validationFunction, action, draft, sectionKeyValue, itemId = null, previousSectionKey = null) {
  return validationFunction({ sections: draft.sections || [] }).then((validation) => {
    const decorated = decorateConfig(draft);
    return {
      contractVersion: CARD_ACTION_VERSION,
      action,
      sectionKey: sectionKeyValue,
      previousSectionKey,
      itemId,
      section: sectionKeyValue
        ? decorated.sections.find((section) => sectionKey(section) === token(sectionKeyValue)) || null
        : null,
      draft: decorated,
      validation,
      summary: {
        sectionCount: decorated.sections.length,
        selectedProductCount: decorated.sections.reduce((sum, section) => sum + productIds(section).length, 0),
        selectedOptionCount: decorated.sections.reduce((sum, section) => sum + optionIds(section).length, 0),
        ready: validation.ready === true,
        errorCount: (validation.errors || []).length,
        warningCount: (validation.warnings || []).length,
      },
    };
  });
}

function issue(code, message, details = {}) {
  return { level: "error", code, message, ...details };
}

function topologyValidation(sections = []) {
  const errors = [];
  const directAssignments = new Map();
  const optionAssignments = new Map();
  const proteinProducts = new Set();
  const carbProducts = new Set();
  for (const section of sections || []) {
    if (section.visible === false || currentCardType(section) === CARD_TYPES.SYSTEM_PREMIUM) continue;
    const cardType = currentCardType(section);
    const cardKey = sectionKey(section);
    if (cardType === CARD_TYPES.DIRECT_PRODUCT) {
      if (![MEAL_SELECTION_TYPES.SANDWICH, MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT].includes(section.selectionType)) {
        errors.push(issue("MEAL_BUILDER_CARD_SELECTION_TYPE_INVALID", "Direct product cards require sandwich or full_meal_product", { sectionKey: cardKey }));
      }
      if (!productIds(section).length) errors.push(issue("MEAL_BUILDER_CARD_PRODUCTS_REQUIRED", "Direct product card cannot be empty", { sectionKey: cardKey }));
      for (const productId of productIds(section)) {
        if (directAssignments.has(productId)) {
          errors.push(issue("MEAL_BUILDER_PRODUCT_ALREADY_ASSIGNED", "Product is assigned to more than one direct card", {
            productId,
            sectionKey: cardKey,
            otherSectionKey: directAssignments.get(productId),
          }));
        } else directAssignments.set(productId, cardKey);
      }
      continue;
    }
    if (cardType === CARD_TYPES.OPTION_FAMILY) {
      // Existing visual sections remain under the legacy validator during the dashboard migration.
      // The strict Flutter topology is authoritative for cards written through the v2 card contract.
      if (section.metadata?.cardType !== CARD_TYPES.OPTION_FAMILY) continue;
      const role = optionRole(section);
      const productId = String(section.productContextId || "");
      const groupId = String(section.sourceGroupId || "");
      if (!productId || !groupId || !optionIds(section).length) {
        errors.push(issue("MEAL_BUILDER_INVALID_SECTION_REFERENCE", "Option card requires base product, group, and options", { sectionKey: cardKey }));
      }
      if (!OPTION_ROLE_VALUES.has(role)) errors.push(issue("MEAL_BUILDER_OPTION_ROLE_REQUIRED", "Option card must declare protein or carbs", { sectionKey: cardKey }));
      if (section.selectionType !== MEAL_SELECTION_TYPES.STANDARD_MEAL) {
        errors.push(issue("MEAL_BUILDER_OPTION_SELECTION_TYPE_INVALID", "Option cards must use standard_meal", { sectionKey: cardKey }));
      }
      if (role === OPTION_ROLES.PROTEIN && productId) proteinProducts.add(productId);
      if (role === OPTION_ROLES.CARBS && productId) carbProducts.add(productId);
      for (const optionId of optionIds(section)) {
        const assignmentKey = `${productId}:${groupId}:${optionId}`;
        if (optionAssignments.has(assignmentKey)) {
          errors.push(issue("MEAL_BUILDER_OPTION_ALREADY_ASSIGNED", "Option is assigned to more than one card for the same product and group", {
            optionId,
            sectionKey: cardKey,
            otherSectionKey: optionAssignments.get(assignmentKey),
          }));
        } else optionAssignments.set(assignmentKey, cardKey);
      }
      continue;
    }
    errors.push(issue("MEAL_BUILDER_CARD_TYPE_INVALID", "Unsupported Meal Planner card type", { sectionKey: cardKey, cardType }));
  }
  for (const productId of proteinProducts) {
    if (!carbProducts.has(productId)) {
      errors.push(issue("MEAL_BUILDER_CARBS_CARD_REQUIRED", "Protein options need a carbs card for the same base product", { productContextId: productId }));
    }
  }
  return {
    status: errors.length ? "error" : "ok",
    ready: errors.length === 0,
    errors,
    warnings: [],
    checks: [{
      key: "flutter_card_topology",
      status: errors.length ? "error" : "ok",
      directCardCount: directAssignments.size,
      proteinProductCount: proteinProducts.size,
      carbsProductCount: carbProducts.size,
    }],
    summary: { sections: (sections || []).length, errors: errors.length, warnings: 0, publishable: errors.length === 0 },
  };
}

function mergeValidation(base = {}, custom = {}) {
  const errors = [...(base.errors || []), ...(custom.errors || [])];
  const warnings = [...(base.warnings || []), ...(custom.warnings || [])];
  return {
    ...base,
    status: errors.length ? "error" : warnings.length ? "warning" : "ok",
    ready: base.ready !== false && errors.length === 0,
    errors,
    warnings,
    checks: [...(base.checks || []), ...(custom.checks || [])],
    summary: {
      ...(base.summary || {}),
      errors: errors.length,
      warnings: warnings.length,
      publishable: base.ready !== false && errors.length === 0,
    },
  };
}

function getCardContract() {
  return {
    contractVersion: CARD_CONTRACT_VERSION,
    premiumCard: { cardType: CARD_TYPES.SYSTEM_PREMIUM, fixed: true, managedBy: "backend", editable: false },
    dynamicCardTypes: [
      {
        cardType: CARD_TYPES.DIRECT_PRODUCT,
        entity: "MenuProduct",
        completeByItself: true,
        allowedSelectionTypes: [MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT, MEAL_SELECTION_TYPES.SANDWICH],
        flutterSlotField: "sandwichId",
        requiresBuilder: false,
        treatAsFullMeal: true,
      },
      {
        cardType: CARD_TYPES.OPTION_FAMILY,
        entity: "MenuOption",
        completeByItself: false,
        allowedOptionRoles: [...OPTION_ROLE_VALUES],
        selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
        requiresBaseProduct: true,
        requiresSourceGroup: true,
        premiumManagedSeparately: true,
        flutterSlotFields: { protein: "proteinId", carbs: "carbs[].carbId" },
      },
    ],
    unsupported: ["independent_option", "generic_composed_product", "mixed_product_and_option_card"],
  };
}

function facets(catalog = {}) {
  const unique = (values) => [...new Set(values.map(token).filter(Boolean))].sort();
  return {
    productCategories: (catalog.categories || []).map((category) => ({
      id: String(category.id || category._id || ""),
      key: category.key || "",
      name: category.name || {},
    })),
    productItemTypes: unique((catalog.products || []).map((product) => product.itemType)),
    productCardVariants: unique((catalog.products || []).map((product) => product.ui?.cardVariant)),
    optionGroups: (catalog.optionGroups || []).map((group) => ({
      id: String(group.id || group._id || ""),
      key: group.key || "",
      name: group.name || {},
    })),
    proteinFamilies: unique((catalog.options || []).map((option) => option.proteinFamilyKey)),
    displayCategories: unique((catalog.options || []).map((option) => option.displayCategoryKey)),
    optionSelectionTypes: unique((catalog.options || []).map((option) => option.selectionType)),
    optionRoles: [...OPTION_ROLE_VALUES],
    cardTypes: [CARD_TYPES.DIRECT_PRODUCT, CARD_TYPES.OPTION_FAMILY],
  };
}

function installDashboardMealPlannerFlutterCardPolicy() {
  if (installed) return;
  installed = true;

  const originalCreate = mealBuilderService.createProductSection.bind(mealBuilderService);
  const originalUpdate = mealBuilderService.updateProductSection.bind(mealBuilderService);
  const originalDelete = mealBuilderService.deleteProductSection.bind(mealBuilderService);
  const originalGetPicker = mealBuilderService.getSectionPicker.bind(mealBuilderService);
  const originalValidate = mealBuilderService.validatePayload.bind(mealBuilderService);
  const originalPublish = mealBuilderService.publishDraft.bind(mealBuilderService);
  const originalGetState = mealBuilderService.getDashboardState.bind(mealBuilderService);
  const originalSerialize = mealBuilderService.serializeConfig.bind(mealBuilderService);
  const originalCatalog = completeCatalogService.getCompleteCatalog.bind(completeCatalogService);

  const validate = async (payload = {}) =>
    mergeValidation(await originalValidate(payload), topologyValidation(payload.sections || []));

  async function createOptionCard(section, actor) {
    const draft = await rawDraft(originalGetState, actor);
    const sections = (draft.sections || []).map(editableSection);
    const nextKey = key(section.key || section.sectionKey);
    ensureUniqueKey(sections, nextKey);
    const context = await validateOptionContext({
      productContextId: section.productContextId,
      sourceGroupId: section.sourceGroupId,
      selectedOptionIds: section.selectedOptionIds || section.optionIds || [],
      requestedRole: section.optionRole || section.metadata?.optionRole,
      familyKey: section.familyKey || section.metadata?.familyKey || section.metadata?.proteinFamilyKey,
      sections,
    });
    const relation = context.groupRelation || {};
    const defaultMax = context.role === OPTION_ROLES.CARBS ? Number(relation.maxSelections || 2) : 1;
    const next = {
      key: nextKey,
      sectionType: "option_group",
      sourceKind: context.role === OPTION_ROLES.PROTEIN ? "visual_family" : "configurable_product",
      titleOverride: title(section.titleOverride || section.title, nextKey),
      productContextId: context.productId,
      sourceGroupId: context.groupId,
      sourceCategoryId: null,
      selectedOptionIds: context.selectedIds,
      selectedProductIds: [],
      includeMode: "selected",
      selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
      sortOrder: integer(section.sortOrder, maxSortOrder(sections) + 10),
      required: Object.prototype.hasOwnProperty.call(section, "required") ? section.required === true : relation.isRequired === true,
      minSelections: integer(section.minSelections, Number(relation.minSelections || 0)),
      maxSelections: section.maxSelections === null ? null : integer(section.maxSelections, defaultMax),
      multiSelect: Object.prototype.hasOwnProperty.call(section, "multiSelect")
        ? section.multiSelect === true
        : context.role === OPTION_ROLES.CARBS && defaultMax > 1,
      visible: section.visible !== false,
      availableFor: ["subscription"],
      metadata: optionMetadata(section.metadata, context),
      rules: { ...(section.rules || {}), carbsRequired: context.role === OPTION_ROLES.PROTEIN },
    };
    const updated = await baseService.updateDraft({ sections: [...sections, next], actor, notes: draft.notes });
    return cardResponse(validate, "created", updated, nextKey);
  }

  async function updateOptionCard(sectionKeyValue, patch, actor) {
    const draft = await rawDraft(originalGetState, actor);
    const sections = (draft.sections || []).map(editableSection);
    const current = findCard(sections, sectionKeyValue);
    assertEditable(current);
    if (currentCardType(current) !== CARD_TYPES.OPTION_FAMILY) return originalUpdate({ sectionKey: sectionKeyValue, patch, actor });
    if (patch.cardType && token(patch.cardType) !== CARD_TYPES.OPTION_FAMILY) {
      throw error("Changing an existing card entity type is not supported", "MEAL_BUILDER_CARD_TYPE_CHANGE_UNSUPPORTED", 409);
    }
    const currentKey = sectionKey(current);
    const nextKey = patch.key ? key(patch.key) : currentKey;
    ensureUniqueKey(sections, nextKey, currentKey);
    const context = await validateOptionContext({
      productContextId: patch.productContextId || current.productContextId,
      sourceGroupId: patch.sourceGroupId || current.sourceGroupId,
      selectedOptionIds: Object.prototype.hasOwnProperty.call(patch, "selectedOptionIds")
        ? patch.selectedOptionIds
        : Object.prototype.hasOwnProperty.call(patch, "optionIds")
          ? patch.optionIds
          : optionIds(current),
      requestedRole: patch.optionRole || patch.metadata?.optionRole || optionRole(current),
      familyKey:
        patch.familyKey ||
        patch.metadata?.familyKey ||
        patch.metadata?.proteinFamilyKey ||
        current.metadata?.familyKey ||
        current.metadata?.proteinFamilyKey,
      sections,
      excludedSectionKey: currentKey,
    });
    const relation = context.groupRelation || {};
    const defaultMax = context.role === OPTION_ROLES.CARBS ? Number(relation.maxSelections || 2) : 1;
    const next = {
      ...current,
      key: nextKey,
      sectionType: "option_group",
      sourceKind: context.role === OPTION_ROLES.PROTEIN ? "visual_family" : "configurable_product",
      titleOverride:
        Object.prototype.hasOwnProperty.call(patch, "titleOverride") || Object.prototype.hasOwnProperty.call(patch, "title")
          ? title(patch.titleOverride || patch.title, nextKey)
          : current.titleOverride,
      productContextId: context.productId,
      sourceGroupId: context.groupId,
      selectedOptionIds: context.selectedIds,
      selectedProductIds: [],
      selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
      sortOrder: integer(patch.sortOrder, current.sortOrder),
      required: Object.prototype.hasOwnProperty.call(patch, "required") ? patch.required === true : current.required,
      minSelections: integer(patch.minSelections, current.minSelections ?? Number(relation.minSelections || 0)),
      maxSelections: Object.prototype.hasOwnProperty.call(patch, "maxSelections")
        ? patch.maxSelections === null
          ? null
          : integer(patch.maxSelections, defaultMax)
        : current.maxSelections,
      multiSelect: Object.prototype.hasOwnProperty.call(patch, "multiSelect") ? patch.multiSelect === true : current.multiSelect,
      visible: Object.prototype.hasOwnProperty.call(patch, "visible") ? patch.visible !== false : current.visible,
      metadata: optionMetadata({ ...(current.metadata || {}), ...(patch.metadata || {}) }, context),
      rules: { ...(current.rules || {}), ...(patch.rules || {}), carbsRequired: context.role === OPTION_ROLES.PROTEIN },
    };
    const updated = await baseService.updateDraft({
      sections: sections.map((section) => (sectionKey(section) === currentKey ? next : section)),
      actor,
      notes: draft.notes,
    });
    return cardResponse(validate, "updated", updated, nextKey, null, nextKey === currentKey ? null : currentKey);
  }

  async function deleteCard(sectionKeyValue, actor) {
    const draft = await rawDraft(originalGetState, actor);
    const sections = (draft.sections || []).map(editableSection);
    const current = findCard(sections, sectionKeyValue);
    assertEditable(current);
    if (currentCardType(current) !== CARD_TYPES.OPTION_FAMILY) return originalDelete({ sectionKey: sectionKeyValue, actor });
    const currentKey = sectionKey(current);
    const updated = await baseService.updateDraft({
      sections: sections.filter((section) => sectionKey(section) !== currentKey),
      actor,
      notes: draft.notes,
    });
    return cardResponse(validate, "deleted", updated, null, null, currentKey);
  }

  async function updateOptions({ sectionKey: sectionKeyValue, nextOptionIds, actor, action, itemId }) {
    const draft = await rawDraft(originalGetState, actor);
    const sections = (draft.sections || []).map(editableSection);
    const current = findCard(sections, sectionKeyValue);
    assertEditable(current);
    if (currentCardType(current) !== CARD_TYPES.OPTION_FAMILY) {
      throw error("This action is only supported for option cards", "MEAL_BUILDER_CARD_TYPE_UNSUPPORTED", 409);
    }
    if (!nextOptionIds.length) {
      throw error("An option card cannot be empty; delete the card instead", "MEAL_BUILDER_CARD_WOULD_BE_EMPTY", 422);
    }
    const context = await validateOptionContext({
      productContextId: current.productContextId,
      sourceGroupId: current.sourceGroupId,
      selectedOptionIds: nextOptionIds,
      requestedRole: optionRole(current),
      familyKey: current.metadata?.familyKey || current.metadata?.proteinFamilyKey,
      sections,
      excludedSectionKey: sectionKey(current),
    });
    const next = {
      ...current,
      selectedOptionIds: context.selectedIds,
      metadata: optionMetadata(current.metadata, context),
      rules: { ...(current.rules || {}), carbsRequired: context.role === OPTION_ROLES.PROTEIN },
    };
    const updated = await baseService.updateDraft({
      sections: sections.map((section) => (sectionKey(section) === sectionKey(current) ? next : section)),
      actor,
      notes: draft.notes,
    });
    return cardResponse(validate, action, updated, sectionKey(current), itemId);
  }

  async function optionPicker(options = {}) {
    const requestedKey = token(options.sectionKey || "options");
    const targetKey = token(options.targetSectionKey || (requestedKey === "options" ? "" : requestedKey));
    const state = await originalGetState({ lang: options.lang || "en" });
    const config = state?.draft || state?.published || null;
    const sections = config?.sections || [];
    const current = targetKey ? sections.find((section) => sectionKey(section) === targetKey) : null;
    const productId = id(options.productContextId || current?.productContextId, "productContextId");
    const groupId = id(options.sourceGroupId || current?.sourceGroupId, "sourceGroupId");
    const [product, group, groupRelation, relations] = await Promise.all([
      MenuProduct.findById(productId).lean(),
      MenuOptionGroup.findById(groupId).lean(),
      ProductOptionGroup.findOne({ productId, groupId }).lean(),
      ProductGroupOption.find({ productId, groupId }).sort({ sortOrder: 1, createdAt: 1 }).lean(),
    ]);
    if (!product || !group) throw error("Option picker context is missing", "MEAL_BUILDER_INVALID_SECTION_REFERENCE", 404);
    const role = normalizeOptionRole(options.optionRole || current?.metadata?.optionRole || optionRole(current || {}, group));
    if (!groupMatchesRole(group.key, role)) {
      throw error("Option group does not match requested role", "MEAL_BUILDER_OPTION_ROLE_GROUP_MISMATCH", 422, { optionRole: role, groupKey: group.key });
    }
    const relationIds = relations.map((relation) => String(relation.optionId));
    const optionDocs = relationIds.length ? await MenuOption.find({ _id: { $in: relationIds } }).lean() : [];
    const optionById = new Map(optionDocs.map((option) => [String(option._id), option]));
    const relationById = new Map(relations.map((relation) => [String(relation.optionId), relation]));
    const catalogItemsById = await loadCatalogItemsByIdForDocs([product], optionDocs);
    const selected = new Set(optionIds(current || {}));
    const assigned = optionAssignmentMap(sections, productId, groupId, current ? sectionKey(current) : targetKey);
    const search = token(options.q || options.search);
    const includeUnavailable = [true, "true", "1"].includes(options.includeUnavailable);
    const onlyUnassigned = ![false, "false", "0"].includes(options.unassignedOnly);
    const page = Math.max(1, Number.parseInt(options.page || "1", 10) || 1);
    const limit = Math.min(MAX_PICKER_LIMIT, Math.max(1, Number.parseInt(options.limit || "100", 10) || 100));
    let candidates = relationIds
      .map((optionId) => {
        const option = optionById.get(optionId);
        if (!option) return null;
        if (search && ![option.key, option.name?.ar, option.name?.en].some((value) => token(value).includes(search))) return null;
        const status = entityState(option, catalogItemsById, "OPTION");
        const relation = relationState(relationById.get(optionId));
        const isSelected = selected.has(optionId);
        const assignedSectionKey = assigned.get(optionId) || null;
        const isPremium = premiumOption(option);
        const assignable = status.eligible && relation.effective && !assignedSectionKey && !isPremium;
        return {
          id: optionId,
          optionId,
          type: "option",
          key: option.key || "",
          name: option.name || {},
          label: pickLang(option.name || {}, options.lang || "en"),
          imageUrl: option.imageUrl || "",
          productContextId: productId,
          groupId,
          optionRole: role,
          selectionType: option.selectionType || MEAL_SELECTION_TYPES.STANDARD_MEAL,
          proteinFamilyKey: option.proteinFamilyKey || "",
          displayCategoryKey: option.displayCategoryKey || "",
          isPremium,
          extraPriceHalala:
            relationById.get(optionId)?.extraPriceHalala ?? option.extraPriceHalala ?? 0,
          currency: option.currency || SYSTEM_CURRENCY,
          selected: isSelected,
          assigned: isSelected || Boolean(assignedSectionKey),
          assignedSectionKey: isSelected ? null : assignedSectionKey,
          assignable,
          eligible: isSelected || assignable,
          relationStatus: relation,
          ...status,
          reasonCodes: isSelected
            ? ["SELECTED", ...status.reasonCodes]
            : isPremium
              ? ["PREMIUM_SYSTEM_MANAGED", ...status.reasonCodes]
              : assignedSectionKey
                ? ["ASSIGNED_TO_OTHER_CARD", ...status.reasonCodes]
                : !relation.effective
                  ? ["RELATION_UNAVAILABLE", ...status.reasonCodes]
                  : status.eligible
                    ? ["ELIGIBLE"]
                    : status.reasonCodes,
          state: isSelected ? "selected" : assignable ? "eligible" : assignedSectionKey ? "assigned_elsewhere" : "unavailable",
          sortOrder: Number(relationById.get(optionId)?.sortOrder ?? option.sortOrder ?? 0),
        };
      })
      .filter(Boolean)
      .filter((candidate) => candidate.selected || includeUnavailable || candidate.available);
    if (onlyUnassigned) candidates = candidates.filter((candidate) => candidate.selected || candidate.assignable);
    candidates.sort((left, right) => Number(right.selected) - Number(left.selected) || Number(right.assignable) - Number(left.assignable) || left.sortOrder - right.sortOrder);
    const total = candidates.length;
    return {
      contractVersion: PICKER_VERSION,
      sectionKey: requestedKey,
      targetSectionKey: current ? sectionKey(current) : targetKey || null,
      cardType: CARD_TYPES.OPTION_FAMILY,
      candidateType: "option",
      context: {
        product: { id: productId, key: product.key || "", name: product.name || {} },
        group: { id: groupId, key: group.key || "", name: group.name || {} },
        relationStatus: relationState(groupRelation),
      },
      rules: {
        optionRole: role,
        allowedOptionRoles: [...OPTION_ROLE_VALUES],
        selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
        source: "product_group_options",
        completeByItself: false,
        requiresCompanionCard: true,
        flutterSlotField: role === OPTION_ROLES.CARBS ? "carbs[].carbId" : "proteinId",
        premiumManagedSeparately: true,
        uniquenessScope: "product_context_and_group",
      },
      candidates: candidates.slice((page - 1) * limit, page * limit),
      meta: { page, limit, total, pages: total ? Math.ceil(total / limit) : 0 },
    };
  }

  mealBuilderService.createProductSection = async function createCard(args = {}) {
    const section = args.section || {};
    if (requestedCardType(section) === CARD_TYPES.OPTION_FAMILY) {
      return createOptionCard(section, args.actor || {});
    }
    if (section.cardType && token(section.cardType) !== CARD_TYPES.DIRECT_PRODUCT) {
      throw error("Choose direct_product or option_family", "MEAL_BUILDER_CARD_TYPE_INVALID", 422);
    }
    return originalCreate(args);
  };

  mealBuilderService.updateProductSection = async function updateCard(args = {}) {
    const state = await originalGetState({ lang: "en" });
    const section = findCard(state?.draft?.sections || state?.published?.sections || [], args.sectionKey);
    if (currentCardType(section) === CARD_TYPES.OPTION_FAMILY) {
      return updateOptionCard(args.sectionKey, args.patch || {}, args.actor || {});
    }
    return originalUpdate(args);
  };

  mealBuilderService.deleteProductSection = async function deleteAnyCard(args = {}) {
    return deleteCard(args.sectionKey, args.actor || {});
  };

  mealBuilderService.addOptionsToSection = async function addOptions(args = {}) {
    const state = await originalGetState({ lang: "en" });
    const section = findCard(state?.draft?.sections || state?.published?.sections || [], args.sectionKey);
    const additions = ids(args.optionIds || [], "optionIds");
    if (!additions.length) throw error("At least one optionId is required", "MEAL_BUILDER_OPTION_IDS_REQUIRED", 400);
    return updateOptions({
      sectionKey: args.sectionKey,
      nextOptionIds: [...optionIds(section), ...additions],
      actor: args.actor || {},
      action: "options_added",
    });
  };

  mealBuilderService.removeOptionFromSection = async function removeOption(args = {}) {
    const state = await originalGetState({ lang: "en" });
    const section = findCard(state?.draft?.sections || state?.published?.sections || [], args.sectionKey);
    const targetId = id(args.optionId, "optionId");
    if (!optionIds(section).includes(targetId)) {
      throw error("Option is not assigned to this card", "MEAL_BUILDER_OPTION_NOT_IN_CARD", 404);
    }
    return updateOptions({
      sectionKey: args.sectionKey,
      nextOptionIds: optionIds(section).filter((optionId) => optionId !== targetId),
      actor: args.actor || {},
      action: "option_removed",
      itemId: targetId,
    });
  };

  mealBuilderService.replaceSectionItems = async function replaceItems(args = {}) {
    const state = await originalGetState({ lang: "en" });
    const section = findCard(state?.draft?.sections || state?.published?.sections || [], args.sectionKey);
    if (currentCardType(section) === CARD_TYPES.OPTION_FAMILY) {
      return updateOptionCard(args.sectionKey, { selectedOptionIds: args.optionIds || [] }, args.actor || {});
    }
    return originalUpdate({ sectionKey: args.sectionKey, patch: { selectedProductIds: args.productIds || [] }, actor: args.actor || {} });
  };

  mealBuilderService.getOptionFamilyPicker = optionPicker;
  mealBuilderService.getSectionPicker = async function getPicker(options = {}) {
    const pickerKey = token(options.sectionKey);
    const state = await originalGetState({ lang: options.lang || "en" });
    const section = (state?.draft?.sections || state?.published?.sections || []).find((item) => sectionKey(item) === pickerKey);
    if (pickerKey === "options" || currentCardType(section || {}) === CARD_TYPES.OPTION_FAMILY) {
      return optionPicker(options);
    }
    return originalGetPicker(options);
  };

  mealBuilderService.validatePayload = validate;
  mealBuilderService.publishDraft = async function publishFlutterCompatible(args = {}) {
    const state = await originalGetState({ lang: "en" });
    if (!state?.draft) throw error("Meal Builder draft not found", "MEAL_BUILDER_DRAFT_NOT_FOUND", 404);
    const validation = await validate({ sections: state.draft.sections || [] });
    if (!validation.ready) {
      throw error(
        "Meal Builder draft is not compatible with the current Flutter Meal Planner",
        "MEAL_BUILDER_VALIDATION_FAILED",
        422,
        validation
      );
    }
    return originalPublish(args);
  };

  mealBuilderService.getCardContract = getCardContract;
  mealBuilderService.getDashboardState = async function getFlutterCardState(options = {}) {
    const state = await originalGetState(options);
    const draft = decorateConfig(state.draft);
    const published = decorateConfig(state.published);
    return {
      ...state,
      draft,
      published,
      cardContract: getCardContract(),
      validation: {
        ...(state.validation || {}),
        draft: draft ? await validate({ sections: draft.sections || [] }) : state.validation?.draft || null,
        published: published ? await validate({ sections: published.sections || [] }) : state.validation?.published || null,
      },
    };
  };

  mealBuilderService.serializeConfig = function serializeFlutterCards(config) {
    return decorateConfig(originalSerialize(config));
  };

  completeCatalogService.getCompleteCatalog = async function getFlutterCardCatalog(options = {}) {
    const catalog = await originalCatalog(options);
    return { ...catalog, cardContract: getCardContract(), searchFacets: facets(catalog) };
  };
}

installDashboardMealPlannerFlutterCardPolicy();

module.exports = {
  CARD_TYPES,
  OPTION_ROLES,
  getCardContract,
  installDashboardMealPlannerFlutterCardPolicy,
  topologyValidation,
};
