"use strict";

const mongoose = require("mongoose");

const MenuProduct = require("../../models/MenuProduct");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuOption = require("../../models/MenuOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const ProductGroupOption = require("../../models/ProductGroupOption");
const { pickLang } = require("../../utils/i18n");
const {
  STANDARD_CARB_RULES,
  resolveProteinVisualFamilyKey,
} = require("../../config/mealPlannerContract");
const {
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");
const compatibilityService = require("./dashboardMealPlannerCompatibilityService");

const PICKER_VERSION = "dashboard_meal_builder_picker.v2";
const CARD_ACTION_VERSION = "dashboard_meal_builder_card_action.v2";
const STANDARD_SELECTION_TYPE = "standard_meal";
const SYSTEM_CURRENCY = "SAR";
const MAX_PICKER_LIMIT = 1000;

function mealBuilderError(message, code, status = 400, details) {
  return new compatibilityService.MealBuilderError(message, code, status, details);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizePagination({ page, limit } = {}) {
  const normalizedPage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const normalizedLimit = Math.min(
    MAX_PICKER_LIMIT,
    Math.max(1, Number.parseInt(limit || "100", 10) || 100)
  );
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
}

function normalizeSectionKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(key)) {
    throw mealBuilderError(
      "Card key must contain 2-64 lowercase letters, numbers, underscores, or dashes",
      "MEAL_BUILDER_CARD_KEY_INVALID",
      400,
      { value }
    );
  }
  return key;
}

function normalizeLocalizedTitle(value, fallbackKey = "") {
  if (typeof value === "string") {
    const title = value.trim();
    return { ar: title, en: title };
  }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const ar = String(source.ar || "").trim();
  const en = String(source.en || "").trim();
  if (!ar && !en) {
    const fallback = String(fallbackKey || "").replace(/[_-]+/g, " ").trim();
    return { ar: fallback, en: fallback };
  }
  return { ar: ar || en, en: en || ar };
}

function normalizeOptionalInteger(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw mealBuilderError(
      "Card numeric fields must be integers greater than or equal to zero",
      "MEAL_BUILDER_CARD_NUMBER_INVALID",
      400,
      { value }
    );
  }
  return parsed;
}

function normalizeIds(value, fieldName = "ids", required = false) {
  const source = value === undefined || value === null ? [] : value;
  if (!Array.isArray(source)) {
    throw mealBuilderError(
      `${fieldName} must be an array`,
      fieldName === "optionIds"
        ? "MEAL_BUILDER_OPTION_IDS_INVALID"
        : "MEAL_BUILDER_INVALID_REFERENCE",
      400
    );
  }
  const ids = [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
  const invalid = ids.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalid.length) {
    throw mealBuilderError(
      `${fieldName} contains invalid ids`,
      "MEAL_BUILDER_INVALID_REFERENCE",
      400,
      { [fieldName]: invalid }
    );
  }
  if (required && !ids.length) {
    throw mealBuilderError(
      "An option card must contain at least one option",
      "MEAL_BUILDER_CARD_OPTIONS_REQUIRED",
      422
    );
  }
  return ids;
}

function normalizeObjectId(value, fieldName) {
  const id = String(value || "").trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw mealBuilderError(
      `${fieldName} is required and must be a valid ObjectId`,
      "MEAL_BUILDER_INVALID_REFERENCE",
      400,
      { field: fieldName, value }
    );
  }
  return id;
}

function sectionKeyOf(section = {}) {
  return String(section.key || section.sectionKey || "").trim().toLowerCase();
}

function isOptionCard(section = {}) {
  const cardType = String(section.cardType || section.metadata?.cardType || "").trim();
  return (
    String(section.sectionType || section.type || "") === "option_group" ||
    cardType === "option_family"
  );
}

function isSystemManagedCard(section = {}) {
  const selectionType = String(section.selectionType || "").trim();
  return (
    section.systemManaged === true ||
    sectionKeyOf(section) === "premium" ||
    section.sourceKind === "premium_visual" ||
    section.metadata?.visualRole === "premium" ||
    selectionType === "premium_meal" ||
    selectionType === "premium_large_salad"
  );
}

function isOptionFamilyPayload(section = {}) {
  const cardType = String(section.cardType || section.metadata?.cardType || "").trim();
  return (
    cardType === "option_family" ||
    String(section.sectionType || section.type || "") === "option_group" ||
    Array.isArray(section.selectedOptionIds) ||
    Array.isArray(section.optionIds)
  );
}

