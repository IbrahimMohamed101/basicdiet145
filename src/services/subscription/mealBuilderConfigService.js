const crypto = require("crypto");
const mongoose = require("mongoose");

const MealBuilderConfig = require("../../models/MealBuilderConfig");
const MenuCategory = require("../../models/MenuCategory");
const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuProduct = require("../../models/MenuProduct");
const ProductGroupOption = require("../../models/ProductGroupOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const { pickLang } = require("../../utils/i18n");
const {
  CUSTOMER_VISIBLE_CARB_KEYS,
  MEAL_SELECTION_TYPES,
  PREMIUM_MEAL_PROTEIN_KEYS,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
  PROTEIN_DISPLAY_GROUPS,
  STANDARD_CARB_RULES,
  STANDARD_MEAL_EXTENDED_PROTEIN_KEYS,
  SUBSCRIPTION_COLD_SANDWICH_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
  SYSTEM_CURRENCY,
  getMealPlannerRules,
  resolveProteinVisualFamilyKey,
} = require("../../config/mealPlannerContract");
const {
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");
const {
  loadClientPremiumUpgradeConfigState,
  resolvePremiumUpgrade,
} = require("./premiumUpgradeConfigService");

const CONTRACT_VERSION = "subscription_meal_builder.v1";
const SECTION_TYPES = new Set(["option_group", "product_category", "product_list"]);
const INCLUDE_MODES = new Set(["all", "selected"]);
const SOURCE_KINDS = new Set(["", "visual_family", "configurable_product", "product_list", "premium_visual"]);
const PREMIUM_PROTEIN_KEYS = new Set(PREMIUM_MEAL_PROTEIN_KEYS);
const SALAD_ALLOWED_PROTEIN_KEYS = new Set(SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS);
const SALAD_EXCLUDED_GROUP_KEYS = new Set(SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS);
const VISUAL_TEMPLATE_ORDER = Object.freeze(["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]);
const VISUAL_PROTEIN_FAMILY_KEYS = new Set(["chicken", "beef", "fish", "eggs"]);
const VISUAL_PROTEIN_FAMILY_DEFINITIONS = new Map(PROTEIN_DISPLAY_GROUPS.map((group) => [group.key, group]));
const PREMIUM_SECTION_TITLE = Object.freeze({ ar: "مميز", en: "Premium" });
const SANDWICH_SECTION_TITLE = Object.freeze({ ar: "ساندوتشات", en: "Sandwiches" });
const CARBS_SECTION_TITLE = Object.freeze({ ar: "نشويات", en: "Carbs" });
const HYDRATED_DRAFT_VERSION = "dashboard_meal_builder_hydrated_draft.v1";
const PICKER_VERSION = "dashboard_meal_builder_picker.v1";
const SUPPORTED_PICKER_SECTION_KEYS = new Set(["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]);
const NON_PROTEIN_PICKER_OPTION_KEYS = new Set([
  "ranch",
  "mango",
  "cashew",
  "tomato",
  "extra_chicken_50g",
  "extra_protein_50g",
]);
const CANONICAL_SECTION_SORT_ORDER = Object.freeze({
  premium: 10,
  sandwich: 20,
  chicken: 30,
  beef: 40,
  fish: 50,
  eggs: 60,
  carbs: 70,
});
const CANONICAL_SECTION_TYPE = Object.freeze({
  premium: "mixed",
  sandwich: "product_list",
  chicken: "option_family",
  beef: "option_family",
  fish: "option_family",
  eggs: "option_family",
  carbs: "option_group",
});
const MEAL_BUILDER_PICKER_DIAGNOSTIC_MARKER = "meal_builder_picker_v3_option_family_catalog_discovery";
const MEAL_BUILDER_PICKER_BASE_COMMIT = "12bdcc8a";

class MealBuilderError extends Error {
  constructor(message, code = "MEAL_BUILDER_ERROR", status = 400, details) {
    super(message);
    this.name = "MealBuilderError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function objectIdOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const str = String(value);
  if (!mongoose.Types.ObjectId.isValid(str)) {
    throw new MealBuilderError("Invalid ObjectId in meal builder section", "MEAL_BUILDER_INVALID_REFERENCE", 400, { value });
  }
  return str;
}

function objectIdArray(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new MealBuilderError("Expected an array of ObjectIds", "MEAL_BUILDER_INVALID_REFERENCE");
  }
  return [...new Set(value.map(objectIdOrNull).filter(Boolean))];
}

function localized(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ar: "", en: "" };
  return {
    ar: value.ar === undefined || value.ar === null ? "" : String(value.ar).trim(),
    en: value.en === undefined || value.en === null ? "" : String(value.en).trim(),
  };
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return Boolean(value);
}

function normalizeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new MealBuilderError("Meal builder numeric fields must be integers >= 0", "MEAL_BUILDER_INVALID_RULE");
  }
  return parsed;
}

function normalizeNullableInteger(value, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  return normalizeInteger(value, fallback || 0);
}

function normalizeAvailableFor(value) {
  if (value === undefined || value === null) return ["subscription"];
  const values = Array.isArray(value) ? value : [value];
  const normalized = values.map((item) => String(item || "").trim()).filter(Boolean);
  if (normalized.some((item) => item !== "subscription")) {
    throw new MealBuilderError("Meal Builder is subscription-only", "MEAL_BUILDER_INVALID_CHANNEL");
  }
  return normalized.length ? ["subscription"] : [];
}

function matchSaladGroupKey(a, b) {
  if (!a || !b) return false;
  const ka = String(a).trim().toLowerCase();
  const kb = String(b).trim().toLowerCase();
  if (ka === kb) return true;
  if (ka === kb + "s" || kb === ka + "s") return true;
  if (ka === "vegetables_legumes" && kb === "vegetables") return true;
  if (kb === "vegetables_legumes" && ka === "vegetables") return true;
  return false;
}

function normalizeSection(section = {}, index = 0) {
  const sectionWithCanonicalAliases = normalizeCanonicalSectionAliases(section);
  const sectionType = String(sectionWithCanonicalAliases.sectionType || "").trim();
  if (!SECTION_TYPES.has(sectionType)) {
    throw new MealBuilderError("Unsupported meal builder section type", "MEAL_BUILDER_INVALID_SECTION_TYPE", 400, { sectionType, index });
  }
  const sourceKind = String(sectionWithCanonicalAliases.sourceKind || "").trim();
  if (!SOURCE_KINDS.has(sourceKind)) {
    throw new MealBuilderError("Unsupported meal builder sourceKind", "MEAL_BUILDER_INVALID_SOURCE_KIND", 400, { sourceKind, index });
  }
  const includeMode = String(sectionWithCanonicalAliases.includeMode || "selected").trim();
  if (!INCLUDE_MODES.has(includeMode)) {
    throw new MealBuilderError("Unsupported meal builder includeMode", "MEAL_BUILDER_INVALID_INCLUDE_MODE", 400, { includeMode, index });
  }

  const normalized = {
    key: String(sectionWithCanonicalAliases.key || sectionWithCanonicalAliases.sectionKey || "").trim(),
    sectionType,
    sourceKind,
    titleOverride: localized(sectionWithCanonicalAliases.titleOverride || sectionWithCanonicalAliases.title),
    productContextId: objectIdOrNull(sectionWithCanonicalAliases.productContextId),
    sourceGroupId: objectIdOrNull(sectionWithCanonicalAliases.sourceGroupId),
    sourceCategoryId: objectIdOrNull(sectionWithCanonicalAliases.sourceCategoryId),
    selectedOptionIds: objectIdArray(sectionWithCanonicalAliases.selectedOptionIds || sectionWithCanonicalAliases.optionIds),
    selectedProductIds: objectIdArray(sectionWithCanonicalAliases.selectedProductIds || sectionWithCanonicalAliases.productIds),
    includeMode,
    selectionType: String(sectionWithCanonicalAliases.selectionType || "").trim(),
    sortOrder: normalizeInteger(sectionWithCanonicalAliases.sortOrder, CANONICAL_SECTION_SORT_ORDER[String(sectionWithCanonicalAliases.key || "").trim()] || index + 1),
    required: normalizeBoolean(sectionWithCanonicalAliases.required ?? sectionWithCanonicalAliases.isRequired, false),
    minSelections: normalizeInteger(sectionWithCanonicalAliases.minSelections, 0),
    maxSelections: normalizeNullableInteger(sectionWithCanonicalAliases.maxSelections, null),
    multiSelect: normalizeBoolean(sectionWithCanonicalAliases.multiSelect, false),
    visible: normalizeBoolean(sectionWithCanonicalAliases.visible, true),
    availableFor: normalizeAvailableFor(sectionWithCanonicalAliases.availableFor),
    metadata: plainObject(sectionWithCanonicalAliases.metadata),
    rules: plainObject(sectionWithCanonicalAliases.rules),
  };

  if (normalized.maxSelections !== null && normalized.maxSelections < normalized.minSelections) {
    throw new MealBuilderError("maxSelections cannot be lower than minSelections", "MEAL_BUILDER_INVALID_RULE", 400, { index });
  }
  if (sectionType === "option_group" && (!normalized.productContextId || !normalized.sourceGroupId)) {
    throw new MealBuilderError("option_group sections require productContextId and sourceGroupId", "MEAL_BUILDER_INVALID_SECTION_REFERENCE", 400, { index });
  }
  if (sectionType === "product_category" && !normalized.sourceCategoryId) {
    throw new MealBuilderError("product_category sections require sourceCategoryId", "MEAL_BUILDER_INVALID_SECTION_REFERENCE", 400, { index });
  }
  if (sectionType === "product_list" && normalized.includeMode === "selected" && !normalized.selectedProductIds.length) {
    throw new MealBuilderError("product_list sections require selectedProductIds", "MEAL_BUILDER_INVALID_SECTION_REFERENCE", 400, { index });
  }

  return normalized;
}

function normalizeSections(sections = []) {
  if (!Array.isArray(sections)) {
    throw new MealBuilderError("sections must be an array", "MEAL_BUILDER_INVALID_SECTIONS");
  }
  return sections.map(normalizeSection).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

async function normalizeSectionsForWrite(sections = []) {
  if (!Array.isArray(sections)) {
    throw new MealBuilderError("sections must be an array", "MEAL_BUILDER_INVALID_SECTIONS");
  }
  const needsResolution = sections.some((section) => {
    const normalized = normalizeCanonicalSectionAliases(section);
    return normalized
      && typeof normalized === "object"
      && (normalized.source || normalized.type)
      && (!normalized.productContextId || (!normalized.sourceGroupId && normalized.sectionType === "option_group") || (!normalized.sourceCategoryId && normalized.sectionType === "product_category"));
  });
  if (!needsResolution) return promoteCanonicalFamilySelections(normalizeSections(sections));

  const [basicMeal, proteinsGroup, carbsGroup, sandwichCategory] = await Promise.all([
    MenuProduct.findOne({ key: "basic_meal" }).lean(),
    MenuOptionGroup.findOne({ key: "proteins" }).lean(),
    MenuOptionGroup.findOne({ key: "carbs" }).lean(),
    MenuCategory.findOne({ key: "cold_sandwiches" }).lean(),
  ]);

  return promoteCanonicalFamilySelections(normalizeSections(sections.map((section) => {
    const normalized = normalizeCanonicalSectionAliases(section);
    if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return normalized;
    const key = String(normalized.key || "").trim();
    const source = normalized.source && typeof normalized.source === "object" && !Array.isArray(normalized.source)
      ? normalized.source
      : {};
    const next = { ...normalized };
    if (["premium", "chicken", "beef", "fish", "eggs", "carbs"].includes(key) && !next.productContextId && basicMeal) {
      next.productContextId = basicMeal._id;
    }
    if (["premium", "chicken", "beef", "fish", "eggs"].includes(key) && !next.sourceGroupId && proteinsGroup) {
      next.sourceGroupId = proteinsGroup._id;
    }
    if ((key === "carbs" || source.groupKey === "carbs") && !next.sourceGroupId && carbsGroup) {
      next.sourceGroupId = carbsGroup._id;
    }
    if (key === "sandwich" && !next.sourceCategoryId && sandwichCategory) {
      next.sourceCategoryId = sandwichCategory._id;
    }
    return next;
  })));
}

async function promoteCanonicalFamilySelections(sections = []) {
  const visualFamilySections = sections.filter(isVisualProteinFamilySection);
  if (!visualFamilySections.length) return sections;

  const [basicMeal, proteinsGroup] = await Promise.all([
    MenuProduct.findOne({ key: "basic_meal" }).lean(),
    MenuOptionGroup.findOne({ key: "proteins" }).lean(),
  ]);
  if (!proteinsGroup) return sections;

  const productIds = [...new Set(visualFamilySections
    .map((section) => String(section.productContextId || basicMeal?._id || ""))
    .filter(Boolean))];
  const relationRows = productIds.length
    ? await ProductGroupOption.find({ productId: { $in: productIds }, groupId: proteinsGroup._id }).lean()
    : [];
  const relationByProductOptionId = new Map(relationRows.map((row) => [`${String(row.productId)}:${String(row.optionId)}`, row]));

  const familyOptionsByKey = new Map();
  await Promise.all([...new Set(visualFamilySections.map((section) => section.key))].map(async (familyKey) => {
    const familySource = buildOptionFamilyPickerSource(familyKey, { key: familyKey });
    const candidates = await MenuOption.find(optionFamilyCandidateQuery({ group: proteinsGroup, ...familySource })).sort({ sortOrder: 1, createdAt: -1 }).lean();
    const catalogItemsById = await loadCatalogItemsByIdForDocs(candidates);
    familyOptionsByKey.set(
      familyKey,
      candidates
        .filter((option) => isCanonicalStandardProteinForPicker(option, familyKey))
        .filter((option) => readyDocForSeed(option, catalogItemsById))
    );
  }));

  return sections.map((section) => {
    if (!isVisualProteinFamilySection(section)) return section;
    const productId = String(section.productContextId || basicMeal?._id || "");
    const familyOptions = (familyOptionsByKey.get(section.key) || [])
      .sort((a, b) => {
        const relationByOptionId = new Map([
          [String(a._id), relationByProductOptionId.get(`${productId}:${String(a._id)}`)],
          [String(b._id), relationByProductOptionId.get(`${productId}:${String(b._id)}`)],
        ]);
        return optionSort(a, b, relationByOptionId);
      });
    const selectedIds = new Set((section.selectedOptionIds || []).map(String));
    for (const option of familyOptions) selectedIds.add(String(option._id));
    return {
      ...section,
      selectedOptionIds: [...selectedIds],
    };
  });
}

function normalizeCanonicalSectionAliases(section = {}) {
  if (!section || typeof section !== "object" || Array.isArray(section)) return section;
  const key = String(section.key || section.sectionKey || "").trim();
  const type = String(section.type || "").trim();
  const source = section.source && typeof section.source === "object" && !Array.isArray(section.source)
    ? section.source
    : {};
  const sourceKind = String(source.kind || "").trim();
  const normalized = { ...section, key };

  if (!normalized.sectionType && type) {
    if (type === "mixed" && key === "premium") normalized.sectionType = "option_group";
    else if (type === "option_family" || type === "option_group") normalized.sectionType = "option_group";
    else if (type === "product_list") normalized.sectionType = key === "sandwich" ? "product_category" : "product_list";
  }

  if (!normalized.sourceKind && sourceKind) {
    if (sourceKind === "premium_mixed") normalized.sourceKind = "premium_visual";
    else if (sourceKind === "option_family") normalized.sourceKind = "visual_family";
    else if (sourceKind === "option_group") normalized.sourceKind = "visual_family";
    else if (sourceKind === "product_category" || sourceKind === "product_list") normalized.sourceKind = "product_list";
  }

  if (normalized.sortOrder === undefined && CANONICAL_SECTION_SORT_ORDER[key]) {
    normalized.sortOrder = CANONICAL_SECTION_SORT_ORDER[key];
  }
  if (source.displayCategoryKey && !normalized.metadata?.proteinFamilyKey && VISUAL_PROTEIN_FAMILY_KEYS.has(key)) {
    normalized.metadata = { ...(normalized.metadata || {}), proteinFamilyKey: source.displayCategoryKey };
  }
  if (key === "carbs") {
    normalized.rules = {
      ...STANDARD_CARB_RULES,
      onlyForSelectionTypes: [MEAL_SELECTION_TYPES.STANDARD_MEAL, MEAL_SELECTION_TYPES.PREMIUM_MEAL],
      ...(normalized.rules || {}),
    };
  }

  return normalized;
}

function truthy(doc) {
  return doc && doc.isActive !== false && doc.isVisible !== false && doc.isAvailable !== false && doc.publishedAt;
}

function subscriptionEnabled(doc) {
  if (!doc) return false;
  if (doc.availableForSubscription === false) return false;
  if (!Array.isArray(doc.availableFor) || doc.availableFor.length === 0) return true;
  return doc.availableFor.includes("subscription");
}

function optionIdentity(option = {}) {
  return String(option.key || option.premiumKey || "").trim().toLowerCase();
}

function isPremiumProtein(option = {}) {
  const key = optionIdentity(option);
  const premiumKey = String(option.premiumKey || "").trim().toLowerCase();
  return PREMIUM_PROTEIN_KEYS.has(key) || PREMIUM_PROTEIN_KEYS.has(premiumKey);
}

function isSaladAllowedProtein(option = {}) {
  return SALAD_ALLOWED_PROTEIN_KEYS.has(optionIdentity(option));
}

function stableHash(payload) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function baseConfigPayload(config) {
  return {
    contractVersion: CONTRACT_VERSION,
    sections: normalizeSections(config.sections || []).map((section) => ({
      sectionType: section.sectionType,
      key: section.key || "",
      sourceKind: section.sourceKind || "",
      titleOverride: section.titleOverride || {},
      productContextId: section.productContextId ? String(section.productContextId) : null,
      sourceGroupId: section.sourceGroupId ? String(section.sourceGroupId) : null,
      sourceCategoryId: section.sourceCategoryId ? String(section.sourceCategoryId) : null,
      selectedOptionIds: (section.selectedOptionIds || []).map(String).sort(),
      selectedProductIds: (section.selectedProductIds || []).map(String).sort(),
      includeMode: section.includeMode || "selected",
      selectionType: section.selectionType || "",
      sortOrder: Number(section.sortOrder || 0),
      required: Boolean(section.required),
      minSelections: Number(section.minSelections || 0),
      maxSelections: section.maxSelections === null || section.maxSelections === undefined ? null : Number(section.maxSelections),
      multiSelect: Boolean(section.multiSelect),
      visible: section.visible !== false,
      availableFor: section.availableFor || ["subscription"],
      metadata: plainObject(section.metadata),
      rules: plainObject(section.rules),
    })),
  };
}

function computeRevisionHash(config) {
  return stableHash(baseConfigPayload(config));
}

function canonicalSectionType(section = {}) {
  const key = String(section.key || "").trim();
  return CANONICAL_SECTION_TYPE[key] || (
    section.sectionType === "product_category" || section.sectionType === "product_list"
      ? "product_list"
      : "option_group"
  );
}

function canonicalSectionSource(section = {}) {
  const key = String(section.key || "").trim();
  if (key === "premium") return { kind: "premium_mixed" };
  if (key === "sandwich") {
    return {
      kind: "product_category",
      categoryKey: "sandwich",
      legacyCategoryKey: "cold_sandwiches",
    };
  }
  if (VISUAL_PROTEIN_FAMILY_KEYS.has(key)) {
    return {
      kind: "option_family",
      groupKey: "proteins",
      displayCategoryKey: key,
    };
  }
  if (key === "carbs") return { kind: "option_group", groupKey: "carbs" };
  if (section.sectionType === "product_category") return { kind: "product_category" };
  if (section.sectionType === "product_list") return { kind: "product_list" };
  return { kind: "option_group" };
}

function canonicalSectionRules(section = {}) {
  if (section.key === "carbs") {
    return {
      ...STANDARD_CARB_RULES,
      onlyForSelectionTypes: [MEAL_SELECTION_TYPES.STANDARD_MEAL, MEAL_SELECTION_TYPES.PREMIUM_MEAL],
      ...plainObject(section.rules),
    };
  }
  return sectionRules(section);
}

function canonicalSectionKeys(sections = []) {
  return sections.map((section) => String(section.key || "").trim());
}

function looksLikeLegacyFiveSectionDraft(sections = []) {
  if (!Array.isArray(sections) || sections.length !== 5) return false;
  const keys = canonicalSectionKeys(sections);
  if (keys.some(Boolean)) return false;
  const titles = sections.map((section) => String(section.titleOverride?.en || section.title?.en || "").trim().toLowerCase());
  return [
    "standard proteins",
    "carbs",
    "premium proteins",
    "sandwiches",
    "premium large salad",
  ].every((title) => titles.includes(title));
}

function addLegacyVisualDraftShapeIssues(sections, errors) {
  if (!looksLikeLegacyFiveSectionDraft(sections)) return;
  addCheck(
    errors,
    "error",
    "MEAL_BUILDER_LEGACY_VISUAL_TEMPLATE",
    "Legacy 5-section Meal Builder draft must be migrated to the canonical v3 visual template",
    {
      expectedSectionKeys: VISUAL_TEMPLATE_ORDER,
      actualSectionCount: sections.length,
    }
  );
}

async function migrateLegacyDraftToCanonicalTemplate(draft) {
  const sections = normalizeSections(draft?.sections || []);
  if (!looksLikeLegacyFiveSectionDraft(sections)) {
    return { draft, migrated: false, warnings: [] };
  }

  const canonicalSections = await buildDefaultVisualTemplateSections();
  const updated = await MealBuilderConfig.findOneAndUpdate(
    { _id: draft._id, status: "draft", isCurrent: true },
    {
      $set: {
        sections: canonicalSections,
        contractVersion: CONTRACT_VERSION,
        source: draft.source || "dashboard",
        notes: draft.notes || "",
      },
    },
    { new: true }
  ).lean();

  return {
    draft: updated || { ...draft, sections: canonicalSections },
    migrated: true,
    warnings: [
      statusIssue(
        "warning",
        "MEAL_BUILDER_LEGACY_DRAFT_MIGRATED",
        "Legacy 5-section Meal Builder draft was migrated to the canonical v3 visual template.",
        { previousSectionCount: sections.length, sectionKeys: VISUAL_TEMPLATE_ORDER }
      ),
    ],
  };
}

function serializeSection(section = {}) {
  return {
    id: section._id ? String(section._id) : undefined,
    key: section.key || "",
    type: canonicalSectionType(section),
    source: canonicalSectionSource(section),
    sortOrder: Number(section.sortOrder || 0),
    titleOverride: section.titleOverride || {},
    selectionType: section.selectionType || "",
    required: Boolean(section.required),
    minSelections: Number(section.minSelections || 0),
    maxSelections: section.maxSelections === null || section.maxSelections === undefined ? null : Number(section.maxSelections),
    multiSelect: Boolean(section.multiSelect),
    visible: section.visible !== false,
    availableFor: section.availableFor || ["subscription"],
    metadata: plainObject(section.metadata),
    rules: canonicalSectionRules(section),
    selectedOptionIds: (section.selectedOptionIds || []).map(String),
    selectedProductIds: (section.selectedProductIds || []).map(String),
    // Deprecated internal fields kept read-only for existing Dashboard/tests.
    sectionType: section.sectionType,
    sourceKind: section.sourceKind || "",
    productContextId: section.productContextId ? String(section.productContextId) : null,
    sourceGroupId: section.sourceGroupId ? String(section.sourceGroupId) : null,
    sourceCategoryId: section.sourceCategoryId ? String(section.sourceCategoryId) : null,
    includeMode: section.includeMode || "selected",
  };
}

async function getCurrentPublishedConfig({ lean = true, session = null, allowVirtualFallback = false } = {}) {
  const query = MealBuilderConfig.findOne({ status: "published", isCurrent: true }).sort({ publishedAt: -1, updatedAt: -1 });
  if (session) query.session(session);
  const result = await (lean ? query.lean() : query);
  if (!result && allowVirtualFallback) {
    const basicMeal = await MenuProduct.findOne({ key: "basic_meal" }).lean();
    if (basicMeal) {
      const sections = await buildDefaultVisualTemplateSections();
      const virtualConfig = {
        _id: new mongoose.Types.ObjectId("600000000000000000000001"),
        status: "published",
        isCurrent: true,
        contractVersion: CONTRACT_VERSION,
        revisionHash: "virtual_canonical_hash",
        source: "system",
        createdBySystem: true,
        publishedAt: new Date("2026-06-18T12:00:00.000Z"),
        sections,
        notes: "Virtual canonical fallback config",
        createdAt: new Date("2026-06-18T12:00:00.000Z"),
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      };
      if (!lean) {
        return new MealBuilderConfig(virtualConfig);
      }
      return virtualConfig;
    }
  }
  return result;
}

async function getCurrentDraftConfig() {
  return MealBuilderConfig.findOne({ status: "draft", isCurrent: true }).sort({ updatedAt: -1 }).lean();
}

async function getDashboardState({ lang = "en" } = {}) {
  const [draft, published] = await Promise.all([
    getCurrentDraftConfig(),
    getCurrentPublishedConfig({ allowVirtualFallback: true }),
  ]);
  const [draftValidation, publishedValidation] = await Promise.all([
    draft ? validateConfigObject(draft) : null,
    published ? validateConfigObject(published) : null,
  ]);

  let serializedPublished = published ? serializeConfig(published) : null;
  if (serializedPublished && published.source === "system") {
    serializedPublished.createdBySystem = false;
    serializedPublished.source = "bootstrap";
  }

  let plannerCatalog = null;
  if (published) {
    try {
      plannerCatalog = await buildPlannerCatalogFromPublishedBuilder({ lang, config: published });
    } catch (err) {
      // ignore
    }
  }
  if (!plannerCatalog || !plannerCatalog.sections || !plannerCatalog.sections.length) {
    const { getSubscriptionBuilderCatalogWithV2 } = require("../catalog/CatalogService");
    const canonical = await getSubscriptionBuilderCatalogWithV2({ lang, includeV3: true }).catch(() => null);
    if (canonical && canonical.plannerCatalog) {
      plannerCatalog = canonical.plannerCatalog;
    }
  }

  return {
    draft: draft ? serializeConfig(draft) : null,
    published: serializedPublished,
    preview: published ? publicContract(await buildPublishedContract({ config: published, lang, includeUnavailable: true })) : null,
    plannerCatalog: plannerCatalog || { sections: [] },
    validation: {
      draft: draftValidation,
      published: publishedValidation,
    },
  };
}

function publicContract(contract = {}) {
  const { membership: _membership, ...payload } = contract;
  return payload;
}

function serializeConfig(config) {
  return {
    id: String(config._id),
    status: config.status,
    isCurrent: config.isCurrent === true,
    contractVersion: config.contractVersion || CONTRACT_VERSION,
    revisionHash: config.revisionHash || "",
    source: config.source || "dashboard",
    createdBySystem: config.createdBySystem === true,
    bootstrapKey: config.bootstrapKey || "",
    publishedAt: config.publishedAt || null,
    publishedBy: config.publishedBy ? String(config.publishedBy) : null,
    notes: config.notes || "",
    sections: normalizeSections(config.sections || []).map(serializeSection),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

function normalizeQueryBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizePagination({ page, limit } = {}) {
  const normalizedPage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const normalizedLimit = Math.min(100, Math.max(1, Number.parseInt(limit || "50", 10) || 50));
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
}

function matchesSearch(row = {}, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.key,
    row.name?.en,
    row.name?.ar,
    row.description?.en,
    row.description?.ar,
  ].map((value) => String(value || "").toLowerCase());
  return haystack.some((value) => value.includes(q));
}

function statusIssue(level, code, message, details = {}) {
  return { level, code, message, ...details };
}

function catalogItemAvailable(doc, catalogItemsById) {
  return isLinkedDocGloballyAvailable(doc, catalogItemsById);
}

function baseDocStatus(doc, catalogItemsById, prefix, label) {
  const active = doc ? doc.isActive !== false : false;
  const visible = doc ? doc.isVisible !== false : false;
  const available = doc ? doc.isAvailable !== false : false;
  const published = doc ? Boolean(doc.publishedAt) : false;
  const subEnabled = subscriptionEnabled(doc);
  const catalogAvailable = doc ? catalogItemAvailable(doc, catalogItemsById) : false;
  const reasonCodes = [];
  const errors = [];

  if (!doc) {
    reasonCodes.push(`${prefix}_MISSING`);
    errors.push(statusIssue("error", `${prefix}_MISSING`, `${label} is missing`));
  } else {
    if (!active) {
      reasonCodes.push(`${prefix}_INACTIVE`);
      errors.push(statusIssue("error", `${prefix}_INACTIVE`, `${label} is inactive`));
    }
    if (!visible) {
      reasonCodes.push(`${prefix}_HIDDEN`);
      errors.push(statusIssue("error", `${prefix}_HIDDEN`, `${label} is hidden`));
    }
    if (!available) {
      reasonCodes.push(`${prefix}_UNAVAILABLE`);
      errors.push(statusIssue("error", `${prefix}_UNAVAILABLE`, `${label} is unavailable`));
    }
    if (!published) {
      reasonCodes.push(`${prefix}_UNPUBLISHED`);
      errors.push(statusIssue("error", `${prefix}_UNPUBLISHED`, `${label} is unpublished`));
    }
    if (!subEnabled) {
      reasonCodes.push(`${prefix}_NOT_SUBSCRIPTION_ENABLED`);
      errors.push(statusIssue("error", `${prefix}_NOT_SUBSCRIPTION_ENABLED`, `${label} is not subscription-enabled`));
    }
    if (!catalogAvailable) {
      reasonCodes.push("CATALOG_ITEM_UNAVAILABLE");
      errors.push(statusIssue("error", "CATALOG_ITEM_UNAVAILABLE", `${label} CatalogItem is unavailable`));
    }
  }

  return {
    active,
    visible,
    available,
    published,
    subscriptionEnabled: subEnabled,
    catalogItemAvailable: catalogAvailable,
    reasonCodes,
    errors,
  };
}

function relationMapKey(productId, groupId, optionId = null) {
  return optionId
    ? `${String(productId)}:${String(groupId)}:${String(optionId)}`
    : `${String(productId)}:${String(groupId)}`;
}

function buildRelationIndexes(docs) {
  return {
    groupRelationByProductGroup: new Map(
      (docs.groupRelations || []).map((row) => [relationMapKey(row.productId, row.groupId), row])
    ),
    optionRelationByProductGroupOption: new Map(
      (docs.optionRelations || []).map((row) => [relationMapKey(row.productId, row.groupId, row.optionId), row])
    ),
  };
}

function relationStatus({
  groupRelation = null,
  optionRelation = null,
  selected = false,
  includeOptionRelation = true,
} = {}) {
  const warnings = [];
  const errors = [];
  const reasonCodes = [];
  const groupRelationExists = Boolean(groupRelation);
  const relationExists = includeOptionRelation ? Boolean(optionRelation) : groupRelationExists;
  const groupRelationReady = relationReady(groupRelation);
  const optionRelationReady = includeOptionRelation ? relationReady(optionRelation) : true;
  const linked = groupRelationExists && relationExists;

  if (!groupRelationExists) {
    const issue = statusIssue(selected ? "error" : "warning", "PRODUCT_GROUP_RELATION_MISSING", "Product option-group relation is missing");
    reasonCodes.push("PRODUCT_GROUP_RELATION_MISSING");
    (selected ? errors : warnings).push(issue);
  } else if (!groupRelationReady) {
    reasonCodes.push("PRODUCT_GROUP_RELATION_UNAVAILABLE");
    errors.push(statusIssue("error", "PRODUCT_GROUP_RELATION_UNAVAILABLE", "Product option-group relation is unavailable"));
  }

  if (includeOptionRelation) {
    if (!optionRelation) {
      const issue = statusIssue(selected ? "error" : "warning", "NOT_LINKED_TO_PRODUCT_GROUP", "Option exists but is not linked to the product option group");
      reasonCodes.push("NOT_LINKED_TO_PRODUCT_GROUP");
      (selected ? errors : warnings).push(issue);
    } else if (!optionRelationReady) {
      reasonCodes.push("PRODUCT_OPTION_RELATION_UNAVAILABLE");
      errors.push(statusIssue("error", "PRODUCT_OPTION_RELATION_UNAVAILABLE", "Product option relation is unavailable"));
    }
  }

  return {
    linked,
    relationExists,
    groupRelationExists,
    groupRelationReady,
    relationReady: groupRelationReady && optionRelationReady,
    reasonCodes,
    warnings,
    errors,
  };
}

function optionFamilyKey(option = {}) {
  return resolveProteinVisualFamilyKey(option) || String(option.proteinFamilyKey || option.displayCategoryKey || "").trim().toLowerCase();
}

function serializeHydratedOption({
  option,
  section,
  docs,
  groupRelation,
  optionRelation,
  selected = false,
  required = false,
  expectedFamilyKey = "",
  requirePremium = false,
  excludePremium = false,
  requirePositivePremiumPrice = false,
  requireCustomerVisibleCarb = false,
  allowUnlinkedCandidate = false,
  allowUnpublishedCandidate = false,
  allowSelectedUnlinkedOptionRelation = false,
} = {}) {
  if (!option) {
    const errors = [statusIssue("error", "MISSING_OPTION", "Selected option no longer exists")];
    return {
      id: null,
      optionId: null,
      type: "missing_option",
      selected,
      required,
      eligible: false,
      linked: false,
      available: false,
      active: false,
      visible: false,
      published: false,
      subscriptionEnabled: false,
      relationExists: false,
      catalogItemAvailable: false,
      reasonCodes: ["MISSING_OPTION"],
      warnings: [],
      errors,
      state: selected ? "selected" : "invalid",
    };
  }

  const docStatus = baseDocStatus(option, docs.catalogItemsById, "OPTION", "Option");
  const relStatus = relationStatus({ groupRelation, optionRelation, selected, includeOptionRelation: true });
  const reasonCodes = [...docStatus.reasonCodes, ...relStatus.reasonCodes];
  const selectedSectionInclusion = allowSelectedUnlinkedOptionRelation && selected && relStatus.groupRelationReady;
  const warnings = selectedSectionInclusion
    ? [...relStatus.warnings, ...relStatus.errors.map((error) => ({ ...error, level: "warning" }))]
    : [...relStatus.warnings];
  const errors = selectedSectionInclusion
    ? [...docStatus.errors]
    : [...docStatus.errors, ...relStatus.errors];
  const familyKey = optionFamilyKey(option);
  const optionIsPremium = isPremiumProtein(option);

  if (expectedFamilyKey && familyKey !== expectedFamilyKey) {
    reasonCodes.push("WRONG_VISUAL_FAMILY");
    errors.push(statusIssue("error", "WRONG_VISUAL_FAMILY", "Option does not belong to this visual family"));
  }
  if (requirePremium && !optionIsPremium) {
    reasonCodes.push("PREMIUM_KEY_MISSING");
    errors.push(statusIssue("error", "PREMIUM_KEY_MISSING", "Premium section requires a premium option"));
  }
  if (excludePremium && optionIsPremium) {
    reasonCodes.push("PREMIUM_KEY_MISSING");
    errors.push(statusIssue("error", "PREMIUM_KEY_MISSING", "Standard protein section cannot expose premium options"));
  }
  if (required && !selected) {
    reasonCodes.push("PREMIUM_REQUIRED_KEY");
    warnings.push(statusIssue("warning", "PREMIUM_REQUIRED_KEY", "Premium option is required"));
  }
  if (requireCustomerVisibleCarb && !CUSTOMER_VISIBLE_CARB_KEYS.includes(optionKey(option))) {
    reasonCodes.push("CARB_NOT_CUSTOMER_VISIBLE");
    errors.push(statusIssue("error", "CARB_NOT_CUSTOMER_VISIBLE", "Carb option is not customer-visible"));
  }

  const available = docStatus.active
    && docStatus.visible
    && docStatus.available
    && (docStatus.published || (allowUnpublishedCandidate && !selected))
    && docStatus.subscriptionEnabled
    && docStatus.catalogItemAvailable;
  const errorsForEligibility = allowUnpublishedCandidate && !selected
    ? errors.filter((error) => error.code !== "OPTION_UNPUBLISHED")
    : errors;
  const addableUnlinkedCandidate = allowUnlinkedCandidate
    && !selected
    && available
    && !relStatus.relationReady
    && errorsForEligibility.length === 0;
  const eligible = available && errorsForEligibility.length === 0 && (relStatus.relationReady || addableUnlinkedCandidate || selectedSectionInclusion);
  if (selected) reasonCodes.unshift("SELECTED");
  if (eligible) reasonCodes.push("ELIGIBLE");

  let state = "invalid";
  if (selected) state = "selected";
  else if (!available) state = "unavailable";
  else if (addableUnlinkedCandidate) state = "addable";
  else if (!relStatus.linked) state = "not_linked";
  else if (eligible) state = "eligible";

  return {
    id: String(option._id),
    optionId: String(option._id),
    type: "option",
    key: option.key || "",
    name: option.name || { ar: "", en: "" },
    label: pickLang(option.name || {}, section?.lang || "en"),
    familyKey,
    premiumKey: option.premiumKey || "",
    displayCategoryKey: option.displayCategoryKey || "",
    selectionType: option.selectionType || section?.selectionType || "",
    pricing: {
      extraPriceHalala: Number(optionRelation?.extraPriceHalala ?? option.extraPriceHalala ?? 0),
      extraWeightUnitGrams: Number(optionRelation?.extraWeightUnitGrams ?? option.extraWeightUnitGrams ?? 0),
      extraWeightPriceHalala: Number(optionRelation?.extraWeightPriceHalala ?? option.extraWeightPriceHalala ?? 0),
      currency: option.currency || SYSTEM_CURRENCY,
    },
    relation: optionRelation ? {
      id: String(optionRelation._id),
      productId: String(optionRelation.productId),
      groupId: String(optionRelation.groupId),
      optionId: String(optionRelation.optionId),
      sortOrder: Number(optionRelation.sortOrder || 0),
      isActive: optionRelation.isActive !== false,
      isVisible: optionRelation.isVisible !== false,
      isAvailable: optionRelation.isAvailable !== false,
    } : null,
    selected,
    required,
    eligible,
    linked: relStatus.linked,
    available,
    active: docStatus.active,
    visible: docStatus.visible,
    published: docStatus.published,
    subscriptionEnabled: docStatus.subscriptionEnabled,
    relationExists: relStatus.relationExists,
    included: selected,
    includedVia: selectedSectionInclusion && !relStatus.relationReady ? "section_selection" : "product_option_relation",
    catalogItemAvailable: docStatus.catalogItemAvailable,
    reasonCodes: [...new Set(reasonCodes)],
    warnings,
    errors,
    state,
  };
}

function serializeHydratedProduct({
  product,
  section,
  docs,
  selected = false,
  required = false,
  category = null,
  selectionType = "",
  requireSandwich = false,
  requirePremiumLargeSalad = false,
  validateRelations = false,
} = {}) {
  if (!product) {
    const errors = [statusIssue("error", "MISSING_PRODUCT", "Selected product no longer exists")];
    return {
      id: null,
      productId: null,
      type: "missing_product",
      selected,
      required,
      eligible: false,
      linked: false,
      available: false,
      active: false,
      visible: false,
      published: false,
      subscriptionEnabled: false,
      relationExists: false,
      catalogItemAvailable: false,
      reasonCodes: ["MISSING_PRODUCT"],
      warnings: [],
      errors,
      state: selected ? "selected" : "invalid",
    };
  }

  const docStatus = baseDocStatus(product, docs.catalogItemsById, "PRODUCT", "Product");
  const reasonCodes = [...docStatus.reasonCodes];
  const warnings = [];
  const errors = [...docStatus.errors];
  const categoryKey = String(category?.key || "").trim().toLowerCase();

  if (requireSandwich) {
    if (categoryKey && categoryKey !== "cold_sandwiches") {
      reasonCodes.push("SANDWICH_CATEGORY_MISMATCH");
      errors.push(statusIssue("error", "SANDWICH_CATEGORY_MISMATCH", "Sandwich product must belong to the cold_sandwiches category"));
    }
    if (String(product.itemType || "") !== "cold_sandwich") {
      reasonCodes.push("SANDWICH_ITEM_TYPE_MISMATCH");
      errors.push(statusIssue("error", "SANDWICH_ITEM_TYPE_MISMATCH", "Sandwich product must use itemType=cold_sandwich"));
    }
  }
  if (requirePremiumLargeSalad && product.key !== "premium_large_salad") {
    reasonCodes.push("PREMIUM_LARGE_SALAD_MISSING");
    errors.push(statusIssue("error", "PREMIUM_LARGE_SALAD_MISSING", "Premium product must be premium_large_salad"));
  }
  if (validateRelations) {
    const relationErrors = [];
    const optionRelationByProductGroupOption = new Map(
      (docs.optionRelations || []).map((row) => [relationMapKey(row.productId, row.groupId, row.optionId), row])
    );
    validatePremiumLargeSaladProductRelations(product, docs, optionRelationByProductGroupOption, relationErrors);
    if (relationErrors.length) {
      reasonCodes.push("PREMIUM_LARGE_SALAD_INVALID_RELATIONS");
      errors.push(...relationErrors.map((error) => ({
        ...error,
        code: error.code || "PREMIUM_LARGE_SALAD_INVALID_RELATIONS",
      })));
    }
  }

  const available = docStatus.active
    && docStatus.visible
    && docStatus.available
    && docStatus.published
    && docStatus.subscriptionEnabled
    && docStatus.catalogItemAvailable;
  const eligible = available && errors.length === 0;
  if (selected) reasonCodes.unshift("SELECTED");
  if (eligible) reasonCodes.push("ELIGIBLE");

  let state = "invalid";
  if (selected) state = "selected";
  else if (!available) state = "unavailable";
  else if (eligible) state = "eligible";

  return {
    id: String(product._id),
    productId: String(product._id),
    type: "product",
    key: product.key || "",
    name: product.name || { ar: "", en: "" },
    label: pickLang(product.name || {}, section?.lang || "en"),
    itemType: product.itemType || "",
    categoryId: product.categoryId ? String(product.categoryId) : null,
    categoryKey,
    selectionType: selectionType || productSelectionType(section || {}, product),
    configurable: product.isCustomizable === true || product.key === "premium_large_salad",
    pricing: {
      pricingModel: product.pricingModel || "fixed",
      priceHalala: Number(product.priceHalala || 0),
      currency: product.currency || SYSTEM_CURRENCY,
    },
    selected,
    required,
    eligible,
    linked: true,
    available,
    active: docStatus.active,
    visible: docStatus.visible,
    published: docStatus.published,
    subscriptionEnabled: docStatus.subscriptionEnabled,
    relationExists: true,
    catalogItemAvailable: docStatus.catalogItemAvailable,
    reasonCodes: [...new Set(reasonCodes)],
    warnings,
    errors,
    state,
  };
}

function sectionRules(section) {
  if (section?.key === "carbs") return { ...STANDARD_CARB_RULES };
  return plainObject(section?.rules);
}

function shouldIncludeCandidate(candidate, { includeUnavailable = false, includeNotLinked = true } = {}) {
  if (candidate.selected) return true;
  if (!includeUnavailable && candidate.state === "unavailable") return false;
  if (!includeNotLinked && candidate.state === "not_linked") return false;
  if (candidate.state === "invalid") return false;
  return true;
}

function shouldDebugPicker() {
  return ["test", "development"].includes(String(process.env.NODE_ENV || "").trim().toLowerCase());
}

function debugPicker(stage, payload = {}) {
  if (!shouldDebugPicker()) return;
  console.debug("[meal-builder-picker]", stage, JSON.stringify(payload));
}

function runtimeCommitInfo() {
  return {
    marker: MEAL_BUILDER_PICKER_DIAGNOSTIC_MARKER,
    expectedBaseCommit: MEAL_BUILDER_PICKER_BASE_COMMIT,
    renderGitCommit: process.env.RENDER_GIT_COMMIT || "",
    renderServiceId: process.env.RENDER_SERVICE_ID || "",
    sourceVersion: process.env.SOURCE_VERSION || process.env.COMMIT_SHA || process.env.GIT_COMMIT || "",
  };
}

function isCanonicalStandardProteinForPicker(option = {}, sectionKey = "") {
  const key = optionKey(option);
  if (!key || NON_PROTEIN_PICKER_OPTION_KEYS.has(key) || key.startsWith("extra_")) return false;
  if (isPremiumProtein(option)) return false;
  return optionFamilyKey(option) === sectionKey;
}

function standardProteinKeysForFamily(sectionKey = "") {
  return STANDARD_MEAL_EXTENDED_PROTEIN_KEYS
    .filter((key) => !PREMIUM_PROTEIN_KEYS.has(key))
    .filter((key) => resolveProteinVisualFamilyKey({ key }) === sectionKey);
}

function buildOptionFamilyPickerSource(sectionKey, section = {}) {
  const sectionSource = canonicalSectionSource({ ...(section || {}), key: sectionKey });
  const displayCategoryKey = String(sectionSource.displayCategoryKey || sectionKey || "").trim().toLowerCase();
  const proteinFamilyKey = String(section?.metadata?.proteinFamilyKey || displayCategoryKey || sectionKey || "").trim().toLowerCase();
  const extendedFamilyKeys = standardProteinKeysForFamily(displayCategoryKey);
  return {
    sectionSource,
    proteinFamilyKey,
    displayCategoryKey,
    extendedFamilyKeys,
  };
}

function optionFamilyCandidateQuery({ group, proteinFamilyKey, displayCategoryKey, extendedFamilyKeys }) {
  const clauses = [];
  if (group?._id) clauses.push({ groupId: group._id });
  if (extendedFamilyKeys.length) clauses.push({ key: { $in: extendedFamilyKeys } });
  if (proteinFamilyKey) clauses.push({ proteinFamilyKey });
  if (displayCategoryKey) clauses.push({ displayCategoryKey });
  return clauses.length ? { $or: clauses } : {};
}

function isVisualProteinFamilySection(section = {}) {
  return VISUAL_PROTEIN_FAMILY_KEYS.has(String(section.key || "").trim());
}

function paginateRows(rows, pagination) {
  const total = rows.length;
  return {
    rows: rows.slice(pagination.skip, pagination.skip + pagination.limit),
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
    },
  };
}

async function getHydratedDraft({ lang = "en" } = {}) {
  const initialDraft = await getCurrentDraftConfig();
  const migration = await migrateLegacyDraftToCanonicalTemplate(initialDraft);
  const draft = migration.draft;
  if (!draft) {
    return {
      contractVersion: HYDRATED_DRAFT_VERSION,
      draft: null,
      ready: false,
      errors: [statusIssue("error", "MEAL_BUILDER_DRAFT_MISSING", "No current Meal Builder draft exists.")],
      warnings: [],
      sections: [],
    };
  }

  const serialized = serializeConfig(draft);
  const sections = normalizeSections(draft.sections || []);
  const [validation, docs] = await Promise.all([
    validateConfigObject(draft),
    resolveDocsForSections(sections),
  ]);
  const relationIndexes = buildRelationIndexes(docs);
  const hydratedSections = sections.map((section) => hydrateSection(section, docs, relationIndexes, lang));

  return {
    contractVersion: HYDRATED_DRAFT_VERSION,
    draft: {
      ...serialized,
      sections: hydratedSections,
    },
    ready: validation.ready,
    errors: validation.errors || [],
    warnings: [...(migration.warnings || []), ...(validation.warnings || [])],
    sections: hydratedSections,
    validation: {
      ...validation,
      warnings: [...(migration.warnings || []), ...(validation.warnings || [])],
      checks: [...(validation.errors || []), ...(migration.warnings || []), ...(validation.warnings || [])],
      summary: {
        ...(validation.summary || {}),
        migratedFromLegacyTemplate: migration.migrated === true,
      },
    },
  };
}

function hydrateSection(section, docs, relationIndexes, lang) {
  const sectionForLabel = { ...section, lang };
  const selectedOptionSet = new Set((section.selectedOptionIds || []).map(String));
  const selectedProductSet = new Set((section.selectedProductIds || []).map(String));
  const groupRelation = section.productContextId && section.sourceGroupId
    ? relationIndexes.groupRelationByProductGroup.get(relationMapKey(section.productContextId, section.sourceGroupId))
    : null;
  const hydratedOptions = (section.selectedOptionIds || []).map((optionId) => {
    const option = docs.optionsById.get(String(optionId));
    const optionRelation = section.productContextId && section.sourceGroupId
      ? relationIndexes.optionRelationByProductGroupOption.get(relationMapKey(section.productContextId, section.sourceGroupId, optionId))
      : null;
    const visualFamilySection = isVisualProteinFamilySection(section);
    return serializeHydratedOption({
      option,
      section: sectionForLabel,
      docs,
      groupRelation,
      optionRelation,
      selected: true,
      required: section.key === "premium" && option ? PREMIUM_MEAL_PROTEIN_KEYS.includes(optionKey(option)) : false,
      expectedFamilyKey: VISUAL_PROTEIN_FAMILY_KEYS.has(section.key) ? section.key : "",
      requirePremium: section.key === "premium",
      excludePremium: VISUAL_PROTEIN_FAMILY_KEYS.has(section.key),
      requirePositivePremiumPrice: section.key === "premium",
      requireCustomerVisibleCarb: section.key === "carbs",
      allowSelectedUnlinkedOptionRelation: visualFamilySection,
    });
  });

  let productIds = section.selectedProductIds || [];
  if (!productIds.length && section.sectionType !== "option_group") {
    productIds = resolveSectionProducts(section, docs).map((product) => String(product._id));
  }
  const category = section.sourceCategoryId ? docs.categoriesById.get(String(section.sourceCategoryId)) : null;
  const hydratedProducts = productIds.map((productId) => {
    const product = docs.productsById.get(String(productId));
    return serializeHydratedProduct({
      product,
      section: sectionForLabel,
      docs,
      selected: selectedProductSet.has(String(productId)) || section.includeMode === "all",
      required: section.key === "premium" && product?.key === "premium_large_salad",
      category,
      selectionType: productSelectionType(section, product),
      requireSandwich: section.key === "sandwich" || section.selectionType === MEAL_SELECTION_TYPES.SANDWICH,
      requirePremiumLargeSalad: section.key === "premium" && Boolean(product),
      validateRelations: section.key === "premium" && product?.key === "premium_large_salad",
    });
  });

  const items = [...hydratedOptions, ...hydratedProducts];
  return {
    ...serializeConfig({ _id: "000000000000000000000000", status: "draft", isCurrent: true, sections: [section] }).sections[0],
    rules: sectionRules(section),
    selectedOptions: hydratedOptions,
    selectedProducts: hydratedProducts,
    items,
    hydration: {
      selectedOptionCount: hydratedOptions.length,
      selectedProductCount: hydratedProducts.length,
      errorCount: items.reduce((sum, item) => sum + (item.errors || []).length, 0),
      warningCount: items.reduce((sum, item) => sum + (item.warnings || []).length, 0),
    },
  };
}

async function getSectionPicker({
  sectionKey,
  lang = "en",
  q = "",
  include,
  diagnostics,
  includeUnavailable,
  includeNotLinked,
  page,
  limit,
} = {}) {
  const key = String(sectionKey || "").trim().toLowerCase();
  if (!SUPPORTED_PICKER_SECTION_KEYS.has(key)) {
    throw new MealBuilderError("Unsupported Meal Builder picker section", "MEAL_BUILDER_PICKER_SECTION_INVALID", 400, { sectionKey });
  }

  const draft = await getCurrentDraftConfig();
  const sections = draft ? normalizeSections(draft.sections || []) : [];
  const section = sections.find((item) => item.key === key) || null;
  const context = await resolvePickerContext(key, section);
  const pagination = normalizePagination({ page, limit });
  const includeMode = String(include || "").trim().toLowerCase();
  const pickerOptions = {
    includeUnavailable: includeMode === "all" || normalizeQueryBoolean(includeUnavailable, false),
    includeNotLinked: includeMode === "all" || normalizeQueryBoolean(includeNotLinked, true),
  };

  let result;
  if (key === "sandwich") {
    result = await buildSandwichPicker({ sectionKey: key, section, context, lang, q, pagination, pickerOptions });
  } else if (key === "premium") {
    result = await buildPremiumPicker({ sectionKey: key, section, context, lang, q, pagination, pickerOptions });
  } else {
    result = await buildOptionPicker({ sectionKey: key, section, context, lang, q, pagination, pickerOptions });
  }

  const payload = {
    contractVersion: PICKER_VERSION,
    sectionKey: key,
    ...result,
  };
  if (normalizeQueryBoolean(diagnostics, false)) {
    payload.diagnostics = {
      runtime: runtimeCommitInfo(),
      pickerOptions,
      ...(result.diagnostics || {}),
    };
  }
  return payload;
}

async function resolvePickerContext(sectionKey, section = null) {
  const isSandwich = sectionKey === "sandwich";
  const needsCarbs = sectionKey === "carbs";
  const [basicMeal, proteinsGroup, carbsGroup, sandwichCategory] = await Promise.all([
    section?.productContextId ? MenuProduct.findById(section.productContextId).lean() : MenuProduct.findOne({ key: "basic_meal" }).lean(),
    section?.sourceGroupId && !needsCarbs && !isSandwich ? MenuOptionGroup.findById(section.sourceGroupId).lean() : MenuOptionGroup.findOne({ key: "proteins" }).lean(),
    section?.sourceGroupId && needsCarbs ? MenuOptionGroup.findById(section.sourceGroupId).lean() : MenuOptionGroup.findOne({ key: "carbs" }).lean(),
    section?.sourceCategoryId && isSandwich ? MenuCategory.findById(section.sourceCategoryId).lean() : MenuCategory.findOne({ key: "cold_sandwiches" }).lean(),
  ]);

  return {
    product: basicMeal,
    group: needsCarbs ? carbsGroup : proteinsGroup,
    category: sandwichCategory,
  };
}

async function buildPickerDocs({
  product = null,
  group = null,
  category = null,
  candidateOptions = [],
  candidateProducts = [],
  selectedOptionIds = [],
  selectedProductIds = [],
} = {}) {
  const selectedOptions = selectedOptionIds.length
    ? await MenuOption.find({ _id: { $in: selectedOptionIds } }).lean()
    : [];
  const selectedProducts = selectedProductIds.length
    ? await MenuProduct.find({ _id: { $in: selectedProductIds } }).lean()
    : [];
  const products = [product, ...candidateProducts, ...selectedProducts].filter(Boolean);
  const options = [...candidateOptions, ...selectedOptions].filter(Boolean);
  const productIds = products.map((row) => row._id);
  const [groupRelations, optionRelations] = await Promise.all([
    productIds.length ? ProductOptionGroup.find({ productId: { $in: productIds } }).lean() : [],
    productIds.length ? ProductGroupOption.find({ productId: { $in: productIds } }).lean() : [],
  ]);
  const relationOptionIds = optionRelations.map((row) => row.optionId);
  const relationGroupIds = optionRelations.map((row) => row.groupId);
  const [relationOptions, relationGroups] = await Promise.all([
    relationOptionIds.length ? MenuOption.find({ _id: { $in: relationOptionIds } }).lean() : [],
    relationGroupIds.length ? MenuOptionGroup.find({ _id: { $in: relationGroupIds } }).lean() : [],
  ]);
  const allProducts = [...products];
  const allOptions = [...options, ...relationOptions];
  const catalogItemsById = await loadCatalogItemsByIdForDocs(allProducts, allOptions);

  return {
    productsById: new Map(allProducts.map((row) => [String(row._id), row])),
    optionsById: new Map(allOptions.map((row) => [String(row._id), row])),
    groupsById: new Map([group, ...relationGroups].filter(Boolean).map((row) => [String(row._id), row])),
    categoriesById: new Map([category].filter(Boolean).map((row) => [String(row._id), row])),
    groupRelations,
    optionRelations,
    catalogItemsById,
  };
}

async function buildOptionPicker({ sectionKey, section, context, lang, q, pagination, pickerOptions }) {
  const selectedOptionIds = (section?.selectedOptionIds || []).map(String);
  const selectedSet = new Set(selectedOptionIds);
  const group = context.group;
  const product = context.product;
  const isOptionFamily = VISUAL_PROTEIN_FAMILY_KEYS.has(sectionKey);
  const familySource = isOptionFamily
    ? buildOptionFamilyPickerSource(sectionKey, section)
    : { sectionSource: canonicalSectionSource({ ...(section || {}), key: sectionKey }), proteinFamilyKey: "", displayCategoryKey: "", extendedFamilyKeys: [] };
  const query = group
    ? (
        isOptionFamily
          ? optionFamilyCandidateQuery({ group, ...familySource })
          : { groupId: group._id }
      )
    : (isOptionFamily ? optionFamilyCandidateQuery({ group, ...familySource }) : {});
  const candidateOptions = await MenuOption.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const discoveryDiagnostics = {
    codePath: isOptionFamily ? "option_family_catalog_discovery" : "option_group_discovery",
    source: familySource.sectionSource,
    proteinFamilyKey: familySource.proteinFamilyKey,
    displayCategoryKey: familySource.displayCategoryKey,
    extendedFamilyKeys: familySource.extendedFamilyKeys,
    selectedOptionIds,
    countBeforeRelationFilter: candidateOptions.length,
    candidateKeysBeforeRelationFilter: candidateOptions.map((option) => option.key),
  };
  debugPicker("option_discovery", {
    sectionKey,
    source: discoveryDiagnostics.source,
    candidateDiscoverySource: isOptionFamily ? "menu_option_family_catalog" : "menu_option_group",
    proteinFamilyKey: discoveryDiagnostics.proteinFamilyKey,
    displayCategoryKey: discoveryDiagnostics.displayCategoryKey,
    extendedFamilyKeys: discoveryDiagnostics.extendedFamilyKeys,
    selectedOptionIds,
    countBeforeRelationFilter: discoveryDiagnostics.countBeforeRelationFilter,
  });
  const docs = await buildPickerDocs({
    product,
    group,
    candidateOptions,
    selectedOptionIds,
  });
  const relationIndexes = buildRelationIndexes(docs);
  const groupRelation = product && group
    ? relationIndexes.groupRelationByProductGroup.get(relationMapKey(product._id, group._id))
    : null;
  const selectedOptionRows = selectedOptionIds
    .filter((id) => !candidateOptions.some((option) => String(option._id) === id))
    .map((id) => docs.optionsById.get(id))
    .filter(Boolean);
  const hydratedRows = [...candidateOptions, ...selectedOptionRows]
    .filter((option) => {
      if (!option) return false;
      if (selectedSet.has(String(option._id))) return true;
      if (sectionKey === "carbs") return CUSTOMER_VISIBLE_CARB_KEYS.includes(optionKey(option));
      return isCanonicalStandardProteinForPicker(option, sectionKey);
    })
    .filter((option) => matchesSearch(option, q))
    .map((option) => {
      const optionRelation = product && group
        ? relationIndexes.optionRelationByProductGroupOption.get(relationMapKey(product._id, group._id, option._id))
        : null;
      const selected = selectedSet.has(String(option._id));
      const relationCanBeAdded = (isOptionFamily || sectionKey === "carbs") && !selected;
      const pickerOptionRelation = relationCanBeAdded && optionRelation && !relationReady(optionRelation)
        ? null
        : optionRelation;
      const candidate = serializeHydratedOption({
        option,
        section: { ...(section || {}), key: sectionKey, lang },
        docs,
        groupRelation,
        optionRelation: pickerOptionRelation,
        selected,
        expectedFamilyKey: VISUAL_PROTEIN_FAMILY_KEYS.has(sectionKey) ? sectionKey : "",
        excludePremium: VISUAL_PROTEIN_FAMILY_KEYS.has(sectionKey),
        requireCustomerVisibleCarb: sectionKey === "carbs",
        allowUnlinkedCandidate: VISUAL_PROTEIN_FAMILY_KEYS.has(sectionKey) || sectionKey === "carbs",
        allowUnpublishedCandidate: VISUAL_PROTEIN_FAMILY_KEYS.has(sectionKey) || sectionKey === "carbs",
        allowSelectedUnlinkedOptionRelation: isOptionFamily,
      });
      if (isOptionFamily && !candidate.selected && candidate.eligible) {
        return { ...candidate, state: "addable" };
      }
      return candidate;
    });
  debugPicker("option_relation_overlay", {
    sectionKey,
    countAfterRelationFilter: hydratedRows.length,
    candidateKeysBeforeIncludeFilter: hydratedRows.map((candidate) => candidate.key),
  });
  const rows = hydratedRows
    .filter((candidate) => shouldIncludeCandidate(candidate, pickerOptions))
    .sort((a, b) => Number(a.relation?.sortOrder ?? 0) - Number(b.relation?.sortOrder ?? 0) || String(a.key).localeCompare(String(b.key)));

  const { rows: candidates, meta } = paginateRows(rows, pagination);
  debugPicker("option_final", {
    sectionKey,
    finalCandidateKeys: rows.map((candidate) => candidate.key),
    total: meta.total,
  });
  return {
    candidateType: "option",
    product: product ? { id: String(product._id), key: product.key || "", name: product.name || {} } : null,
    group: group ? { id: String(group._id), key: group.key || "", name: group.name || {} } : null,
    rules: sectionKey === "carbs" ? { ...STANDARD_CARB_RULES } : {},
    candidates,
    meta,
    diagnostics: {
      ...discoveryDiagnostics,
      countAfterFamilyFilter: hydratedRows.length,
      candidateKeysAfterFamilyFilter: hydratedRows.map((candidate) => candidate.key),
      finalCandidateKeys: rows.map((candidate) => candidate.key),
    },
  };
}

async function buildSandwichPicker({ sectionKey, section, context, lang, q, pagination, pickerOptions }) {
  const selectedProductIds = (section?.selectedProductIds || []).map(String);
  const selectedSet = new Set(selectedProductIds);
  const category = context.category;
  const candidateProducts = category
    ? await MenuProduct.find({ categoryId: category._id, itemType: "cold_sandwich" }).sort({ sortOrder: 1, createdAt: -1 }).lean()
    : [];
  const docs = await buildPickerDocs({
    category,
    candidateProducts,
    selectedProductIds,
  });
  const selectedProductRows = selectedProductIds
    .filter((id) => !candidateProducts.some((product) => String(product._id) === id))
    .map((id) => docs.productsById.get(id))
    .filter(Boolean);
  const rows = [...candidateProducts, ...selectedProductRows]
    .filter((product) => matchesSearch(product, q))
    .map((product) => serializeHydratedProduct({
      product,
      section: { ...(section || {}), key: sectionKey, lang },
      docs,
      selected: selectedSet.has(String(product._id)),
      category,
      selectionType: MEAL_SELECTION_TYPES.SANDWICH,
      requireSandwich: true,
    }))
    .filter((candidate) => shouldIncludeCandidate(candidate, pickerOptions))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));

  const { rows: candidates, meta } = paginateRows(rows, pagination);
  return {
    candidateType: "product",
    category: category ? { id: String(category._id), key: category.key || "", name: category.name || {} } : null,
    rules: { selectionType: MEAL_SELECTION_TYPES.SANDWICH },
    candidates,
    meta,
  };
}

async function buildPremiumPicker({ sectionKey, section, context, lang, q, pagination, pickerOptions }) {
  const selectedOptionIds = (section?.selectedOptionIds || []).map(String);
  const selectedProductIds = (section?.selectedProductIds || []).map(String);
  const selectedOptionSet = new Set(selectedOptionIds);
  const selectedProductSet = new Set(selectedProductIds);
  const product = context.product;
  const group = context.group;
  const premiumQuery = group
    ? {
        groupId: group._id,
        $or: [
          { key: { $in: PREMIUM_MEAL_PROTEIN_KEYS } },
          { premiumKey: { $in: PREMIUM_MEAL_PROTEIN_KEYS } },
        ],
      }
    : { key: { $in: PREMIUM_MEAL_PROTEIN_KEYS } };
  const [premiumOptions, saladProduct] = await Promise.all([
    MenuOption.find(premiumQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuProduct.findOne({ key: PREMIUM_LARGE_SALAD_PREMIUM_KEY }).lean(),
  ]);
  const docs = await buildPickerDocs({
    product,
    group,
    candidateOptions: premiumOptions,
    candidateProducts: saladProduct ? [saladProduct] : [],
    selectedOptionIds,
    selectedProductIds,
  });
  const relationIndexes = buildRelationIndexes(docs);
  const groupRelation = product && group
    ? relationIndexes.groupRelationByProductGroup.get(relationMapKey(product._id, group._id))
    : null;
  const optionRowsByKey = new Map(premiumOptions.map((option) => [optionKey(option), option]));
  const optionCandidates = [];

  for (const premiumKey of PREMIUM_MEAL_PROTEIN_KEYS) {
    const option = optionRowsByKey.get(premiumKey);
    if (!option) {
      optionCandidates.push({
        id: null,
        optionId: null,
        type: "missing_option",
        key: premiumKey,
        selected: false,
        required: true,
        eligible: false,
        linked: false,
        available: false,
        active: false,
        visible: false,
        published: false,
        subscriptionEnabled: false,
        relationExists: false,
        catalogItemAvailable: false,
        reasonCodes: ["MISSING_OPTION", "PREMIUM_REQUIRED_KEY"],
        warnings: [],
        errors: [
          statusIssue("error", "MISSING_OPTION", "Required premium option does not exist", { optionKey: premiumKey }),
          statusIssue("error", "PREMIUM_REQUIRED_KEY", "Premium option is required", { optionKey: premiumKey }),
        ],
        state: "invalid",
      });
      continue;
    }
    optionCandidates.push(serializeHydratedOption({
      option,
      section: { ...(section || {}), key: sectionKey, lang, selectionType: MEAL_SELECTION_TYPES.PREMIUM_MEAL },
      docs,
      groupRelation,
      optionRelation: product && group
        ? relationIndexes.optionRelationByProductGroupOption.get(relationMapKey(product._id, group._id, option._id))
        : null,
      selected: selectedOptionSet.has(String(option._id)),
      required: true,
      requirePremium: true,
      requirePositivePremiumPrice: true,
    }));
  }

  for (const selectedOptionId of selectedOptionIds) {
    if (optionCandidates.some((candidate) => candidate.optionId === selectedOptionId)) continue;
    const option = docs.optionsById.get(selectedOptionId);
    optionCandidates.push(serializeHydratedOption({
      option,
      section: { ...(section || {}), key: sectionKey, lang, selectionType: MEAL_SELECTION_TYPES.PREMIUM_MEAL },
      docs,
      groupRelation,
      optionRelation: product && group && option
        ? relationIndexes.optionRelationByProductGroupOption.get(relationMapKey(product._id, group._id, option._id))
        : null,
      selected: true,
      requirePremium: true,
      requirePositivePremiumPrice: true,
    }));
  }

  const productCandidates = [];
  if (saladProduct) {
    productCandidates.push(serializeHydratedProduct({
      product: saladProduct,
      section: { ...(section || {}), key: sectionKey, lang },
      docs,
      selected: selectedProductSet.has(String(saladProduct._id)),
      required: true,
      selectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
      requirePremiumLargeSalad: true,
      validateRelations: true,
    }));
  } else {
    productCandidates.push({
      id: null,
      productId: null,
      type: "missing_product",
      key: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
      selected: false,
      required: true,
      eligible: false,
      linked: false,
      available: false,
      active: false,
      visible: false,
      published: false,
      subscriptionEnabled: false,
      relationExists: false,
      catalogItemAvailable: false,
      reasonCodes: ["MISSING_PRODUCT", "PREMIUM_LARGE_SALAD_MISSING"],
      warnings: [],
      errors: [
        statusIssue("error", "MISSING_PRODUCT", "Premium large salad product does not exist"),
        statusIssue("error", "PREMIUM_LARGE_SALAD_MISSING", "Premium section requires premium_large_salad"),
      ],
      state: "invalid",
    });
  }

  for (const selectedProductId of selectedProductIds) {
    if (productCandidates.some((candidate) => candidate.productId === selectedProductId)) continue;
    const selectedProduct = docs.productsById.get(selectedProductId);
    productCandidates.push(serializeHydratedProduct({
      product: selectedProduct,
      section: { ...(section || {}), key: sectionKey, lang },
      docs,
      selected: true,
      selectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
      requirePremiumLargeSalad: true,
      validateRelations: selectedProduct?.key === "premium_large_salad",
    }));
  }

  const rows = [...optionCandidates, ...productCandidates]
    .filter((candidate) => matchesSearch(candidate, q))
    .filter((candidate) => candidate.required || shouldIncludeCandidate(candidate, pickerOptions))
    .sort((a, b) => {
      const aIndex = PREMIUM_MEAL_PROTEIN_KEYS.indexOf(a.key);
      const bIndex = PREMIUM_MEAL_PROTEIN_KEYS.indexOf(b.key);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || String(a.key).localeCompare(String(b.key));
    });

  const { rows: candidates, meta } = paginateRows(rows, pagination);
  return {
    candidateType: "mixed",
    product: product ? { id: String(product._id), key: product.key || "", name: product.name || {} } : null,
    group: group ? { id: String(group._id), key: group.key || "", name: group.name || {} } : null,
    rules: { selectionType: MEAL_SELECTION_TYPES.PREMIUM_MEAL, requiredPremiumKeys: PREMIUM_MEAL_PROTEIN_KEYS },
    candidates,
    meta,
  };
}

async function createDraft({ sections, actor = {}, notes = "" } = {}) {
  let normalizedSections;
  if (sections) {
    normalizedSections = await normalizeSectionsForWrite(sections);
  } else {
    normalizedSections = await buildDefaultVisualTemplateSections();
  }

  await MealBuilderConfig.updateMany({ status: "draft", isCurrent: true }, { $set: { isCurrent: false } });
  const draft = await MealBuilderConfig.create({
    status: "draft",
    isCurrent: true,
    contractVersion: CONTRACT_VERSION,
    source: "dashboard",
    createdBySystem: false,
    bootstrapKey: "",
    sections: normalizedSections,
    notes: String(notes || ""),
    createdBy: actor.userId || null,
    updatedBy: actor.userId || null,
  });
  return serializeConfig(draft.toObject());
}

async function updateDraft({ sections, actor = {}, notes } = {}) {
  const normalizedSections = await normalizeSectionsForWrite(sections || []);
  let draft = await MealBuilderConfig.findOne({ status: "draft", isCurrent: true }).sort({ updatedAt: -1 });
  if (!draft) {
    draft = new MealBuilderConfig({
      status: "draft",
      isCurrent: true,
      contractVersion: CONTRACT_VERSION,
      source: "dashboard",
      createdBySystem: false,
      bootstrapKey: "",
      createdBy: actor.userId || null,
    });
  }
  draft.sections = normalizedSections;
  if (notes !== undefined) draft.notes = String(notes || "");
  draft.updatedBy = actor.userId || null;
  await draft.save();
  return serializeConfig(draft.toObject());
}

async function publishDraft({ actor = {}, notes = "" } = {}) {
  const draft = await MealBuilderConfig.findOne({ status: "draft", isCurrent: true }).sort({ updatedAt: -1 }).lean();
  if (!draft) {
    throw new MealBuilderError("No current Meal Builder draft found", "MEAL_BUILDER_DRAFT_NOT_FOUND", 404);
  }
  const validation = await validateConfigObject(draft);
  if (!validation.ready) {
    throw new MealBuilderError("Meal Builder draft is not publishable", "MEAL_BUILDER_VALIDATION_FAILED", 422, validation);
  }

  const now = new Date();
  const publishedPayload = {
    status: "published",
    isCurrent: true,
    contractVersion: CONTRACT_VERSION,
    sections: normalizeSections(draft.sections || []),
    notes: String(notes || draft.notes || ""),
    source: draft.source || "dashboard",
    createdBySystem: draft.createdBySystem === true,
    bootstrapKey: draft.bootstrapKey || "",
    publishedAt: now,
    publishedBy: actor.userId || null,
    createdBy: draft.createdBy || actor.userId || null,
    updatedBy: actor.userId || null,
  };
  publishedPayload.revisionHash = computeRevisionHash(publishedPayload);

  await MealBuilderConfig.updateMany({ status: "published", isCurrent: true }, { $set: { isCurrent: false, status: "archived" } });
  const published = await MealBuilderConfig.create(publishedPayload);
  return {
    config: serializeConfig(published.toObject()),
    validation,
    contract: await buildPublishedContract({ config: published.toObject(), lang: "en" }),
  };
}

function readyDocForSeed(doc, catalogItemsById) {
  return truthy(doc) && subscriptionEnabled(doc) && isLinkedDocGloballyAvailable(doc, catalogItemsById);
}

function optionKey(option = {}) {
  return String(option.key || option.premiumKey || "").trim().toLowerCase();
}

function optionSort(left, right, relationByOptionId = new Map()) {
  const leftRelation = relationByOptionId.get(String(left._id));
  const rightRelation = relationByOptionId.get(String(right._id));
  return Number(leftRelation?.sortOrder ?? left.sortOrder ?? 0) - Number(rightRelation?.sortOrder ?? right.sortOrder ?? 0);
}

async function buildDefaultVisualTemplateSections({ returnDetails = false } = {}) {
  const warnings = [];
  const errors = [];
  const [basicMeal, saladProduct, proteinsGroup, carbsGroup, sandwichCategory] = await Promise.all([
    MenuProduct.findOne({ key: "basic_meal" }).lean(),
    MenuProduct.findOne({ key: "premium_large_salad" }).lean(),
    MenuOptionGroup.findOne({ key: "proteins" }).lean(),
    MenuOptionGroup.findOne({ key: "carbs" }).lean(),
    MenuCategory.findOne({ key: "cold_sandwiches" }).lean(),
  ]);

  let proteinOptions = [];
  let carbOptions = [];
  let relationByOptionId = new Map();
  let sandwichProductIds = [];
  const sections = [];

  if (basicMeal) {
    const relationRows = await ProductGroupOption.find({ productId: basicMeal._id }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    relationByOptionId = new Map(relationRows.map((row) => [String(row.optionId), row]));
    const relatedOptionIds = relationRows.map((row) => row.optionId);
    const relatedOptions = await MenuOption.find({ _id: { $in: relatedOptionIds } }).lean();
    const catalogItemsById = await loadCatalogItemsByIdForDocs([basicMeal], relatedOptions);
    const optionsById = new Map(relatedOptions.map((option) => [String(option._id), option]));

    if (proteinsGroup) {
      const proteinGroupRelation = await ProductOptionGroup.findOne({ productId: basicMeal._id, groupId: proteinsGroup._id }).lean();
      proteinOptions = relationRows
        .filter((row) => String(row.groupId) === String(proteinsGroup._id))
        .map((row) => optionsById.get(String(row.optionId)))
        .filter((option) => option && relationReady(relationByOptionId.get(String(option._id))) && relationReady(proteinGroupRelation) && readyDocForSeed(option, catalogItemsById))
        .sort((a, b) => optionSort(a, b, relationByOptionId));
    }

    if (carbsGroup) {
      const carbGroupRelation = await ProductOptionGroup.findOne({ productId: basicMeal._id, groupId: carbsGroup._id }).lean();
      carbOptions = relationRows
        .filter((row) => String(row.groupId) === String(carbsGroup._id))
        .map((row) => optionsById.get(String(row.optionId)))
        .filter((option) => option && relationReady(relationByOptionId.get(String(option._id))) && relationReady(carbGroupRelation) && readyDocForSeed(option, catalogItemsById))
        .filter((option) => CUSTOMER_VISIBLE_CARB_KEYS.includes(optionKey(option)))
        .sort((a, b) => optionSort(a, b, relationByOptionId));
    }
  }

  if (sandwichCategory) {
    const sandwichProducts = await MenuProduct.find({
      categoryId: sandwichCategory._id,
      itemType: "cold_sandwich",
      key: { $in: SUBSCRIPTION_COLD_SANDWICH_KEYS },
    }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    const sandwichCatalogItemsById = await loadCatalogItemsByIdForDocs(sandwichProducts);
    sandwichProductIds = sandwichProducts
      .filter((product) => readyDocForSeed(product, sandwichCatalogItemsById))
      .map((product) => product._id);
  }

  const premiumConfigState = await loadClientPremiumUpgradeConfigState();
  const premiumProteinOptions = proteinOptions
    .filter((option) => isPremiumProtein(option) && PREMIUM_MEAL_PROTEIN_KEYS.includes(optionKey(option)) && premiumConfigState.isAllowed(optionKey(option)));
  const premiumSelectedProductIds = [];
  if (saladProduct) {
    const saladCatalogItemsById = await loadCatalogItemsByIdForDocs([saladProduct]);
    if (readyDocForSeed(saladProduct, saladCatalogItemsById) && premiumConfigState.isAllowed(PREMIUM_LARGE_SALAD_PREMIUM_KEY)) premiumSelectedProductIds.push(saladProduct._id);
  }
  const familyOptionsByKey = new Map();
  if (proteinsGroup) {
    await Promise.all([...VISUAL_PROTEIN_FAMILY_KEYS].map(async (familyKey) => {
      const familySource = buildOptionFamilyPickerSource(familyKey, { key: familyKey });
      const candidates = await MenuOption.find(optionFamilyCandidateQuery({ group: proteinsGroup, ...familySource })).sort({ sortOrder: 1, createdAt: -1 }).lean();
      const catalogItemsById = await loadCatalogItemsByIdForDocs(candidates);
      familyOptionsByKey.set(
        familyKey,
        candidates
          .filter((option) => isCanonicalStandardProteinForPicker(option, familyKey))
          .filter((option) => readyDocForSeed(option, catalogItemsById))
          .sort((a, b) => optionSort(a, b, relationByOptionId))
      );
    }));
  }

  if (basicMeal && proteinsGroup) {
    sections.push({
      key: "premium",
      sectionType: "option_group",
      sourceKind: "premium_visual",
      productContextId: basicMeal._id,
      sourceGroupId: proteinsGroup._id,
      selectedOptionIds: premiumProteinOptions.map((option) => option._id),
      selectedProductIds: premiumSelectedProductIds,
      selectionType: MEAL_SELECTION_TYPES.PREMIUM_MEAL,
      titleOverride: PREMIUM_SECTION_TITLE,
      required: true,
      minSelections: 1,
      maxSelections: 1,
      multiSelect: false,
      visible: true,
      availableFor: ["subscription"],
      metadata: {
        visualRole: "premium",
        includedProductKeys: ["premium_large_salad"],
        optionKeys: PREMIUM_MEAL_PROTEIN_KEYS,
      },
      rules: {
        premiumLargeSaladSelectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
        excludedGroupKeys: [...SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS],
        premium_meal: {
          upgradeType: "premium_protein",
          linkedProductKey: "basic_meal",
          premiumProteinOptions: premiumProteinOptions.map(option => ({
            optionKey: optionKey(option),
            extraFeeHalala: Number(premiumConfigState.getActiveConfig(optionKey(option))?.upgradeDeltaHalala || 0),
            enabled: true,
            sortOrder: Number(option.sortOrder || 0)
          }))
        },
        premium_large_salad: {
          upgradeType: "premium_large_salad",
          linkedProductKey: "premium_large_salad",
          extraFeeHalala: Number(premiumConfigState.getActiveConfig(PREMIUM_LARGE_SALAD_PREMIUM_KEY)?.upgradeDeltaHalala || 0),
          blockedGroupKeys: [...SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS],
          groups: [
            {
              groupKey: "leafy_greens",
              enabled: true,
              minSelections: 0,
              maxSelections: 2,
              allowedOptionKeys: []
            },
            {
              groupKey: "vegetables_legumes",
              enabled: true,
              minSelections: 0,
              maxSelections: 19,
              allowedOptionKeys: []
            },
            {
              groupKey: "proteins",
              enabled: true,
              minSelections: 1,
              maxSelections: 1,
              allowedOptionKeys: [
                "boiled_eggs",
                "tuna",
                "chicken_fajita",
                "spicy_chicken",
                "italian_spiced_chicken",
                "chicken_tikka",
                "asian_chicken",
                "chicken_strips",
                "grilled_chicken",
                "mexican_chicken",
                "fish_fillet"
              ]
            }
          ]
        }
      },
      sortOrder: CANONICAL_SECTION_SORT_ORDER.premium,
    });
  } else {
    errors.push({ level: "error", code: "MEAL_BUILDER_DEFAULT_PREMIUM_SOURCE_MISSING", message: "Premium visual section requires basic_meal and proteins group" });
  }

  if (sandwichCategory) {
    sections.push({
      key: "sandwich",
      sectionType: "product_category",
      sourceKind: "product_list",
      sourceCategoryId: sandwichCategory._id,
      includeMode: "selected",
      selectedProductIds: sandwichProductIds,
      selectionType: MEAL_SELECTION_TYPES.SANDWICH,
      titleOverride: SANDWICH_SECTION_TITLE,
      required: false,
      minSelections: 0,
      maxSelections: 1,
      multiSelect: false,
      visible: true,
      availableFor: ["subscription"],
      metadata: {
        requiresBuilder: false,
        treatAsFullMeal: true,
      },
      rules: {
        carbsRequired: false,
      },
      sortOrder: CANONICAL_SECTION_SORT_ORDER.sandwich,
    });
  } else {
    errors.push({ level: "error", code: "MEAL_BUILDER_DEFAULT_SANDWICH_SOURCE_MISSING", message: "Sandwich visual section requires cold_sandwiches category" });
  }

  for (const familyKey of ["chicken", "beef", "fish", "eggs"]) {
    const family = VISUAL_PROTEIN_FAMILY_DEFINITIONS.get(familyKey);
    const familyOptions = familyOptionsByKey.get(familyKey) || [];
    if (!familyOptions.length) {
      warnings.push({
        level: "warning",
        code: "MEAL_BUILDER_DEFAULT_PROTEIN_FAMILY_EMPTY",
        message: "Protein visual family has no active options",
        sectionKey: familyKey,
      });
    }
    if (basicMeal && proteinsGroup) {
      sections.push({
        key: familyKey,
        sectionType: "option_group",
        sourceKind: "visual_family",
        productContextId: basicMeal._id,
        sourceGroupId: proteinsGroup._id,
        selectedOptionIds: familyOptions.map((option) => option._id),
        selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
        titleOverride: family ? family.name : { ar: familyKey, en: familyKey },
        required: true,
        minSelections: 1,
        maxSelections: 1,
        multiSelect: false,
        visible: true,
        availableFor: ["subscription"],
        metadata: {
          visualRole: "protein_family",
          proteinFamilyKey: familyKey,
        },
        rules: familyKey === "beef" ? {
          ruleKey: "beef_daily_limit",
          maxSlotsPerDay: 1,
          unit: "slots",
        } : {},
        sortOrder: CANONICAL_SECTION_SORT_ORDER[familyKey],
      });
    }
  }

  if (basicMeal && carbsGroup) {
    sections.push({
      key: "carbs",
      sectionType: "option_group",
      sourceKind: "visual_family",
      productContextId: basicMeal._id,
      sourceGroupId: carbsGroup._id,
      selectedOptionIds: carbOptions.map((option) => option._id),
      selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
      titleOverride: CARBS_SECTION_TITLE,
      required: true,
      minSelections: 1,
      maxSelections: STANDARD_CARB_RULES.maxTypes,
      multiSelect: true,
      visible: true,
      availableFor: ["subscription"],
      metadata: {
        visualRole: "carbs",
        appliesTo: ["configurable_plate_meal"],
        excludesSelectionTypes: [MEAL_SELECTION_TYPES.SANDWICH],
      },
      rules: {
        ruleKey: "carb_split",
        maxTypes: STANDARD_CARB_RULES.maxTypes,
        maxTotalGrams: STANDARD_CARB_RULES.maxTotalGrams,
        unit: STANDARD_CARB_RULES.unit,
        onlyForSelectionTypes: [MEAL_SELECTION_TYPES.STANDARD_MEAL, MEAL_SELECTION_TYPES.PREMIUM_MEAL],
      },
      sortOrder: CANONICAL_SECTION_SORT_ORDER.carbs,
    });
  } else {
    errors.push({ level: "error", code: "MEAL_BUILDER_DEFAULT_CARBS_SOURCE_MISSING", message: "Carbs visual section requires basic_meal and carbs group" });
  }

  const normalized = normalizeSections(sections);
  if (returnDetails) return { sections: normalized, warnings, errors };
  return normalized;
}

async function buildDefaultSeedSections({ returnDetails = false } = {}) {
  const warnings = [];
  const errors = [];
  const [basicMeal, saladProduct, proteinsGroup, carbsGroup, sandwichCategory] = await Promise.all([
    MenuProduct.findOne({ key: "basic_meal" }).lean(),
    MenuProduct.findOne({ key: "premium_large_salad" }).lean(),
    MenuOptionGroup.findOne({ key: "proteins" }).lean(),
    MenuOptionGroup.findOne({ key: "carbs" }).lean(),
    MenuCategory.findOne({ key: "cold_sandwiches" }).lean(),
  ]);
  let standardProteinOptionIds = [];
  let premiumProteinOptionIds = [];
  let carbOptionIds = [];
  const premiumConfigState = await loadClientPremiumUpgradeConfigState();
  if (basicMeal) {
    const relationRows = await ProductGroupOption.find({ productId: basicMeal._id }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    const relatedOptionIds = relationRows.map((row) => row.optionId);
    const relatedOptions = await MenuOption.find({ _id: { $in: relatedOptionIds } }).lean();
    const catalogItemsById = await loadCatalogItemsByIdForDocs([basicMeal], relatedOptions);
    const optionsById = new Map(relatedOptions.map((option) => [String(option._id), option]));
    if (proteinsGroup) {
      const proteinGroupRelation = await ProductOptionGroup.findOne({ productId: basicMeal._id, groupId: proteinsGroup._id }).lean();
      const proteinRelations = relationRows.filter((row) => String(row.groupId) === String(proteinsGroup._id));
      standardProteinOptionIds = proteinRelations
        .map((row) => ({ relation: row, option: optionsById.get(String(row.optionId)) }))
        .filter(({ relation, option }) => relationReady(relation) && relationReady(proteinGroupRelation) && readyDocForSeed(option, catalogItemsById) && !isPremiumProtein(option))
        .map(({ option }) => option._id);
      premiumProteinOptionIds = proteinRelations
        .map((row) => ({ relation: row, option: optionsById.get(String(row.optionId)) }))
        .filter(({ relation, option }) => relationReady(relation) && relationReady(proteinGroupRelation) && readyDocForSeed(option, catalogItemsById) && isPremiumProtein(option))
        .filter(({ relation, option }) => {
          const priced = premiumConfigState.isAllowed(optionKey(option));
          if (!priced) {
            warnings.push({
              level: "warning",
              code: "MEAL_BUILDER_PREMIUM_PROTEIN_PRICE_MISSING",
              message: "Premium protein was not seeded because it has no canonical premium configuration",
              optionKey: option?.key || "",
            });
          }
          return priced;
        })
        .map(({ option }) => option._id);
      if (!premiumProteinOptionIds.length) {
        warnings.push({
          level: "warning",
          code: "MEAL_BUILDER_PREMIUM_PROTEINS_MISSING",
          message: "No valid premium protein options were available for the initial Meal Builder seed",
        });
      }
    }
    if (carbsGroup) {
      const carbGroupRelation = await ProductOptionGroup.findOne({ productId: basicMeal._id, groupId: carbsGroup._id }).lean();
      carbOptionIds = relationRows
        .filter((row) => String(row.groupId) === String(carbsGroup._id))
        .map((row) => ({ relation: row, option: optionsById.get(String(row.optionId)) }))
        .filter(({ relation, option }) => relationReady(relation) && relationReady(carbGroupRelation) && readyDocForSeed(option, catalogItemsById))
        .map(({ option }) => option._id);
    }
  }

  const sections = [];
  if (basicMeal && proteinsGroup) {
    sections.push({
      sectionType: "option_group",
      productContextId: basicMeal._id,
      sourceGroupId: proteinsGroup._id,
      selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
      titleOverride: { en: "Standard Proteins", ar: "بروتين الوجبة العادية" },
      required: true,
      minSelections: 1,
      maxSelections: 1,
      multiSelect: false,
      visible: true,
      availableFor: ["subscription"],
      selectedOptionIds: standardProteinOptionIds,
      sortOrder: 1,
    });
    if (premiumProteinOptionIds.length) {
      sections.push({
        sectionType: "option_group",
        productContextId: basicMeal._id,
        sourceGroupId: proteinsGroup._id,
        selectionType: MEAL_SELECTION_TYPES.PREMIUM_MEAL,
        titleOverride: { en: "Premium Proteins", ar: "بروتين بريميوم" },
        required: true,
        minSelections: 1,
        maxSelections: 1,
        multiSelect: false,
        visible: true,
        availableFor: ["subscription"],
        selectedOptionIds: premiumProteinOptionIds,
        sortOrder: 3,
      });
    }
  }
  if (basicMeal && carbsGroup) {
    sections.push({
      sectionType: "option_group",
      productContextId: basicMeal._id,
      sourceGroupId: carbsGroup._id,
      selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
      titleOverride: { en: "Carbs", ar: "كارب" },
      required: true,
      minSelections: 1,
      maxSelections: 2,
      multiSelect: true,
      visible: true,
      availableFor: ["subscription"],
      selectedOptionIds: carbOptionIds,
      sortOrder: 2,
    });
  }
  if (sandwichCategory) {
    const sandwichProducts = await MenuProduct.find({
      categoryId: sandwichCategory._id,
      itemType: "cold_sandwich",
      key: { $in: SUBSCRIPTION_COLD_SANDWICH_KEYS },
    }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    const sandwichCatalogItemsById = await loadCatalogItemsByIdForDocs(sandwichProducts);
    const sandwichProductIds = sandwichProducts
      .filter((product) => readyDocForSeed(product, sandwichCatalogItemsById))
      .map((product) => product._id);
    if (sandwichProductIds.length) {
      sections.push({
        sectionType: "product_category",
        sourceCategoryId: sandwichCategory._id,
        includeMode: "selected",
        selectedProductIds: sandwichProductIds,
        selectionType: MEAL_SELECTION_TYPES.SANDWICH,
        titleOverride: { en: "Sandwiches", ar: "ساندويتشات" },
        required: false,
        minSelections: 0,
        maxSelections: 1,
        multiSelect: false,
        visible: true,
        availableFor: ["subscription"],
        sortOrder: 4,
      });
    } else {
      warnings.push({
        level: "warning",
        code: "MEAL_BUILDER_SANDWICHES_MISSING",
        message: "No valid cold sandwich products were available for the initial Meal Builder seed",
      });
    }
  }
  if (saladProduct) {
    const [saladGroupRelations, saladOptionRelations, saladPricing] = await Promise.all([
      ProductOptionGroup.find({ productId: saladProduct._id }).lean(),
      ProductGroupOption.find({ productId: saladProduct._id }).lean(),
      resolvePremiumUpgrade(PREMIUM_LARGE_SALAD_PREMIUM_KEY).catch(() => null),
    ]);
    const saladGroupIds = new Set([
      ...saladGroupRelations.map((row) => String(row.groupId)),
      ...saladOptionRelations.map((row) => String(row.groupId)),
    ]);
    const saladOptionIds = saladOptionRelations.map((row) => row.optionId);
    const [saladGroups, saladOptions] = await Promise.all([
      MenuOptionGroup.find({ _id: { $in: [...saladGroupIds] } }).lean(),
      MenuOption.find({ _id: { $in: saladOptionIds } }).lean(),
    ]);
    const saladCatalogItemsById = await loadCatalogItemsByIdForDocs([saladProduct], saladOptions);
    const saladGroupsById = new Map(saladGroups.map((group) => [String(group._id), group]));
    const saladOptionsById = new Map(saladOptions.map((option) => [String(option._id), option]));
    const saladInvalidRelations = [];
    for (const relation of saladOptionRelations) {
      const group = saladGroupsById.get(String(relation.groupId));
      const option = saladOptionsById.get(String(relation.optionId));
      const groupKey = String(group?.key || "").trim().toLowerCase();
      if (SALAD_EXCLUDED_GROUP_KEYS.has(groupKey)) {
        saladInvalidRelations.push({
          code: "PREMIUM_LARGE_SALAD_EXTRA_PROTEIN_EXPOSED",
          message: "Premium large salad exposes extra_protein_50g",
          groupKey,
          optionKey: option?.key || "",
        });
      }
      if (groupKey === "proteins" && option && !isSaladAllowedProtein(option)) {
        saladInvalidRelations.push({
          code: "PREMIUM_LARGE_SALAD_PROTEIN_NOT_ALLOWED",
          message: "Premium large salad exposes disallowed protein",
          groupKey,
          optionKey: option.key || "",
        });
      }
    }
    const saladPrice = Number((saladPricing || {}).priceHalala || 0);
    if (saladInvalidRelations.length) {
      errors.push(...saladInvalidRelations.map((item) => ({ level: "error", ...item })));
    } else if (!readyDocForSeed(saladProduct, saladCatalogItemsById)) {
      warnings.push({
        level: "warning",
        code: "MEAL_BUILDER_PREMIUM_LARGE_SALAD_UNAVAILABLE",
        message: "Premium large salad product was not ready for the initial Meal Builder seed",
      });
    } else if (saladPrice <= 0) {
      errors.push({
        level: "error",
        code: "MEAL_BUILDER_PREMIUM_LARGE_SALAD_PRICE_MISSING",
        message: "Premium large salad cannot be seeded without a positive premium price",
      });
    } else {
      sections.push({
        sectionType: "product_list",
        selectedProductIds: [saladProduct._id],
        includeMode: "selected",
        selectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
        titleOverride: { en: "Premium Large Salad", ar: "سلطة كبيرة مميزة" },
        required: false,
        minSelections: 0,
        maxSelections: 1,
        multiSelect: false,
        visible: true,
        availableFor: ["subscription"],
        sortOrder: 5,
      });
    }
  } else {
    warnings.push({
      level: "warning",
      code: "MEAL_BUILDER_PREMIUM_LARGE_SALAD_MISSING",
      message: "Premium large salad product was not available for the initial Meal Builder seed",
    });
  }
  const normalized = normalizeSections(sections);
  if (returnDetails) return { sections: normalized, warnings, errors };
  return normalized;
}

async function resolveDocsForSections(sections = []) {
  const productIds = new Set();
  const groupIds = new Set();
  const categoryIds = new Set();
  const optionIds = new Set();
  for (const section of sections) {
    if (section.productContextId) productIds.add(String(section.productContextId));
    if (section.sourceGroupId) groupIds.add(String(section.sourceGroupId));
    if (section.sourceCategoryId) categoryIds.add(String(section.sourceCategoryId));
    for (const id of section.selectedProductIds || []) productIds.add(String(id));
    for (const id of section.selectedOptionIds || []) optionIds.add(String(id));
  }

  const [categories, explicitProducts, groups, explicitOptions] = await Promise.all([
    MenuCategory.find({ _id: { $in: [...categoryIds] } }).lean(),
    MenuProduct.find({ _id: { $in: [...productIds] } }).lean(),
    MenuOptionGroup.find({ _id: { $in: [...groupIds] } }).lean(),
    MenuOption.find({ _id: { $in: [...optionIds] } }).lean(),
  ]);
  const productsById = new Map(explicitProducts.map((row) => [String(row._id), row]));
  const groupsById = new Map(groups.map((row) => [String(row._id), row]));
  const categoriesById = new Map(categories.map((row) => [String(row._id), row]));
  const optionsById = new Map(explicitOptions.map((row) => [String(row._id), row]));

  const categoryProductIds = new Set();
  const categoryProductRows = await MenuProduct.find({ categoryId: { $in: [...categoryIds] } }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  for (const product of categoryProductRows) {
    categoryProductIds.add(String(product._id));
    productsById.set(String(product._id), product);
  }

  const relationProductIds = [...productsById.keys()];
  const [groupRelations, optionRelations] = await Promise.all([
    ProductOptionGroup.find({ productId: { $in: relationProductIds } }).lean(),
    ProductGroupOption.find({ productId: { $in: relationProductIds } }).lean(),
  ]);
  const relationOptionIds = optionRelations.map((row) => String(row.optionId));
  const relationGroupIdsFromRows = optionRelations.map((row) => String(row.groupId));
  const [relationOptions, relationGroups] = await Promise.all([
    MenuOption.find({ _id: { $in: relationOptionIds } }).lean(),
    MenuOptionGroup.find({ _id: { $in: relationGroupIdsFromRows } }).lean(),
  ]);
  for (const option of relationOptions) optionsById.set(String(option._id), option);
  for (const group of relationGroups) groupsById.set(String(group._id), group);

  const catalogItemsById = await loadCatalogItemsByIdForDocs(
    [...productsById.values()],
    [...optionsById.values()]
  );

  return {
    categoriesById,
    productsById,
    groupsById,
    optionsById,
    groupRelations,
    optionRelations,
    catalogItemsById,
  };
}

function activeIssue(doc, codePrefix) {
  if (!doc) return `${codePrefix}_NOT_FOUND`;
  if (doc.isActive === false) return `${codePrefix}_INACTIVE`;
  if (doc.isVisible === false || doc.isAvailable === false) return `${codePrefix}_UNAVAILABLE`;
  if (!doc.publishedAt) return `${codePrefix}_UNPUBLISHED`;
  return null;
}

function addCheck(collection, level, code, message, details = {}) {
  collection.push({ level, code, message, ...details });
}

async function validateConfigObject(configOrPayload = {}) {
  const sections = normalizeSections(configOrPayload.sections || []);
  const errors = [];
  const warnings = [];
  const checks = [];
  const docs = await resolveDocsForSections(sections);
  const groupRelationByProductGroup = new Map(docs.groupRelations.map((row) => [`${String(row.productId)}:${String(row.groupId)}`, row]));
  const optionRelationByProductGroupOption = new Map(docs.optionRelations.map((row) => [`${String(row.productId)}:${String(row.groupId)}:${String(row.optionId)}`, row]));

  if (!sections.length) {
    addCheck(errors, "error", "MEAL_BUILDER_SECTIONS_EMPTY", "Meal Builder must contain at least one section");
  }

  for (const section of sections) {
    if (section.visible === false) continue;
    if (!section.availableFor.includes("subscription")) {
      addCheck(warnings, "warning", "MEAL_BUILDER_SECTION_HIDDEN_FROM_SUBSCRIPTION", "Section is not available for subscription", { sectionType: section.sectionType });
      continue;
    }

    if (section.sectionType === "option_group") {
      const product = docs.productsById.get(String(section.productContextId));
      const group = docs.groupsById.get(String(section.sourceGroupId));
      validateProductForBuilder(product, docs.catalogItemsById, errors, { productId: section.productContextId, sectionType: section.sectionType });
      validateGroupForBuilder(group, errors, { groupId: section.sourceGroupId, productId: section.productContextId });

      const groupRelation = groupRelationByProductGroup.get(`${String(section.productContextId)}:${String(section.sourceGroupId)}`);
      if (!groupRelation) {
        addCheck(errors, "error", "MEAL_BUILDER_PRODUCT_GROUP_RELATION_NOT_FOUND", "Product option-group relation is missing", {
          productId: String(section.productContextId),
          groupId: String(section.sourceGroupId),
        });
      } else if (groupRelation.isActive === false || groupRelation.isVisible === false || groupRelation.isAvailable === false) {
        addCheck(errors, "error", "MEAL_BUILDER_PRODUCT_GROUP_RELATION_UNAVAILABLE", "Product option-group relation is unavailable", {
          productId: String(section.productContextId),
          groupId: String(section.sourceGroupId),
        });
      }

      const relationOptions = docs.optionRelations
        .filter((row) => String(row.productId) === String(section.productContextId) && String(row.groupId) === String(section.sourceGroupId));
      const selectedSet = new Set((section.selectedOptionIds || []).map(String));
      const visualFamilySection = isVisualProteinFamilySection(section);
      const optionRows = visualFamilySection && selectedSet.size
        ? [...selectedSet].map((optionId) => ({
            relation: optionRelationByProductGroupOption.get(`${String(section.productContextId)}:${String(section.sourceGroupId)}:${String(optionId)}`) || null,
            option: docs.optionsById.get(String(optionId)),
          }))
        : relationOptions
            .filter((row) => !selectedSet.size || selectedSet.has(String(row.optionId)))
            .map((row) => ({ relation: row, option: docs.optionsById.get(String(row.optionId)) }));

      if (!optionRows.length) {
        addCheck(errors, "error", "MEAL_BUILDER_OPTION_NOT_FOUND", "Option group section has no selectable options", {
          productId: String(section.productContextId),
          groupId: String(section.sourceGroupId),
        });
      }
      for (const row of optionRows) {
        if (visualFamilySection) {
          validateVisualFamilyOptionForBuilder(row.option, docs.catalogItemsById, errors, {
            productId: section.productContextId,
            groupId: section.sourceGroupId,
            sectionKey: section.key,
            selectionType: section.selectionType,
          });
        } else {
          validateOptionRelationForBuilder(row, docs.catalogItemsById, errors, {
            productId: section.productContextId,
            groupId: section.sourceGroupId,
            selectionType: section.selectionType,
          });
        }
      }
      if (section.key === "premium") {
        const exposedPremiumKeys = new Set(
          optionRows
            .map(({ option }) => optionIdentity(option))
            .filter(Boolean)
        );
        for (const premiumKey of PREMIUM_MEAL_PROTEIN_KEYS) {
          if (!exposedPremiumKeys.has(premiumKey)) {
            addCheck(errors, "error", "MEAL_BUILDER_PREMIUM_OPTION_MISSING", "Premium visual section is missing a required premium option", {
              sectionKey: section.key,
              optionKey: premiumKey,
            });
          }
        }
        const premiumProducts = (section.selectedProductIds || [])
          .map((id) => docs.productsById.get(String(id)))
          .filter(Boolean);
        if (!premiumProducts.some((product) => product.key === "premium_large_salad")) {
          addCheck(errors, "error", "MEAL_BUILDER_PREMIUM_LARGE_SALAD_MISSING", "Premium visual section must include premium_large_salad", {
            sectionKey: section.key,
          });
        }
        for (const premiumProduct of premiumProducts) {
          validateProductForBuilder(premiumProduct, docs.catalogItemsById, errors, { sectionType: section.sectionType, sectionKey: section.key });
          if (premiumProduct.key === "premium_large_salad") {
            validatePremiumLargeSaladProductRelations(premiumProduct, docs, optionRelationByProductGroupOption, errors);
          }
        }
        
        // Validate new rules
        const rules = section.rules || {};
        if (rules.premium_meal) {
          const pm = rules.premium_meal;
          if (pm.linkedProductKey !== "basic_meal") {
            addCheck(errors, "error", "MEAL_BUILDER_PREMIUM_MEAL_INVALID_LINK", "premium_meal.linkedProductKey must be basic_meal");
          }
          if (Array.isArray(pm.premiumProteinOptions)) {
            const allowedOptionIds = new Set(optionRows.map(({ option }) => String(option._id)));
            for (const popt of pm.premiumProteinOptions) {
              if (Number(popt.extraFeeHalala) < 0) {
                addCheck(errors, "error", "MEAL_BUILDER_PREMIUM_MEAL_INVALID_FEE", "premium_meal extraFeeHalala must be >= 0");
              }
              const optKey = popt.optionKey;
              const optionExists = optionRows.some(({ option }) => optionIdentity(option) === optKey);
              if (!optionExists && popt.enabled !== false) {
                addCheck(errors, "error", "MEAL_BUILDER_PREMIUM_MEAL_INVALID_OPTION", `premium_meal premium options must exist in the proteins option group: ${optKey}`);
              }
            }
          }
        }
        if (rules.premium_large_salad) {
          const pls = rules.premium_large_salad;
          if (pls.linkedProductKey !== "premium_large_salad") {
            addCheck(errors, "error", "MEAL_BUILDER_PREMIUM_LARGE_SALAD_INVALID_LINK", "premium_large_salad.linkedProductKey must be premium_large_salad");
          }
          const plsProduct = premiumProducts.find((p) => p.key === "premium_large_salad");
          if (!plsProduct) {
             addCheck(errors, "error", "MEAL_BUILDER_PREMIUM_LARGE_SALAD_MISSING", "premium_large_salad linked product must exist");
          }
          if (plsProduct && Array.isArray(pls.groups)) {
             const groupRelations = docs.groupRelations.filter(r => String(r.productId) === String(plsProduct._id));
             const groupIds = new Set(groupRelations.map(r => String(r.groupId)));
             const allowedGroups = [...docs.groupsById.values()].filter(g => groupIds.has(String(g._id)));
             for (const g of pls.groups) {
               const gKey = g.groupKey;
               const groupExists = allowedGroups.some(ag => matchSaladGroupKey(ag.key, gKey));
               if (!groupExists && g.enabled !== false) {
                 addCheck(errors, "error", "MEAL_BUILDER_PREMIUM_LARGE_SALAD_INVALID_GROUP", `premium_large_salad selected groups must exist: ${gKey}`);
               }
               if (groupExists && Array.isArray(g.allowedOptionKeys)) {
                 const allowedGroup = allowedGroups.find(ag => matchSaladGroupKey(ag.key, gKey));
                 const optRelations = docs.optionRelations.filter(r => String(r.productId) === String(plsProduct._id) && String(r.groupId) === String(allowedGroup._id));
                 const allowedOptIds = new Set(optRelations.map(r => String(r.optionId)));
                 for (const optKey of g.allowedOptionKeys) {
                    const optExists = [...docs.optionsById.values()].some(o => allowedOptIds.has(String(o._id)) && (o.key === optKey || o.premiumKey === optKey));
                    if (!optExists) {
                       addCheck(errors, "error", "MEAL_BUILDER_PREMIUM_LARGE_SALAD_INVALID_OPTION", `premium_large_salad selected options must exist under selected groups: ${optKey}`);
                    }
                 }
               }
             }
          }
          if (Array.isArray(pls.blockedGroupKeys)) {
            // blockedGroupKeys must not appear in the final planner output is checked during generation, 
            // but we can ensure they are just strings here.
          }
        }
      }
    } else {
      if (section.sectionType === "product_category") {
        const category = docs.categoriesById.get(String(section.sourceCategoryId));
        const categoryIssue = activeIssue(category, "MEAL_BUILDER_CATEGORY");
        if (categoryIssue) {
          addCheck(errors, "error", categoryIssue, "Meal Builder category is not ready", {
            categoryId: section.sourceCategoryId ? String(section.sourceCategoryId) : null,
          });
        }
      }
      const products = resolveSectionProducts(section, docs);
      if (!products.length) {
        addCheck(errors, "error", "MEAL_BUILDER_PRODUCT_NOT_FOUND", "Product section has no products", { sectionType: section.sectionType });
      }
      for (const product of products) {
        validateProductForBuilder(product, docs.catalogItemsById, errors, { sectionType: section.sectionType });
        if (section.selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD) {
          validatePremiumLargeSaladProductRelations(product, docs, optionRelationByProductGroupOption, errors);
        }
      }
    }
  }

  validateVisualTemplateSections(sections, warnings, errors);

  const status = errors.length ? "error" : warnings.length ? "warning" : "ok";
  checks.push(...errors, ...warnings);
  return {
    status,
    ready: errors.length === 0,
    errors,
    warnings,
    checks,
    summary: {
      sections: sections.length,
      errors: errors.length,
      warnings: warnings.length,
      published: configOrPayload.status === "published",
    },
  };
}

function validateVisualTemplateSections(sections, warnings, errors) {
  addLegacyVisualDraftShapeIssues(sections, errors);
  const visualSections = sections.filter((section) => section.key && VISUAL_TEMPLATE_ORDER.includes(section.key));
  if (!visualSections.length) return;

  const byKey = new Map(visualSections.map((section) => [section.key, section]));
  for (const [index, key] of VISUAL_TEMPLATE_ORDER.entries()) {
    const section = byKey.get(key);
    const expectedSortOrder = CANONICAL_SECTION_SORT_ORDER[key] || ((index + 1) * 10);
    if (!section) {
      addCheck(errors, "error", "MEAL_BUILDER_VISUAL_SECTION_MISSING", "Default visual template section is missing", { sectionKey: key });
      continue;
    }
    const actualSortOrder = Number(section.sortOrder || 0);
    const matchesCanonical = (actualSortOrder === expectedSortOrder) || (actualSortOrder === expectedSortOrder / 10);
    if (!matchesCanonical) {
      addCheck(warnings, "warning", "MEAL_BUILDER_VISUAL_SECTION_ORDER_CHANGED", "Default visual template section order differs from canonical order", {
        sectionKey: key,
        expectedSortOrder,
        actualSortOrder,
      });
    }
  }

  const sandwich = byKey.get("sandwich");
  if (sandwich) {
    if (sandwich.selectionType !== MEAL_SELECTION_TYPES.SANDWICH) {
      addCheck(errors, "error", "MEAL_BUILDER_SANDWICH_SELECTION_TYPE_INVALID", "Sandwich section must use selectionType=sandwich", { sectionKey: "sandwich" });
    }
    if (sandwich.metadata?.requiresBuilder !== false || sandwich.metadata?.treatAsFullMeal !== true || sandwich.rules?.carbsRequired !== false) {
      addCheck(warnings, "warning", "MEAL_BUILDER_SANDWICH_METADATA_INCOMPLETE", "Sandwich section should be marked as full meal without carbs", { sectionKey: "sandwich" });
    }
  }

  const beef = byKey.get("beef");
  if (beef && (beef.rules?.ruleKey !== "beef_daily_limit" || Number(beef.rules?.maxSlotsPerDay || 0) !== 1)) {
    addCheck(warnings, "warning", "MEAL_BUILDER_BEEF_DAILY_LIMIT_RULE_MISSING", "Beef section should expose beef_daily_limit metadata", { sectionKey: "beef" });
  }

  const carbs = byKey.get("carbs");
  if (carbs) {
    if (carbs.selectionType !== MEAL_SELECTION_TYPES.STANDARD_MEAL) {
      addCheck(errors, "error", "MEAL_BUILDER_CARBS_SELECTION_TYPE_INVALID", "Carbs section must apply to standard configurable meals", { sectionKey: "carbs" });
    }
    if (Number(carbs.maxSelections || 0) !== STANDARD_CARB_RULES.maxTypes || Number(carbs.rules?.maxTotalGrams || 0) !== STANDARD_CARB_RULES.maxTotalGrams) {
      addCheck(errors, "error", "MEAL_BUILDER_CARBS_RULE_INVALID", "Carbs section must enforce max 2 types and 300 grams", { sectionKey: "carbs" });
    }
  }

  for (const familyKey of VISUAL_PROTEIN_FAMILY_KEYS) {
    const section = byKey.get(familyKey);
    if (section && !(section.selectedOptionIds || []).length) {
      addCheck(warnings, "warning", "MEAL_BUILDER_PROTEIN_FAMILY_EMPTY", "Protein family section has no selected options", { sectionKey: familyKey });
    }
  }
}

function validateProductForBuilder(product, catalogItemsById, errors, details = {}) {
  const issue = activeIssue(product, "MEAL_BUILDER_PRODUCT");
  if (issue) return addCheck(errors, "error", issue, "Meal Builder product is not ready", details);
  if (!subscriptionEnabled(product)) return addCheck(errors, "error", "MEAL_BUILDER_PRODUCT_NOT_SUBSCRIPTION_ENABLED", "Meal Builder product is not subscription-enabled", details);
  if (!isLinkedDocGloballyAvailable(product, catalogItemsById)) return addCheck(errors, "error", "MEAL_BUILDER_PRODUCT_CATALOG_ITEM_UNAVAILABLE", "Meal Builder product CatalogItem is unavailable", details);
  return null;
}

function validateGroupForBuilder(group, errors, details = {}) {
  const issue = activeIssue(group, "MEAL_BUILDER_OPTION_GROUP");
  if (issue) addCheck(errors, "error", issue, "Meal Builder option group is not ready", details);
}

function validateOptionRelationForBuilder({ relation, option }, catalogItemsById, errors, details = {}) {
  const optionDetails = { ...details, optionId: relation ? String(relation.optionId) : null };
  if (!relation) return addCheck(errors, "error", "MEAL_BUILDER_PRODUCT_OPTION_RELATION_NOT_FOUND", "Product option relation is missing", optionDetails);
  if (relation.isActive === false || relation.isVisible === false || relation.isAvailable === false) {
    return addCheck(errors, "error", "MEAL_BUILDER_PRODUCT_OPTION_RELATION_UNAVAILABLE", "Product option relation is unavailable", optionDetails);
  }
  const issue = activeIssue(option, "MEAL_BUILDER_OPTION");
  if (issue) return addCheck(errors, "error", issue, "Meal Builder option is not ready", optionDetails);
  if (!subscriptionEnabled(option)) return addCheck(errors, "error", "MEAL_BUILDER_OPTION_NOT_SUBSCRIPTION_ENABLED", "Meal Builder option is not subscription-enabled", optionDetails);
  if (!isLinkedDocGloballyAvailable(option, catalogItemsById)) return addCheck(errors, "error", "MEAL_BUILDER_OPTION_CATALOG_ITEM_UNAVAILABLE", "Meal Builder option CatalogItem is unavailable", optionDetails);

  if (details.selectionType === MEAL_SELECTION_TYPES.STANDARD_MEAL && isPremiumProtein(option)) {
    return addCheck(errors, "error", "MEAL_BUILDER_STANDARD_EXPOSES_PREMIUM_PROTEIN", "Standard meal builder section cannot expose premium protein", optionDetails);
  }
  if (details.selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL && !isPremiumProtein(option)) {
    return addCheck(errors, "error", "MEAL_BUILDER_PREMIUM_MEAL_REQUIRES_PREMIUM_PROTEIN", "Premium meal builder section requires premium protein options", optionDetails);
  }
  if (details.selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD && !isSaladAllowedProtein(option)) {
    return addCheck(errors, "error", "PREMIUM_LARGE_SALAD_PROTEIN_NOT_ALLOWED", "Premium large salad exposes disallowed protein", optionDetails);
  }
  return null;
}

function validateVisualFamilyOptionForBuilder(option, catalogItemsById, errors, details = {}) {
  const optionDetails = { ...details, optionId: option ? String(option._id) : null };
  if (!option) return addCheck(errors, "error", "MEAL_BUILDER_OPTION_NOT_FOUND", "Visual family selected option is missing", optionDetails);
  const issue = activeIssue(option, "MEAL_BUILDER_OPTION");
  if (issue) return addCheck(errors, "error", issue, "Meal Builder option is not ready", optionDetails);
  if (!subscriptionEnabled(option)) return addCheck(errors, "error", "MEAL_BUILDER_OPTION_NOT_SUBSCRIPTION_ENABLED", "Meal Builder option is not subscription-enabled", optionDetails);
  if (!isLinkedDocGloballyAvailable(option, catalogItemsById)) return addCheck(errors, "error", "MEAL_BUILDER_OPTION_CATALOG_ITEM_UNAVAILABLE", "Meal Builder option CatalogItem is unavailable", optionDetails);
  if (!isCanonicalStandardProteinForPicker(option, details.sectionKey)) {
    return addCheck(errors, "error", "MEAL_BUILDER_VISUAL_FAMILY_OPTION_INVALID", "Visual family section contains an invalid protein option", optionDetails);
  }
  return null;
}

function validatePremiumLargeSaladProductRelations(product, docs, optionRelationByProductGroupOption, errors) {
  if (!product) return;
  const productRelations = docs.optionRelations.filter((row) => String(row.productId) === String(product._id));
  for (const relation of productRelations) {
    const group = docs.groupsById.get(String(relation.groupId));
    const option = docs.optionsById.get(String(relation.optionId));
    const groupKey = String(group?.key || "").trim().toLowerCase();
    if (SALAD_EXCLUDED_GROUP_KEYS.has(groupKey)) {
      addCheck(errors, "error", "PREMIUM_LARGE_SALAD_EXTRA_PROTEIN_EXPOSED", "Premium large salad exposes extra_protein_50g", {
        productId: String(product._id),
        groupId: String(relation.groupId),
        optionId: String(relation.optionId),
      });
    }
    if (groupKey === "proteins" && option && !isSaladAllowedProtein(option)) {
      addCheck(errors, "error", "PREMIUM_LARGE_SALAD_PROTEIN_NOT_ALLOWED", "Premium large salad exposes disallowed protein", {
        productId: String(product._id),
        groupId: String(relation.groupId),
        optionId: String(relation.optionId),
      });
    }
    const key = `${String(product._id)}:${String(relation.groupId)}:${String(relation.optionId)}`;
    if (!optionRelationByProductGroupOption.has(key)) {
      addCheck(errors, "error", "MEAL_BUILDER_PRODUCT_OPTION_RELATION_NOT_FOUND", "Premium large salad option relation is missing", {
        productId: String(product._id),
        groupId: String(relation.groupId),
        optionId: String(relation.optionId),
      });
    }
  }
}

function resolveSectionProducts(section, docs) {
  if (section.sectionType === "product_list") {
    return (section.selectedProductIds || []).map((id) => docs.productsById.get(String(id))).filter(Boolean);
  }
  if (section.sectionType === "product_category") {
    const products = [...docs.productsById.values()].filter((product) => String(product.categoryId) === String(section.sourceCategoryId));
    if (section.includeMode === "selected") {
      const selected = new Set((section.selectedProductIds || []).map(String));
      return products.filter((product) => selected.has(String(product._id)));
    }
    return products;
  }
  return [];
}

function productSelectionType(section, product) {
  if (product && product.key === "premium_large_salad") return MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD;
  if (product && product.itemType === "cold_sandwich") return MEAL_SELECTION_TYPES.SANDWICH;
  if (section.selectionType) return section.selectionType;
  return "";
}

async function buildPublishedContract({ config = null, lang = "en", includeUnavailable = false } = {}) {
  const published = config || await getCurrentPublishedConfig();
  if (!published) {
    throw new MealBuilderError("Meal Builder is not published", "MEAL_BUILDER_NOT_PUBLISHED", 404);
  }
  const sections = normalizeSections(published.sections || []);
  const docs = await resolveDocsForSections(sections);
  const premiumConfigState = await loadClientPremiumUpgradeConfigState();
  const premiumLargeSaladUpgrade = await resolvePremiumUpgrade(PREMIUM_LARGE_SALAD_PREMIUM_KEY).catch(() => null);
  const premiumLargeSaladPricing = {
    priceHalala: premiumLargeSaladUpgrade?.priceHalala || 0,
    extraFeeHalala: premiumLargeSaladUpgrade?.priceHalala || 0,
    currency: premiumLargeSaladUpgrade?.currency || SYSTEM_CURRENCY,
    source: "resolvePremiumUpgrade",
    isCatalogUnavailable: !premiumLargeSaladUpgrade,
  };
  const payloadSections = [];
  const membership = createEmptyMembership();

  for (const section of sections) {
    if (section.visible === false || !section.availableFor.includes("subscription")) continue;
    if (section.sectionType === "option_group") {
      const payload = buildOptionGroupSection(section, docs, lang, includeUnavailable, membership, premiumLargeSaladPricing, premiumConfigState);
      if (payload && (includeUnavailable || payload.items.length)) payloadSections.push(payload);
    } else {
      const payload = buildProductSection(section, docs, lang, includeUnavailable, membership, premiumLargeSaladPricing, premiumConfigState);
      if (payload && (includeUnavailable || payload.items.length)) payloadSections.push(payload);
    }
  }

  const stablePayload = {
    contractVersion: CONTRACT_VERSION,
    publishedAt: published.publishedAt || null,
    sections: payloadSections,
  };
  const revisionHash = published.revisionHash || stableHash(stablePayload);
  return {
    ...stablePayload,
    revisionHash,
    membership,
  };
}

function createEmptyMembership() {
  return {
    products: new Set(),
    groups: new Set(),
    options: new Set(),
    bySelectionType: new Map(),
  };
}

function addMembership(membership, selectionType, productId, groupId = null, optionId = null) {
  const type = selectionType || "";
  if (!membership.bySelectionType.has(type)) {
    membership.bySelectionType.set(type, { products: new Set(), groups: new Set(), options: new Set() });
  }
  const scoped = membership.bySelectionType.get(type);
  if (productId) {
    membership.products.add(String(productId));
    scoped.products.add(String(productId));
  }
  if (productId && groupId) {
    const key = `${String(productId)}:${String(groupId)}`;
    membership.groups.add(key);
    scoped.groups.add(key);
  }
  if (productId && groupId && optionId) {
    const key = `${String(productId)}:${String(groupId)}:${String(optionId)}`;
    membership.options.add(key);
    scoped.options.add(key);
  }
}

function customerReady(doc, catalogItemsById) {
  return truthy(doc) && subscriptionEnabled(doc) && isLinkedDocGloballyAvailable(doc, catalogItemsById);
}

function relationReady(doc) {
  return doc && doc.isActive !== false && doc.isVisible !== false && doc.isAvailable !== false;
}

function buildSectionBase(section, titleSource, lang) {
  const titleOverride = section.titleOverride || {};
  const titleI18n = {
    ar: titleOverride.ar || titleSource?.name?.ar || "",
    en: titleOverride.en || titleSource?.name?.en || "",
  };
  return {
    id: section._id ? String(section._id) : `section:${section.sectionType}:${section.sortOrder}`,
    key: section.key || "",
    type: canonicalSectionType(section),
    source: canonicalSectionSource(section),
    sectionType: section.sectionType,
    sourceKind: section.sourceKind || "",
    title: pickLang(titleI18n, lang),
    titleI18n,
    sortOrder: Number(section.sortOrder || 0),
    required: Boolean(section.required),
    minSelections: Number(section.minSelections || 0),
    maxSelections: section.maxSelections === null || section.maxSelections === undefined ? null : Number(section.maxSelections),
    multiSelect: Boolean(section.multiSelect),
    selectionType: section.selectionType || "",
    metadata: plainObject(section.metadata),
    rules: canonicalSectionRules(section),
  };
}

function buildOptionGroupSection(section, docs, lang, includeUnavailable, membership, premiumLargeSaladPricing = {}, premiumConfigState = null) {
  const product = docs.productsById.get(String(section.productContextId));
  const group = docs.groupsById.get(String(section.sourceGroupId));
  if (!product || !group) return null;

  const selected = new Set((section.selectedOptionIds || []).map(String));
  const visualFamilySection = isVisualProteinFamilySection(section);
  const relationByOption = new Map(docs.optionRelations
    .filter((relation) => String(relation.productId) === String(product._id) && String(relation.groupId) === String(group._id))
    .map((relation) => [String(relation.optionId), relation]));
  const sourceOptionIds = visualFamilySection && selected.size
    ? [...selected]
    : [...relationByOption.keys()];
  const options = sourceOptionIds
    .map((optionId) => docs.optionsById.get(String(optionId)))
    .filter(Boolean)
    .filter((option) => !selected.size || selected.has(String(option._id)))
    .filter((option) => includeUnavailable || (customerReady(option, docs.catalogItemsById) && (visualFamilySection || relationReady(relationByOption.get(String(option._id))))))
    .sort((a, b) => Number(relationByOption.get(String(a._id))?.sortOrder ?? a.sortOrder ?? 0) - Number(relationByOption.get(String(b._id))?.sortOrder ?? b.sortOrder ?? 0));

  let filteredOptions = options;
  if (section.selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL) {
    const pmRules = section.rules?.premium_meal;
    if (pmRules && Array.isArray(pmRules.premiumProteinOptions) && pmRules.premiumProteinOptions.length > 0) {
      filteredOptions = options.filter(option => {
        const pmOpt = pmRules.premiumProteinOptions.find(o => o.optionKey === optionIdentity(option) || o.optionKey === option.key || o.optionKey === option.premiumKey);
        return pmOpt && pmOpt.enabled !== false;
      });
    } else {
      filteredOptions = options.filter(option => isPremiumProtein(option));
    }
    if (premiumConfigState?.hasConfigs) {
      filteredOptions = filteredOptions.filter((option) => premiumConfigState.isAllowed(option.premiumKey || option.key));
    }
  }

  const items = filteredOptions.map((option) => {
    const relation = relationByOption.get(String(option._id));
    addMembership(membership, section.selectionType, product._id, group._id, option._id);
    return buildOptionItem({ option, relation, group, product, selectionType: section.selectionType, lang, rules: section.rules, premiumConfigState });
  });
  addMembership(membership, section.selectionType, product._id, group._id);

  if (section.key === "premium") {
    const premiumProducts = (section.selectedProductIds || [])
      .map((id) => docs.productsById.get(String(id)))
      .filter(Boolean)
      .filter((selectedProduct) => includeUnavailable || customerReady(selectedProduct, docs.catalogItemsById))
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    for (const selectedProduct of premiumProducts) {
      const resolvedSelectionType = selectedProduct.key === "premium_large_salad"
        ? MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD
        : productSelectionType({ selectionType: "" }, selectedProduct);
      if (
        resolvedSelectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD
        && premiumConfigState?.hasConfigs
        && !premiumConfigState.isAllowed(PREMIUM_LARGE_SALAD_PREMIUM_KEY)
      ) {
        continue;
      }
      addMembership(membership, resolvedSelectionType, selectedProduct._id);
      items.push(buildProductItem({
        product: selectedProduct,
        selectionType: resolvedSelectionType,
        docs,
        lang,
        membership,
        premiumLargeSaladPricing,
        includeUnavailable,
        rules: section.rules,
        premiumConfigState,
      }));
    }
  }

  return {
    ...buildSectionBase(section, group, lang),
    productContextId: String(product._id),
    productKey: product.key || "",
    productContext: {
      id: String(product._id),
      key: product.key || "",
      name: pickLang(product.name, lang),
      nameI18n: product.name || {},
      itemType: product.itemType || "product",
      pricingModel: product.pricingModel || "",
      priceHalala: Number(product.priceHalala || 0),
      currency: product.currency || SYSTEM_CURRENCY,
    },
    sourceGroupId: String(group._id),
    groupKey: group.key || "",
    items,
  };
}

function buildProductSection(section, docs, lang, includeUnavailable, membership, premiumLargeSaladPricing, premiumConfigState = null) {
  const category = section.sourceCategoryId ? docs.categoriesById.get(String(section.sourceCategoryId)) : null;
  const products = resolveSectionProducts(section, docs)
    .filter((product) => includeUnavailable || customerReady(product, docs.catalogItemsById))
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  const items = products.map((product) => {
    const selectionType = productSelectionType(section, product);
    if (
      selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD
      && premiumConfigState?.hasConfigs
      && !premiumConfigState.isAllowed(PREMIUM_LARGE_SALAD_PREMIUM_KEY)
    ) {
      return null;
    }
    addMembership(membership, selectionType, product._id);
    return buildProductItem({ product, selectionType, docs, lang, membership, premiumLargeSaladPricing, includeUnavailable, rules: section.rules, premiumConfigState });
  }).filter(Boolean);

  return {
    ...buildSectionBase(section, category || { name: section.titleOverride }, lang),
    sourceCategoryId: section.sourceCategoryId ? String(section.sourceCategoryId) : null,
    includeMode: section.includeMode || "selected",
    items,
  };
}

function buildOptionItem({ option, relation, group, product, selectionType, lang, rules, premiumConfigState = null }) {
  const premiumKey = option.premiumKey || option.key || null;
  const activeConfig = premiumConfigState?.getActiveConfig ? premiumConfigState.getActiveConfig(premiumKey) : null;
  const isPremium = selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL && Boolean(activeConfig);
  const premiumFee = isPremium ? Number(activeConfig.upgradeDeltaHalala || 0) : 0;

  const priceHalala = isPremium
    ? premiumFee
    : Number(relation?.extraPriceHalala ?? option.extraPriceHalala ?? 0);
  return {
    id: String(option._id),
    key: option.key || "",
    type: "option",
    groupId: String(group._id),
    groupKey: group.key || "",
    productId: String(product._id),
    productKey: product.key || "",
    name: pickLang(option.name, lang),
    nameI18n: option.name || {},
    imageUrl: option.imageUrl || "",
    selectionType,
    isPremium,
    premiumKind: isPremium ? "premium_protein" : null,
    premiumKey: isPremium ? premiumKey : null,
    priceHalala,
    premiumPriceHalala: isPremium ? premiumFee : 0,
    requiresPremiumBalance: isPremium,
    available: true,
    sortOrder: Number(relation?.sortOrder ?? option.sortOrder ?? 0),
  };
}

function buildProductItem({ product, selectionType, docs, lang, membership, premiumLargeSaladPricing, includeUnavailable, rules, premiumConfigState = null }) {
  const isPremiumSalad = selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD;
  const isSandwich = selectionType === MEAL_SELECTION_TYPES.SANDWICH;
  const optionGroups = buildProductOptionGroups({ product, selectionType, docs, lang, membership, includeUnavailable, rules, premiumConfigState });
  let priceHalala = isPremiumSalad
    ? Number(premiumLargeSaladPricing.priceHalala ?? product.priceHalala ?? 0)
    : Number(product.priceHalala || 0);
  
  let premiumFee = isPremiumSalad ? Number(premiumLargeSaladPricing.extraFeeHalala ?? priceHalala) : 0;

  return {
    id: String(product._id),
    key: product.key || "",
    type: "product",
    name: pickLang(product.name, lang),
    nameI18n: product.name || {},
    imageUrl: product.imageUrl || "",
    itemType: product.itemType || "product",
    selectionType,
    isPremium: isPremiumSalad,
    premiumKind: isPremiumSalad ? "premium_large_salad" : null,
    premiumKey: isPremiumSalad ? PREMIUM_LARGE_SALAD_PREMIUM_KEY : null,
    priceHalala,
    premiumPriceHalala: isPremiumSalad ? premiumFee : 0,
    requiresPremiumBalance: isPremiumSalad,
    action: {
      type: isSandwich ? "direct_add" : "open_builder",
      requiresBuilder: !isSandwich,
      treatAsFullMeal: isSandwich || undefined,
    },
    available: true,
    optionGroups,
    sortOrder: Number(product.sortOrder || 0),
  };
}

function buildProductOptionGroups({ product, selectionType, docs, lang, membership, includeUnavailable, rules, premiumConfigState = null }) {
  const groupRelations = docs.groupRelations
    .filter((relation) => String(relation.productId) === String(product._id))
    .filter((relation) => includeUnavailable || relationReady(relation))
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  return groupRelations.map((relation) => {
    const group = docs.groupsById.get(String(relation.groupId));
    if (!group || (!includeUnavailable && !truthy(group))) return null;
    
    let isBlocked = false;
    let minSelections = Number(relation.minSelections || 0);
    let maxSelections = relation.maxSelections === null || relation.maxSelections === undefined ? null : Number(relation.maxSelections);
    
    if (selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD) {
       if (rules && rules.premium_large_salad && rules.premium_large_salad.blockedGroupKeys) {
         isBlocked = rules.premium_large_salad.blockedGroupKeys.some(blockedKey => matchSaladGroupKey(group.key, blockedKey));
       } else {
         isBlocked = SALAD_EXCLUDED_GROUP_KEYS.has(String(group.key || "").toLowerCase());
       }
       if (rules && rules.premium_large_salad && rules.premium_large_salad.groups) {
          const gRule = rules.premium_large_salad.groups.find(g => matchSaladGroupKey(g.groupKey, group.key));
          if (gRule && gRule.enabled === false) isBlocked = true;
          if (gRule && gRule.minSelections !== undefined) minSelections = Number(gRule.minSelections);
          if (gRule && gRule.maxSelections !== undefined) maxSelections = Number(gRule.maxSelections);
       }
    }
    if (isBlocked) return null;
    
    addMembership(membership, selectionType, product._id, group._id);
    const optionItems = docs.optionRelations
      .filter((optionRelation) => String(optionRelation.productId) === String(product._id) && String(optionRelation.groupId) === String(group._id))
      .filter((optionRelation) => includeUnavailable || relationReady(optionRelation))
      .map((optionRelation) => ({ relation: optionRelation, option: docs.optionsById.get(String(optionRelation.optionId)) }))
      .filter(({ option }) => option && (includeUnavailable || customerReady(option, docs.catalogItemsById)))
      .filter(({ option }) => {
         if (
           selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL
           && premiumConfigState?.hasConfigs
           && !premiumConfigState.isAllowed(option.premiumKey || option.key)
         ) {
           return false;
         }
         if (selectionType !== MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD) return true;
         if (rules && rules.premium_large_salad && rules.premium_large_salad.groups) {
            const gRule = rules.premium_large_salad.groups.find(g => matchSaladGroupKey(g.groupKey, group.key));
            if (gRule && Array.isArray(gRule.allowedOptionKeys) && gRule.allowedOptionKeys.length > 0) {
               return gRule.allowedOptionKeys.includes(option.key) || gRule.allowedOptionKeys.includes(option.premiumKey) || gRule.allowedOptionKeys.includes(optionIdentity(option));
            }
         }
         return String(group.key || "") !== "proteins" || isSaladAllowedProtein(option);
      })
      .sort((a, b) => Number(a.relation.sortOrder || 0) - Number(b.relation.sortOrder || 0))
      .map(({ relation: optionRelation, option }) => {
        addMembership(membership, selectionType, product._id, group._id, option._id);
        return buildOptionItem({ option, relation: optionRelation, group, product, selectionType, lang, rules, premiumConfigState });
      });
    return {
      id: String(group._id),
      groupId: String(group._id),
      key: group.key || "",
      name: pickLang(group.name, lang),
      nameI18n: group.name || {},
      minSelections,
      maxSelections,
      required: Boolean(relation.isRequired) || minSelections > 0,
      sortOrder: Number(relation.sortOrder || group.sortOrder || 0),
      items: optionItems,
      options: optionItems,
    };
  }).filter(Boolean);
}

function plannerOptionFromBuilderItem(item = {}) {
  return {
    id: item.id,
    optionId: item.id,
    key: item.key || "",
    name: item.name || "",
    nameI18n: item.nameI18n || {},
    imageUrl: item.imageUrl || "",
    selectionType: item.selectionType || "",
    isPremium: item.isPremium === true,
    premiumKey: item.premiumKey || undefined,
    premiumKind: item.premiumKind || undefined,
    extraPriceHalala: Number(item.priceHalala || item.extraPriceHalala || 0),
    extraFeeHalala: Number(item.premiumPriceHalala || item.extraFeeHalala || 0),
    sortOrder: Number(item.sortOrder || 0),
  };
}

function plannerGroupFromOptionSection(section = {}) {
  const optionItems = (section.items || []).filter((item) => item.type === "option");
  return {
    id: section.sourceGroupId,
    groupId: section.sourceGroupId,
    key: section.groupKey || "",
    sourceKey: section.groupKey || "",
    name: section.title || "",
    nameI18n: section.titleI18n || {},
    minSelections: Number(section.minSelections || 0),
    maxSelections: section.maxSelections === null || section.maxSelections === undefined ? null : Number(section.maxSelections),
    required: Boolean(section.required),
    isRequired: Boolean(section.required),
    sortOrder: Number(section.sortOrder || 0),
    options: optionItems.map(plannerOptionFromBuilderItem),
  };
}

function plannerProductFromContext(section = {}) {
  const context = section.productContext || {};
  return {
    id: section.productContextId,
    productId: section.productContextId,
    key: section.productKey || context.key || "",
    name: context.name || "",
    nameI18n: context.nameI18n || {},
    itemType: context.itemType || "product",
    selectionType: section.selectionType || "",
    pricing: {
      model: context.pricingModel || "",
      basePriceHalala: Number(context.priceHalala || 0),
      currency: context.currency || SYSTEM_CURRENCY,
    },
    action: { type: "open_builder", requiresBuilder: true },
    optionGroups: [plannerGroupFromOptionSection(section)].filter((group) => group.options.length),
  };
}

function plannerProductFromBuilderProduct(item = {}) {
  return {
    id: item.id,
    productId: item.id,
    key: item.key || "",
    name: item.name || "",
    nameI18n: item.nameI18n || {},
    imageUrl: item.imageUrl || "",
    itemType: item.itemType || "product",
    selectionType: item.selectionType || "",
    premiumKey: item.premiumKey || undefined,
    premiumKind: item.premiumKind || undefined,
    pricing: {
      priceHalala: Number(item.priceHalala || 0),
      extraFeeHalala: Number(item.premiumPriceHalala || 0),
      currency: SYSTEM_CURRENCY,
    },
    action: item.action || { type: "open_builder", requiresBuilder: true },
    optionGroups: (item.optionGroups || []).map((group) => ({
      id: group.id || group.groupId,
      groupId: group.groupId || group.id,
      key: group.key || "",
      sourceKey: group.key || "",
      name: group.name || "",
      nameI18n: group.nameI18n || {},
      minSelections: Number(group.minSelections || 0),
      maxSelections: group.maxSelections === null || group.maxSelections === undefined ? null : Number(group.maxSelections),
      required: Boolean(group.required),
      isRequired: Boolean(group.required),
      sortOrder: Number(group.sortOrder || 0),
      options: (group.options || group.items || []).map(plannerOptionFromBuilderItem),
    })),
    sortOrder: Number(item.sortOrder || 0),
  };
}

function plannerSectionFromBuilderSection(section = {}) {
  const productItems = (section.items || []).filter((item) => item.type === "product");
  const products = [];
  if (section.sectionType === "option_group") {
    const contextProduct = plannerProductFromContext(section);
    if (contextProduct.optionGroups.length) products.push(contextProduct);
  }
  products.push(...productItems.map(plannerProductFromBuilderProduct));

  return {
    id: `section:${section.key || section.selectionType || section.sortOrder}`,
    key: section.key || section.selectionType || "",
    type: section.sectionType === "product_category" || section.sectionType === "product_list" ? "product_list" : "configurable_product",
    builderSectionType: section.type || canonicalSectionType(section),
    source: section.source || canonicalSectionSource(section),
    name: section.title || "",
    nameI18n: section.titleI18n || {},
    sortOrder: Number(section.sortOrder || 0),
    ui: section.metadata || {},
    rules: canonicalSectionRules(section),
    products,
  };
}

function filterPlannerSectionByPremiumConfig(section, premiumConfigState) {
  if (!premiumConfigState?.hasConfigs) return section;
  const products = (section.products || []).map((product) => {
    if (
      product.selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD
      && !premiumConfigState.isAllowed(PREMIUM_LARGE_SALAD_PREMIUM_KEY)
    ) {
      return null;
    }
    const optionGroups = (product.optionGroups || []).map((group) => ({
      ...group,
      options: (group.options || []).filter((option) => {
        const optionLooksPremium = option.isPremium === true || option.premiumKey || option.selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL;
        if (product.selectionType !== MEAL_SELECTION_TYPES.PREMIUM_MEAL && !optionLooksPremium) {
          return true;
        }
        return premiumConfigState.isAllowed(option.premiumKey || option.key);
      }),
    })).filter((group) => (group.options || []).length);
    return { ...product, optionGroups };
  }).filter((product) => product && (product.selectionType === MEAL_SELECTION_TYPES.SANDWICH || (product.optionGroups || []).length || product.selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD));
  return { ...section, products };
}

async function buildPlannerCatalogFromPublishedBuilder({ lang = "en", config = null } = {}) {
  const published = config || await getCurrentPublishedConfig();
  if (!published) return null;
  const contract = await buildPublishedContract({ config: published, lang });
  const premiumConfigState = await loadClientPremiumUpgradeConfigState();
  const sections = (contract.sections || [])
    .map(plannerSectionFromBuilderSection)
    .map((section) => filterPlannerSectionByPremiumConfig(section, premiumConfigState))
    .filter((section) => section.products.length)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const stablePayload = {
    contractVersion: "meal_planner_menu.v3",
    currency: SYSTEM_CURRENCY,
    sections,
    rules: {
      ...getMealPlannerRules(),
      source: "meal_builder_config",
      builderRevisionHash: contract.revisionHash,
    },
  };
  return {
    ...stablePayload,
    catalogHash: stableHash(stablePayload),
    publishedVersionId: null,
    builderRevisionHash: contract.revisionHash,
    source: published.source || "dashboard",
  };
}

async function buildPublishedMembership() {
  const published = await getCurrentPublishedConfig();
  if (!published || published.source === "system") return { hasPublishedConfig: false, membership: createEmptyMembership(), revisionHash: null };
  const contract = await buildPublishedContract({ config: published, lang: "en" });
  return {
    hasPublishedConfig: true,
    membership: contract.membership,
    revisionHash: contract.revisionHash,
  };
}

function isProductIncluded(membership, selectionType, productId) {
  const scoped = membership.bySelectionType.get(selectionType || "");
  return Boolean(scoped && scoped.products.has(String(productId)));
}

function isGroupIncluded(membership, selectionType, productId, groupId) {
  const scoped = membership.bySelectionType.get(selectionType || "");
  return Boolean(scoped && scoped.groups.has(`${String(productId)}:${String(groupId)}`));
}

function isOptionIncluded(membership, selectionType, productId, groupId, optionId) {
  const scoped = membership.bySelectionType.get(selectionType || "");
  return Boolean(scoped && scoped.options.has(`${String(productId)}:${String(groupId)}:${String(optionId)}`));
}

async function getReadinessReport() {
  const [draft, published] = await Promise.all([
    getCurrentDraftConfig(),
    getCurrentPublishedConfig({ allowVirtualFallback: true }),
  ]);
  if (!published) {
    const errors = [{ level: "error", code: "MEAL_BUILDER_NOT_PUBLISHED", message: "No published Meal Builder config exists" }];
    if (!draft) errors.unshift({ level: "error", code: "MEAL_BUILDER_DRAFT_NOT_FOUND", message: "No current Meal Builder draft exists" });
    return {
      status: "error",
      ready: false,
      errors,
      warnings: [],
      checks: errors,
      summary: { draft: Boolean(draft), published: false, sections: 0, errors: errors.length, warnings: 0 },
    };
  }
  const validation = await validateConfigObject(published);
  const errors = [...validation.errors];
  if (!draft) {
    errors.unshift({ level: "error", code: "MEAL_BUILDER_DRAFT_NOT_FOUND", message: "No current Meal Builder draft exists" });
  }
  const ready = validation.ready && Boolean(draft);
  const status = errors.length ? "error" : validation.status;
  return {
    ...validation,
    status,
    ready,
    errors,
    checks: [...errors, ...validation.warnings],
    summary: {
      ...validation.summary,
      draft: Boolean(draft),
      published: true,
      revisionHash: published.revisionHash || "",
      route: "/api/dashboard/meal-builder/readiness",
    },
  };
}

async function validatePayload(payload = {}) {
  return validateConfigObject({ sections: await normalizeSectionsForWrite(payload.sections || []) });
}

module.exports = {
  CONTRACT_VERSION,
  MealBuilderError,
  buildDefaultSeedSections,
  buildDefaultVisualTemplateSections,
  buildPlannerCatalogFromPublishedBuilder,
  buildPublishedContract,
  buildPublishedMembership,
  computeRevisionHash,
  createDraft,
  getCurrentPublishedConfig,
  getDashboardState,
  getHydratedDraft,
  getReadinessReport,
  getSectionPicker,
  isGroupIncluded,
  isOptionIncluded,
  isProductIncluded,
  normalizeSections,
  publishDraft,
  updateDraft,
  validateConfigObject,
  validatePayload,
};