function writableSection(section = {}) {
  return {
    key: sectionKeyOf(section),
    sectionType: section.sectionType || "product_list",
    sourceKind: section.sourceKind || "",
    titleOverride: normalizeLocalizedTitle(
      section.titleOverride || section.title,
      sectionKeyOf(section)
    ),
    productContextId: section.productContextId || null,
    sourceGroupId: section.sourceGroupId || null,
    sourceCategoryId: section.sourceCategoryId || null,
    selectedOptionIds: Array.isArray(section.selectedOptionIds)
      ? section.selectedOptionIds.map(String)
      : [],
    selectedProductIds: Array.isArray(section.selectedProductIds)
      ? section.selectedProductIds.map(String)
      : [],
    includeMode: section.includeMode || "selected",
    selectionType: section.selectionType || "",
    sortOrder: Number(section.sortOrder || 0),
    required: section.required === true,
    minSelections: Number(section.minSelections || 0),
    maxSelections:
      section.maxSelections === null || section.maxSelections === undefined
        ? null
        : Number(section.maxSelections),
    multiSelect: section.multiSelect === true,
    visible: section.visible !== false,
    availableFor: Array.isArray(section.availableFor)
      ? section.availableFor
      : ["subscription"],
    metadata:
      section.metadata && typeof section.metadata === "object"
        ? { ...section.metadata }
        : {},
    rules:
      section.rules && typeof section.rules === "object"
        ? { ...section.rules }
        : {},
  };
}

function maxSortOrder(sections = []) {
  return sections.reduce(
    (max, section) => Math.max(max, Number(section.sortOrder || 0)),
    0
  );
}

function findSection(sections = [], sectionKey) {
  const key = normalizeSectionKey(sectionKey);
  const section = sections.find((item) => sectionKeyOf(item) === key) || null;
  if (!section) {
    throw mealBuilderError(
      "Meal Builder card not found",
      "MEAL_BUILDER_CARD_NOT_FOUND",
      404,
      { sectionKey: key }
    );
  }
  return section;
}

function assertWritableCard(section) {
  if (isSystemManagedCard(section)) {
    throw mealBuilderError(
      "System-managed Meal Builder cards are read-only",
      "MEAL_BUILDER_SYSTEM_CARD_READ_ONLY",
      409,
      { sectionKey: sectionKeyOf(section) }
    );
  }
}

function relationStatus(relation = null) {
  const exists = Boolean(relation);
  const active = exists && relation.isActive !== false;
  const visible = exists && relation.isVisible !== false;
  const available = exists && relation.isAvailable !== false;
  return {
    exists,
    active,
    visible,
    available,
    effective: exists && active && visible && available,
  };
}

function subscriptionEnabled(doc = {}) {
  if (doc.availableForSubscription === false) return false;
  if (!Array.isArray(doc.availableFor) || doc.availableFor.length === 0) return true;
  return doc.availableFor.includes("subscription");
}

function entityStatus(doc = null, catalogItemsById = new Map(), prefix = "ITEM") {
  const reasonCodes = [];
  const active = Boolean(doc) && doc.isActive !== false;
  const visible = Boolean(doc) && doc.isVisible !== false;
  const available = Boolean(doc) && doc.isAvailable !== false;
  const published = Boolean(doc?.publishedAt);
  const subscription = Boolean(doc) && subscriptionEnabled(doc);
  const catalogItemAvailable = Boolean(doc) && isLinkedDocGloballyAvailable(doc, catalogItemsById);

  if (!doc) reasonCodes.push(`${prefix}_NOT_FOUND`);
  if (doc && !active) reasonCodes.push(`${prefix}_INACTIVE`);
  if (doc && !visible) reasonCodes.push(`${prefix}_HIDDEN`);
  if (doc && !available) reasonCodes.push(`${prefix}_UNAVAILABLE`);
  if (doc && !published) reasonCodes.push(`${prefix}_UNPUBLISHED`);
  if (doc && !subscription) reasonCodes.push(`${prefix}_NOT_SUBSCRIPTION_ENABLED`);
  if (doc && !catalogItemAvailable) reasonCodes.push("CATALOG_ITEM_UNAVAILABLE");

  return {
    active,
    visible,
    available,
    published,
    subscriptionEnabled: subscription,
    catalogItemAvailable,
    customerReady: reasonCodes.length === 0,
    reasonCodes,
  };
}

function groupStatus(group = null) {
  const reasonCodes = [];
  const active = Boolean(group) && group.isActive !== false;
  const visible = Boolean(group) && group.isVisible !== false;
  const available = Boolean(group) && group.isAvailable !== false;
  const published = Boolean(group?.publishedAt);
  if (!group) reasonCodes.push("OPTION_GROUP_NOT_FOUND");
  if (group && !active) reasonCodes.push("OPTION_GROUP_INACTIVE");
  if (group && !visible) reasonCodes.push("OPTION_GROUP_HIDDEN");
  if (group && !available) reasonCodes.push("OPTION_GROUP_UNAVAILABLE");
  if (group && !published) reasonCodes.push("OPTION_GROUP_UNPUBLISHED");
  return {
    active,
    visible,
    available,
    published,
    customerReady: reasonCodes.length === 0,
    reasonCodes,
  };
}

function groupRole(group = {}) {
  const key = String(group.key || "").trim().toLowerCase();
  const ar = String(group.name?.ar || "").trim().toLowerCase();
  const en = String(group.name?.en || "").trim().toLowerCase();
  const haystack = `${key} ${ar} ${en}`;
  if (haystack.includes("carb") || haystack.includes("كارب") || haystack.includes("نشويات")) {
    return "carbs";
  }
  if (haystack.includes("protein") || haystack.includes("بروتين")) {
    return "protein";
  }
  return null;
}

function isPremiumOption(option = {}) {
  const selectionType = String(option.selectionType || "").trim().toLowerCase();
  return Boolean(
    String(option.premiumKey || "").trim() ||
      selectionType === "premium_meal" ||
      selectionType === "premium_large_salad"
  );
}

function optionFamilyKey(option = {}) {
  const explicit = String(
    option.proteinFamilyKey || option.displayCategoryKey || ""
  )
    .trim()
    .toLowerCase();
  if (explicit) return explicit;
  return String(resolveProteinVisualFamilyKey(option) || "")
    .trim()
    .toLowerCase();
}

function optionAssignmentMap(
  sections = [],
  { productContextId, sourceGroupId, excludedSectionKey = "" } = {}
) {
  const excluded = String(excludedSectionKey || "").trim().toLowerCase();
  const map = new Map();
  for (const section of sections) {
    const key = sectionKeyOf(section);
    if (excluded && key === excluded) continue;
    if (!isOptionCard(section)) continue;
    if (String(section.productContextId || "") !== String(productContextId || "")) continue;
    if (String(section.sourceGroupId || "") !== String(sourceGroupId || "")) continue;
    for (const optionId of section.selectedOptionIds || []) {
      const id = String(optionId);
      if (!map.has(id)) map.set(id, key || "unknown");
    }
  }
  return map;
}

async function plannerConfig({ lang = "en", preferDraft = true } = {}) {
  const state = await compatibilityService.getDashboardState({ lang });
  return preferDraft
    ? state.draft || state.published || null
    : state.published || state.draft || null;
}

async function loadOptionContext({ productContextId, sourceGroupId }) {
  const productId = normalizeObjectId(productContextId, "productContextId");
  const groupId = normalizeObjectId(sourceGroupId, "sourceGroupId");
  const [product, group, groupRelation] = await Promise.all([
    MenuProduct.findById(productId).lean(),
    MenuOptionGroup.findById(groupId).lean(),
    ProductOptionGroup.findOne({ productId, groupId }).lean(),
  ]);

  if (!product) {
    throw mealBuilderError(
      "Base product was not found",
      "MEAL_BUILDER_PRODUCT_NOT_FOUND",
      404,
      { productContextId: productId }
    );
  }
  if (!group) {
    throw mealBuilderError(
      "Option group was not found",
      "MEAL_BUILDER_OPTION_GROUP_NOT_FOUND",
      404,
      { sourceGroupId: groupId }
    );
  }
  if (!groupRelation) {
    throw mealBuilderError(
      "Option group is not linked to the selected base product",
      "MEAL_BUILDER_PRODUCT_GROUP_RELATION_INVALID",
      422,
      { productContextId: productId, sourceGroupId: groupId }
    );
  }

  return { productId, groupId, product, group, groupRelation };
}

function assertRoleMatchesGroup(optionRole, group) {
  const actualRole = groupRole(group);
  const requestedRole = String(optionRole || actualRole || "").trim().toLowerCase();
  if (!actualRole || !["protein", "carbs"].includes(actualRole)) {
    throw mealBuilderError(
      "The selected option group is not supported by Meal Planner cards",
      "MEAL_BUILDER_OPTION_ROLE_GROUP_MISMATCH",
      422,
      { groupId: String(group._id), groupKey: group.key || "" }
    );
  }
  if (requestedRole && requestedRole !== actualRole) {
    throw mealBuilderError(
      "The selected option group does not match the card option role",
      "MEAL_BUILDER_OPTION_ROLE_GROUP_MISMATCH",
      422,
      {
        requestedRole,
        actualRole,
        groupId: String(group._id),
        groupKey: group.key || "",
      }
    );
  }
  return actualRole;
}

async function assertOptionFamilyAssignable({
  optionIds,
  productContextId,
  sourceGroupId,
  optionRole,
  familyKey,
  sections,
  excludedSectionKey = "",
}) {
  const ids = normalizeIds(optionIds, "optionIds", true);
  const context = await loadOptionContext({ productContextId, sourceGroupId });
  const actualRole = assertRoleMatchesGroup(optionRole, context.group);
  const normalizedFamilyKey =
    actualRole === "protein" ? String(familyKey || "").trim().toLowerCase() : "";

  const [relations, options] = await Promise.all([
    ProductGroupOption.find({
      productId: context.productId,
      groupId: context.groupId,
      optionId: { $in: ids },
    }).lean(),
    MenuOption.find({ _id: { $in: ids } }).lean(),
  ]);
  const relationsByOptionId = new Map(
    relations.map((relation) => [String(relation.optionId), relation])
  );
  const optionsById = new Map(options.map((option) => [String(option._id), option]));
  const missingOptions = ids.filter((id) => !optionsById.has(id));
  if (missingOptions.length) {
    throw mealBuilderError(
      "Some options do not exist",
      "MEAL_BUILDER_OPTION_NOT_FOUND",
      404,
      { optionIds: missingOptions }
    );
  }
  const invalidRelations = ids.filter((id) => !relationsByOptionId.has(id));
  if (invalidRelations.length) {
    throw mealBuilderError(
      "Some options are not linked to the selected product and group",
      "MEAL_BUILDER_OPTION_RELATION_INVALID",
      422,
      {
        productContextId: context.productId,
        sourceGroupId: context.groupId,
        optionIds: invalidRelations,
      }
    );
  }

  const catalogItemsById = await loadCatalogItemsByIdForDocs(
    [context.product],
    options
  );
  const productState = entityStatus(context.product, catalogItemsById, "PRODUCT");
  const optionGroupState = groupStatus(context.group);
  const groupRelationState = relationStatus(context.groupRelation);
  const problems = [];

  if (!productState.customerReady) {
    problems.push({ type: "product", id: context.productId, reasonCodes: productState.reasonCodes });
  }
  if (!optionGroupState.customerReady) {
    problems.push({ type: "group", id: context.groupId, reasonCodes: optionGroupState.reasonCodes });
  }
  if (!groupRelationState.effective) {
    problems.push({
      type: "product_group_relation",
      id: String(context.groupRelation._id),
      reasonCodes: ["PRODUCT_GROUP_RELATION_UNAVAILABLE"],
    });
  }

  for (const id of ids) {
    const option = optionsById.get(id);
    const relation = relationsByOptionId.get(id);
    const state = entityStatus(option, catalogItemsById, "OPTION");
    const linkState = relationStatus(relation);
    const reasonCodes = [...state.reasonCodes];
    if (!linkState.effective) reasonCodes.push("OPTION_RELATION_UNAVAILABLE");
    if (String(option.groupId || "") !== context.groupId) {
      reasonCodes.push("OPTION_GROUP_MISMATCH");
    }
    if (isPremiumOption(option)) reasonCodes.push("PREMIUM_OPTION_MANAGED_SEPARATELY");
    if (normalizedFamilyKey && optionFamilyKey(option) !== normalizedFamilyKey) {
      reasonCodes.push("OPTION_FAMILY_MISMATCH");
    }
    if (reasonCodes.length) {
      problems.push({ type: "option", id, key: option.key || "", reasonCodes });
    }
  }

  if (problems.length) {
    throw mealBuilderError(
      "Some options are not ready for the selected Meal Planner card",
      "MEAL_BUILDER_OPTION_CARD_UNAVAILABLE",
      422,
      { problems }
    );
  }

  const assignedElsewhere = optionAssignmentMap(sections, {
    productContextId: context.productId,
    sourceGroupId: context.groupId,
    excludedSectionKey,
  });
  const conflicts = ids
    .filter((id) => assignedElsewhere.has(id))
    .map((id) => ({ optionId: id, sectionKey: assignedElsewhere.get(id) }));
  if (conflicts.length) {
    throw mealBuilderError(
      "An option cannot be assigned to more than one card for the same product and group",
      "MEAL_BUILDER_OPTION_ALREADY_ASSIGNED",
      409,
      { conflicts }
    );
  }

  return {
    ...context,
    optionRole: actualRole,
    familyKey: normalizedFamilyKey,
    optionIds: ids,
    options,
    optionsById,
    relations,
    relationsByOptionId,
  };
}

function buildOptionSection({ source = {}, key, context, sections, existing = null }) {
  const current = existing ? writableSection(existing) : null;
  const optionRole = context.optionRole;
  const isCarbs = optionRole === "carbs";
  const defaultMax = isCarbs ? Number(STANDARD_CARB_RULES.maxTypes || 2) : 1;
  const familyKey = context.familyKey;
  const incomingRules =
    source.rules && typeof source.rules === "object" ? source.rules : {};
  const baseRules = isCarbs ? { ...STANDARD_CARB_RULES } : {};

  return {
    ...(current || {}),
    key,
    sectionType: "option_group",
    sourceKind: familyKey ? "visual_family" : "configurable_product",
    titleOverride:
      Object.prototype.hasOwnProperty.call(source, "titleOverride") ||
      Object.prototype.hasOwnProperty.call(source, "title") ||
      !current
        ? normalizeLocalizedTitle(source.titleOverride || source.title, key)
        : current.titleOverride,
    productContextId: context.productId,
    sourceGroupId: context.groupId,
    sourceCategoryId: null,
    selectedOptionIds: context.optionIds,
    selectedProductIds: [],
    includeMode: "selected",
    selectionType: STANDARD_SELECTION_TYPE,
    sortOrder: normalizeOptionalInteger(
      source.sortOrder,
      current ? current.sortOrder : maxSortOrder(sections) + 10
    ),
    required: Object.prototype.hasOwnProperty.call(source, "required")
      ? source.required === true
      : current?.required === true,
    minSelections: normalizeOptionalInteger(
      source.minSelections,
      current ? current.minSelections : 0
    ),
    maxSelections: Object.prototype.hasOwnProperty.call(source, "maxSelections")
      ? normalizeOptionalInteger(source.maxSelections, defaultMax)
      : current?.maxSelections ?? defaultMax,
    multiSelect: Object.prototype.hasOwnProperty.call(source, "multiSelect")
      ? source.multiSelect === true
      : current?.multiSelect ?? isCarbs,
    visible: Object.prototype.hasOwnProperty.call(source, "visible")
      ? source.visible !== false
      : current?.visible !== false,
    availableFor: ["subscription"],
    metadata: {
      ...(current?.metadata || {}),
      ...(source.metadata && typeof source.metadata === "object"
        ? source.metadata
        : {}),
      cardType: "option_family",
      cardKind: "option_family",
      dashboardManaged: true,
      optionRole,
      familyKey: familyKey || "",
      proteinFamilyKey: familyKey || "",
      sourceGroupKey: context.group.key || "",
      visualRole: isCarbs
        ? "carbs"
        : familyKey
          ? "protein_family"
          : "protein_group",
    },
    rules: {
      ...baseRules,
      ...(current?.rules || {}),
      ...incomingRules,
    },
  };
}

async function cardActionResponse({
  action,
  draft,
  sectionKey,
  previousSectionKey = null,
  itemId = null,
  productId = null,
}) {
  const validation = await compatibilityService.validatePayload({
    sections: draft.sections || [],
  });
  const section = sectionKey
    ? (draft.sections || []).find(
        (item) => sectionKeyOf(item) === String(sectionKey).toLowerCase()
      ) || null
    : null;
  return {
    contractVersion: CARD_ACTION_VERSION,
    action,
    sectionKey: sectionKey || null,
    previousSectionKey,
    itemId,
    productId,
    section,
    draft,
    validation,
    summary: {
      sectionCount: (draft.sections || []).length,
      selectedProductCount: (draft.sections || []).reduce(
        (sum, item) => sum + (item.selectedProductIds || []).length,
        0
      ),
      selectedOptionCount: (draft.sections || []).reduce(
        (sum, item) => sum + (item.selectedOptionIds || []).length,
        0
      ),
      ready: validation.ready === true,
      errorCount: (validation.errors || []).length,
      warningCount: (validation.warnings || []).length,
    },
  };
}

async function getExplicitOptionPicker({
  sectionKey = "options",
  targetSectionKey,
  productContextId,
  sourceGroupId,
  optionRole,
  familyKey,
  lang = "en",
  q = "",
  includeUnavailable,
  unassignedOnly,
  page,
  limit,
} = {}) {
  const config = await plannerConfig({ lang, preferDraft: true });
  const sections = (config?.sections || []).map(writableSection);
  const targetKey = String(targetSectionKey || "").trim().toLowerCase();
  const currentSection = targetKey
    ? sections.find((section) => sectionKeyOf(section) === targetKey) || null
    : null;
  const resolvedProductId = productContextId || currentSection?.productContextId;
  const resolvedGroupId = sourceGroupId || currentSection?.sourceGroupId;
  const resolvedRole = optionRole || currentSection?.metadata?.optionRole;
  const resolvedFamilyKey =
    familyKey !== undefined
      ? familyKey
      : currentSection?.metadata?.proteinFamilyKey ||
        currentSection?.metadata?.familyKey ||
        "";
  const context = await loadOptionContext({
    productContextId: resolvedProductId,
    sourceGroupId: resolvedGroupId,
  });
  const actualRole = assertRoleMatchesGroup(resolvedRole, context.group);
  const normalizedFamilyKey =
    actualRole === "protein"
      ? String(resolvedFamilyKey || "").trim().toLowerCase()
      : "";
  const selectedIds = new Set((currentSection?.selectedOptionIds || []).map(String));
  const assignedElsewhere = optionAssignmentMap(sections, {
    productContextId: context.productId,
    sourceGroupId: context.groupId,
    excludedSectionKey: targetKey,
  });
  const pagination = normalizePagination({ page, limit });
  const showUnavailable = normalizeBoolean(includeUnavailable, false);
  const onlyUnassigned = normalizeBoolean(unassignedOnly, true);

  const optionRelations = await ProductGroupOption.find({
    productId: context.productId,
    groupId: context.groupId,
  })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const optionIds = optionRelations.map((relation) => relation.optionId);
  const options = optionIds.length
    ? await MenuOption.find({ _id: { $in: optionIds } })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean()
    : [];
  const optionsById = new Map(options.map((option) => [String(option._id), option]));
  const catalogItemsById = await loadCatalogItemsByIdForDocs(
    [context.product],
    options
  );
  const productState = entityStatus(context.product, catalogItemsById, "PRODUCT");
  const optionGroupState = groupStatus(context.group);
  const groupRelationState = relationStatus(context.groupRelation);
  const query = String(q || "").trim().toLowerCase();

  const allRows = optionRelations
    .map((relation) => {
      const option = optionsById.get(String(relation.optionId));
      if (!option) return null;
      const id = String(option._id);
      const selected = selectedIds.has(id);
      const optionState = entityStatus(option, catalogItemsById, "OPTION");
      const optionRelationState = relationStatus(relation);
      const premium = isPremiumOption(option);
      const familyMatches =
        !normalizedFamilyKey || optionFamilyKey(option) === normalizedFamilyKey;
      if (!selected && actualRole === "protein" && !familyMatches) return null;
      if (!selected && premium) return null;
      if (
        query &&
        ![
          option.key,
          option.name?.ar,
          option.name?.en,
          option.description?.ar,
          option.description?.en,
        ]
          .map((value) => String(value || "").toLowerCase())
          .some((value) => value.includes(query))
      ) {
        return null;
      }

      const assignedSectionKey = selected ? null : assignedElsewhere.get(id) || null;
      const assigned = selected || Boolean(assignedSectionKey);
      const reasonCodes = [
        ...productState.reasonCodes,
        ...optionGroupState.reasonCodes,
        ...optionState.reasonCodes,
      ];
      if (!groupRelationState.effective) {
        reasonCodes.push("PRODUCT_GROUP_RELATION_UNAVAILABLE");
      }
      if (!optionRelationState.effective) {
        reasonCodes.push("OPTION_RELATION_UNAVAILABLE");
      }
      if (String(option.groupId || "") !== context.groupId) {
        reasonCodes.push("OPTION_GROUP_MISMATCH");
      }
      if (!familyMatches) reasonCodes.push("OPTION_FAMILY_MISMATCH");
      if (premium) reasonCodes.push("PREMIUM_OPTION_MANAGED_SEPARATELY");
      if (assignedSectionKey) reasonCodes.push("ASSIGNED_TO_OTHER_CARD");
      const uniqueReasonCodes = [...new Set(reasonCodes)];
      const ready = uniqueReasonCodes.length === 0;
      const assignable = ready && !assignedSectionKey;
      const overridePrice =
        relation.extraPriceHalala === null || relation.extraPriceHalala === undefined
          ? null
          : Number(relation.extraPriceHalala || 0);
      const defaultPrice = Number(option.extraPriceHalala || 0);

      return {
        id,
        optionId: id,
        type: "option",
        key: option.key || "",
        name: option.name || { ar: "", en: "" },
        label: pickLang(option.name || {}, lang),
        imageUrl: option.imageUrl || "",
        groupId: context.groupId,
        productContextId: context.productId,
        optionRole: actualRole,
        selectionType: STANDARD_SELECTION_TYPE,
        proteinFamilyKey: option.proteinFamilyKey || "",
        displayCategoryKey: option.displayCategoryKey || "",
        isPremium: premium,
        pricing: {
          defaultExtraPriceHalala: defaultPrice,
          overrideExtraPriceHalala: overridePrice,
          effectiveExtraPriceHalala:
            overridePrice === null ? defaultPrice : overridePrice,
          currency: option.currency || SYSTEM_CURRENCY,
        },
        extraPriceHalala: overridePrice === null ? defaultPrice : overridePrice,
        currency: option.currency || SYSTEM_CURRENCY,
        selected,
        assigned,
        assignedSectionKey,
        assignable: selected || assignable,
        required: false,
        eligible: selected || assignable,
        linked: true,
        relationExists: true,
        available: optionState.available,
        active: optionState.active,
        visible: optionState.visible,
        published: optionState.published,
        subscriptionEnabled: optionState.subscriptionEnabled,
        catalogItemAvailable: optionState.catalogItemAvailable,
        relationStatus: optionRelationState,
        status: optionState,
        reasonCodes: selected
          ? ["SELECTED", ...uniqueReasonCodes]
          : assignable
            ? ["ELIGIBLE"]
            : uniqueReasonCodes,
        warnings: [],
        errors: [],
        state: selected
          ? "selected"
          : assignedSectionKey
            ? "assigned_elsewhere"
            : assignable
              ? "eligible"
              : "unavailable",
        sortOrder: Number(relation.sortOrder ?? option.sortOrder ?? 0),
      };
    })
    .filter(Boolean)
    .filter((candidate) => candidate.selected || showUnavailable || candidate.assignable)
    .sort(
      (left, right) =>
        Number(right.selected) - Number(left.selected) ||
        Number(right.assignable) - Number(left.assignable) ||
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
        String(left.key).localeCompare(String(right.key))
    );

  const rows = onlyUnassigned
    ? allRows.filter((candidate) => candidate.selected || candidate.assignable)
    : allRows;
  const total = rows.length;
  const candidates = rows.slice(
    pagination.skip,
    pagination.skip + pagination.limit
  );

  return {
    contractVersion: PICKER_VERSION,
    sectionKey: String(sectionKey || "options").trim().toLowerCase(),
    targetSectionKey: targetKey || null,
    cardType: "option_family",
    candidateType: "option",
    context: {
      product: {
        id: context.productId,
        key: context.product.key || "",
        name: context.product.name || { ar: "", en: "" },
        status: productState,
      },
      group: {
        id: context.groupId,
        key: context.group.key || "",
        name: context.group.name || { ar: "", en: "" },
        status: optionGroupState,
      },
      relationStatus: groupRelationState,
    },
    product: {
      id: context.productId,
      key: context.product.key || "",
      name: context.product.name || { ar: "", en: "" },
    },
    group: {
      id: context.groupId,
      key: context.group.key || "",
      name: context.group.name || { ar: "", en: "" },
    },
    rules: {
      selectionTypeRequired: true,
      allowedSelectionTypes: [STANDARD_SELECTION_TYPE],
      canonicalSelectionType: STANDARD_SELECTION_TYPE,
      source: "product_group_options",
      optionRole: actualRole,
      familyKey: normalizedFamilyKey || null,
      relationScoped: true,
      uniquenessScope: "product_group_current_draft",
      excludeOptionsAssignedToOtherCards: onlyUnassigned,
      minSelections: Number(context.groupRelation.minSelections || 0),
      maxSelections:
        context.groupRelation.maxSelections === null ||
        context.groupRelation.maxSelections === undefined
          ? null
          : Number(context.groupRelation.maxSelections),
      isRequired: context.groupRelation.isRequired === true,
    },
    candidates,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
      catalogTotal: allRows.length,
      selectedInCurrentCard: allRows.filter((row) => row.selected).length,
      assignedToOtherCards: allRows.filter(
        (row) => row.state === "assigned_elsewhere"
      ).length,
      unassigned: allRows.filter((row) => row.state === "eligible").length,
      unavailable: allRows.filter((row) => row.state === "unavailable").length,
    },
  };
}

async function getSectionPicker(options = {}) {
  const sectionKey = String(options.sectionKey || "").trim().toLowerCase();
  if (
    sectionKey === "options" ||
    options.productContextId ||
    options.sourceGroupId
  ) {
    return getExplicitOptionPicker(options);
  }
  return compatibilityService.getSectionPicker(options);
}

async function createProductSection({ section = {}, actor = {} } = {}) {
  if (!isOptionFamilyPayload(section)) {
    return compatibilityService.createProductSection({ section, actor });
  }

  const draft = await compatibilityService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const key = normalizeSectionKey(section.key || section.sectionKey);
  if (sections.some((item) => sectionKeyOf(item) === key)) {
    throw mealBuilderError(
      "Meal Builder card key already exists",
      "MEAL_BUILDER_CARD_KEY_DUPLICATE",
      409,
      { sectionKey: key }
    );
  }

  const context = await assertOptionFamilyAssignable({
    optionIds: section.selectedOptionIds || section.optionIds,
    productContextId: section.productContextId,
    sourceGroupId: section.sourceGroupId,
    optionRole: section.optionRole || section.metadata?.optionRole,
    familyKey:
      section.familyKey ||
      section.metadata?.proteinFamilyKey ||
      section.metadata?.familyKey,
    sections,
  });
  const nextSection = buildOptionSection({
    source: section,
    key,
    context,
    sections,
  });
  const updatedDraft = await compatibilityService.updateDraft({
    sections: [...sections, nextSection],
    actor,
    notes: draft.notes,
  });
  return cardActionResponse({
    action: "created",
    draft: updatedDraft,
    sectionKey: key,
  });
}

async function updateProductSection({ sectionKey, patch = {}, actor = {} } = {}) {
  const draft = await compatibilityService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const currentKey = normalizeSectionKey(sectionKey);
  const current = findSection(sections, currentKey);
  assertWritableCard(current);

  if (!isOptionCard(current)) {
    if (isOptionFamilyPayload(patch)) {
      throw mealBuilderError(
        "Card type cannot be changed after creation",
        "MEAL_BUILDER_CARD_TYPE_CHANGE_UNSUPPORTED",
        409,
        { sectionKey: currentKey }
      );
    }
    return compatibilityService.updateProductSection({ sectionKey, patch, actor });
  }

  const requestedCardType = String(patch.cardType || patch.metadata?.cardType || "").trim();
  if (requestedCardType && requestedCardType !== "option_family") {
    throw mealBuilderError(
      "Card type cannot be changed after creation",
      "MEAL_BUILDER_CARD_TYPE_CHANGE_UNSUPPORTED",
      409,
      { sectionKey: currentKey }
    );
  }
  const nextKey = patch.key ? normalizeSectionKey(patch.key) : currentKey;
  if (
    nextKey !== currentKey &&
    sections.some((item) => sectionKeyOf(item) === nextKey)
  ) {
    throw mealBuilderError(
      "Meal Builder card key already exists",
      "MEAL_BUILDER_CARD_KEY_DUPLICATE",
      409,
      { sectionKey: nextKey }
    );
  }

  const context = await assertOptionFamilyAssignable({
    optionIds: Object.prototype.hasOwnProperty.call(patch, "selectedOptionIds") ||
      Object.prototype.hasOwnProperty.call(patch, "optionIds")
      ? patch.selectedOptionIds || patch.optionIds
      : current.selectedOptionIds,
    productContextId: patch.productContextId || current.productContextId,
    sourceGroupId: patch.sourceGroupId || current.sourceGroupId,
    optionRole:
      patch.optionRole ||
      patch.metadata?.optionRole ||
      current.metadata?.optionRole,
    familyKey:
      patch.familyKey !== undefined
        ? patch.familyKey
        : patch.metadata?.proteinFamilyKey !== undefined
          ? patch.metadata.proteinFamilyKey
          : current.metadata?.proteinFamilyKey || current.metadata?.familyKey,
    sections,
    excludedSectionKey: currentKey,
  });
  const nextSection = buildOptionSection({
    source: patch,
    key: nextKey,
    context,
    sections,
    existing: current,
  });
  const updatedDraft = await compatibilityService.updateDraft({
    sections: sections.map((item) =>
      sectionKeyOf(item) === currentKey ? nextSection : item
    ),
    actor,
    notes: draft.notes,
  });
  return cardActionResponse({
    action: "updated",
    draft: updatedDraft,
    sectionKey: nextKey,
    previousSectionKey: nextKey === currentKey ? null : currentKey,
  });
}

async function deleteProductSection({ sectionKey, actor = {} } = {}) {
  const draft = await compatibilityService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const key = normalizeSectionKey(sectionKey);
  const current = findSection(sections, key);
  assertWritableCard(current);
  if (!isOptionCard(current)) {
    return compatibilityService.deleteProductSection({ sectionKey, actor });
  }
  const updatedDraft = await compatibilityService.updateDraft({
    sections: sections.filter((section) => sectionKeyOf(section) !== key),
    actor,
    notes: draft.notes,
  });
  return cardActionResponse({
    action: "deleted",
    draft: updatedDraft,
    sectionKey: null,
    previousSectionKey: key,
  });
}

async function replaceSectionItems({
  sectionKey,
  productIds,
  optionIds,
  actor = {},
} = {}) {
  const draft = await compatibilityService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const key = normalizeSectionKey(sectionKey);
  const current = findSection(sections, key);
  assertWritableCard(current);
  if (!isOptionCard(current)) {
    return compatibilityService.updateProductSection({
      sectionKey: key,
      patch: { selectedProductIds: productIds },
      actor,
    });
  }
  return updateProductSection({
    sectionKey: key,
    patch: { selectedOptionIds: optionIds },
    actor,
  });
}

async function addOptionsToSection({ sectionKey, optionIds, actor = {} } = {}) {
  const draft = await compatibilityService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const key = normalizeSectionKey(sectionKey);
  const current = findSection(sections, key);
  assertWritableCard(current);
  if (!isOptionCard(current)) {
    throw mealBuilderError(
      "This action is only supported for option cards",
      "MEAL_BUILDER_CARD_TYPE_UNSUPPORTED",
      409,
      { sectionKey: key }
    );
  }
  const additions = normalizeIds(optionIds, "optionIds", true);
  return updateProductSection({
    sectionKey: key,
    patch: {
      selectedOptionIds: [
        ...new Set([...(current.selectedOptionIds || []), ...additions]),
      ],
    },
    actor,
  });
}

async function removeOptionFromSection({ sectionKey, optionId, actor = {} } = {}) {
  const draft = await compatibilityService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const key = normalizeSectionKey(sectionKey);
  const current = findSection(sections, key);
  assertWritableCard(current);
  if (!isOptionCard(current)) {
    throw mealBuilderError(
      "This action is only supported for option cards",
      "MEAL_BUILDER_CARD_TYPE_UNSUPPORTED",
      409,
      { sectionKey: key }
    );
  }
  const id = normalizeObjectId(optionId, "optionId");
  const currentIds = (current.selectedOptionIds || []).map(String);
  if (!currentIds.includes(id)) {
    throw mealBuilderError(
      "Option is not assigned to this card",
      "MEAL_BUILDER_OPTION_NOT_IN_CARD",
      404,
      { sectionKey: key, optionId: id }
    );
  }
  const selectedOptionIds = currentIds.filter((item) => item !== id);
  if (!selectedOptionIds.length) {
    throw mealBuilderError(
      "An option card cannot be empty; delete the card instead",
      "MEAL_BUILDER_CARD_WOULD_BE_EMPTY",
      422,
      { sectionKey: key, optionId: id }
    );
  }
  const response = await updateProductSection({
    sectionKey: key,
    patch: { selectedOptionIds },
    actor,
  });
  return {
    ...response,
    action: "option_removed",
    itemId: id,
  };
}

module.exports = {
  ...compatibilityService,
  CARD_ACTION_VERSION,
  PICKER_VERSION,
  addOptionsToSection,
  createProductSection,
  deleteProductSection,
  getExplicitOptionPicker,
  getSectionPicker,
  removeOptionFromSection,
  replaceSectionItems,
  updateProductSection,
};
