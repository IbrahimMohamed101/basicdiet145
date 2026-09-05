const SYSTEM_CURRENCY = "SAR";

const MEAL_PLANNER_RULES_VERSION = "meal_planner_rules.v3";

const MEAL_SELECTION_TYPES = Object.freeze({
  STANDARD_MEAL: "standard_meal",
  PREMIUM_MEAL: "premium_meal",
  PREMIUM_LARGE_SALAD: "premium_large_salad",
  SANDWICH: "sandwich",
  FULL_MEAL_PRODUCT: "full_meal_product",
});

const CUSTOM_PREMIUM_SALAD_KEY = "custom_premium_salad";

const LEGACY_MEAL_SELECTION_TYPES = Object.freeze({
  STANDARD_COMBO: "standard_combo",
  CUSTOM_PREMIUM_SALAD: CUSTOM_PREMIUM_SALAD_KEY,
  SANDWICH: "sandwich",
});

const SANDWICH_CATEGORY_KEYS = Object.freeze(["sandwich", "sandwiches"]);

const STANDARD_CARB_CATEGORY_KEY = "standard_carbs";
const LARGE_SALAD_CATEGORY_KEY = "large_salad";

const PREMIUM_LARGE_SALAD_PREMIUM_KEY = MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD;
const PREMIUM_LARGE_SALAD_PRESET_KEY = LARGE_SALAD_CATEGORY_KEY;
const PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA = 2900;

// Exact customer-visible Basic Meal carb menu. Historical/other-context carb
// records may continue to exist, but they must not be offered for new Basic Meal picks.
const CUSTOMER_VISIBLE_CARB_KEYS = Object.freeze([
  "lentil_rice",
  "javanese_white_rice",
  "basmati_white_rice",
  "mashed_potatoes",
  "roasted_potatoes",
  "sweet_potatoes",
  "mixed_vegetables",
  "red_sauce_pasta",
  "white_pasta",
]);

const STANDARD_MEAL_PROTEIN_KEYS = Object.freeze([
  "chicken",
  "beef",
  "fish",
  "eggs",
]);

// Exact regular Basic Meal proteins plus the two preserved paid regular options
// and the three existing premium proteins. Availability is still enforced by
// MenuOption/ProductGroupOption state; this list only defines recognized picker keys.
const STANDARD_MEAL_EXTENDED_PROTEIN_KEYS = Object.freeze([
  // final regular chicken family
  "grilled_chicken",
  "mexican_chicken",
  "creamy_chicken",
  "lemon_bbq_chicken",
  "chicken_65",
  "chicken_with_okra",
  "shish_tawook",
  "asian_chicken",
  // final regular beef family
  "kofta",
  "mushroom_beef",
  "asian_beef",
  // preserved paid regular beef options
  "meatballs",
  "beef_stroganoff",
  // final regular fish family
  "creamy_fish",
  "grilled_fish",
  // existing premium family (kept unchanged)
  "beef_steak",
  "shrimp",
  "salmon",
]);

const STANDARD_MEAL_EXTENDED_PROTEIN_KEY_SET = new Set(STANDARD_MEAL_EXTENDED_PROTEIN_KEYS);

const PREMIUM_MEAL_PROTEIN_KEYS = Object.freeze([
  "beef_steak",
  "shrimp",
  "salmon",
]);

const SUBSCRIPTION_COLD_SANDWICH_KEYS = Object.freeze([
  "boiled_egg_cold_sandwich",
  "turkey_cold_sandwich",
  "classic_halloumi_cold_sandwich",
  "tuna_cold_sandwich",
  "scrambled_egg_cold_sandwich",
  "chicken_fajita_cold_sandwich",
  "mexican_chicken_cold_sandwich",
  "grilled_chicken_cold_sandwich",
]);

const STANDARD_CARB_RULES = Object.freeze({
  maxTypes: 2,
  maxTotalGrams: 300,
  unit: "grams",
});

const BEEF_DAILY_LIMIT = 1;

const PROTEIN_FAMILY_KEYS = Object.freeze([
  "chicken",
  "beef",
  "fish",
  "eggs",
  "other",
]);

const LEGACY_PROTEIN_FAMILY_ALIASES = Object.freeze({
  seafood: "fish",
});

const PROTEIN_DISPLAY_GROUPS = Object.freeze([
  { key: "chicken", name: { ar: "دجاج", en: "Chicken" }, familyKey: "chicken", sortOrder: 10 },
  { key: "beef", name: { ar: "لحم", en: "Beef" }, familyKey: "beef", sortOrder: 20, rules: { dailyLimit: BEEF_DAILY_LIMIT, ruleKey: "beef_daily_limit", unit: "slots" } },
  { key: "fish", name: { ar: "سمك", en: "Fish" }, familyKey: "fish", sortOrder: 30 },
  { key: "eggs", name: { ar: "بيض", en: "Eggs" }, familyKey: "eggs", sortOrder: 40 },
  { key: "premium", name: { ar: "بريميوم", en: "Premium" }, familyKey: null, sortOrder: 50 },
  { key: "other", name: { ar: "أخرى", en: "Other" }, familyKey: "other", sortOrder: 60 },
]);

const PROTEIN_DISPLAY_GROUP_KEYS = new Set(PROTEIN_DISPLAY_GROUPS.map((group) => group.key));

// Visual families used by buildProteinOptionSections to build optionSections tabs.
// Includes "premium" tab so that premium proteins (beef_steak, shrimp, salmon)
// can be displayed under a separate Tab inside the standard_meal protein picker.
const PROTEIN_VISUAL_FAMILIES = Object.freeze(
  PROTEIN_DISPLAY_GROUPS.filter((group) => ["chicken", "beef", "fish", "eggs", "premium"].includes(group.key))
);

// Families that are shown as tabs in the Flutter protein picker for standard_meal.
// The "premium" family maps to the premium proteins with extra fee.
const STANDARD_MEAL_PROTEIN_TAB_KEYS = Object.freeze(["chicken", "beef", "fish", "eggs", "premium"]);

// Maps each protein option key to its visual family tab. Keep legacy mappings used
// by premium salad/other contexts and add the final Basic Meal canonical keys.
const PROTEIN_VISUAL_FAMILY_OPTION_KEYS = Object.freeze({
  // final Basic Meal chicken
  grilled_chicken: "chicken",
  mexican_chicken: "chicken",
  creamy_chicken: "chicken",
  lemon_bbq_chicken: "chicken",
  chicken_65: "chicken",
  chicken_with_okra: "chicken",
  shish_tawook: "chicken",
  asian_chicken: "chicken",
  // final Basic Meal beef + preserved paid regular beef
  kofta: "beef",
  mushroom_beef: "beef",
  asian_beef: "beef",
  meatballs: "beef",
  beef_stroganoff: "beef",
  // final Basic Meal fish
  creamy_fish: "fish",
  grilled_fish: "fish",
  // legacy mappings still used outside the normalized Basic Meal regular menu
  chicken: "chicken",
  chicken_fajita: "chicken",
  spicy_chicken: "chicken",
  italian_spiced_chicken: "chicken",
  chicken_tikka: "chicken",
  chicken_strips: "chicken",
  beef: "beef",
  fish: "fish",
  fish_fillet: "fish",
  tuna: "fish",
  eggs: "eggs",
  boiled_eggs: "eggs",
});

const SALAD_SELECTION_GROUPS = Object.freeze([
  { key: "leafy_greens", name: { ar: "ورقيات", en: "Leafy Greens" }, minSelect: 0, maxSelect: 2, sortOrder: 10, source: "ingredient" },
  { key: "vegetables", name: { ar: "خضار", en: "Vegetables" }, minSelect: 0, maxSelect: 19, sortOrder: 20, source: "ingredient" },
  { key: "protein", name: { ar: "بروتين", en: "Protein" }, minSelect: 1, maxSelect: 1, sortOrder: 30, source: "protein" },
  { key: "cheese_nuts", name: { ar: "أجبان ومكسرات", en: "Cheese & Nuts" }, minSelect: 0, maxSelect: 2, sortOrder: 40, source: "ingredient" },
  { key: "fruits", name: { ar: "فواكه", en: "Fruits" }, minSelect: 0, maxSelect: 4, sortOrder: 50, source: "ingredient" },
  { key: "sauce", name: { ar: "صوص", en: "Sauce" }, minSelect: 1, maxSelect: 1, sortOrder: 60, source: "ingredient" },
  { key: "extra_protein_50g", name: { ar: "إضافة بروتين", en: "Extra Protein" }, minSelect: 0, maxSelect: 1, sortOrder: 70, source: "option" },
]);

const SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS = Object.freeze([
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
  "fish_fillet",
]);

const SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS = Object.freeze([
  "extra_protein_50g",
]);

const SALAD_INGREDIENT_GROUP_KEYS = new Set(
  SALAD_SELECTION_GROUPS
    .filter((group) => group.source === "ingredient")
    .map((group) => group.key)
);

const LEGACY_SALAD_GROUP_ALIASES = Object.freeze({
  addons: "cheese_nuts",
  nuts: "cheese_nuts",
});

const MEAL_PLANNER_CATEGORY_DEFINITIONS = Object.freeze([
  {
    key: STANDARD_CARB_CATEGORY_KEY,
    dimension: "carb",
    name: { ar: "كربوهيدرات", en: "Standard Carbs" },
    description: { ar: "اختيارات الكربوهيدرات للوجبات", en: "Carb selections for plate meals" },
    sortOrder: 10,
    rules: {
      maxTypes: STANDARD_CARB_RULES.maxTypes,
      maxTotalGrams: STANDARD_CARB_RULES.maxTotalGrams,
      unit: STANDARD_CARB_RULES.unit,
      ruleKey: "carb_split",
    },
  },
  {
    key: LARGE_SALAD_CATEGORY_KEY,
    dimension: "carb",
    name: { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" },
    description: { ar: "الهوية المرجعية للسلطة الكبيرة المميزة", en: "Reference identity for premium large salad" },
    sortOrder: 20,
    rules: {
      ruleKey: "premium_large_salad",
    },
  },
  ...PROTEIN_DISPLAY_GROUPS.map((group) => ({
    key: group.key,
    dimension: "protein",
    name: group.name,
    description: group.key === "premium"
      ? { ar: "خيارات البروتينات المميزة", en: "Premium protein options" }
      : { ar: `خيارات ${group.name.ar}`, en: `${group.name.en} protein options` },
    sortOrder: group.sortOrder,
    rules: group.rules || {},
  })),
]);

const MEAL_PLANNER_CATEGORY_MAP = new Map(
  MEAL_PLANNER_CATEGORY_DEFINITIONS.map((definition) => [`${definition.dimension}:${definition.key}`, definition])
);

function clone(value) {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeProteinFamilyKey(value, fallback = "other") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (PROTEIN_FAMILY_KEYS.includes(raw)) return raw;
  if (LEGACY_PROTEIN_FAMILY_ALIASES[raw]) return LEGACY_PROTEIN_FAMILY_ALIASES[raw];
  return fallback;
}

function normalizeProteinDisplayCategoryKey(value, { isPremium = false, proteinFamilyKey = null } = {}) {
  if (isPremium) return "premium";

  const raw = String(value || "").trim().toLowerCase();
  if (PROTEIN_DISPLAY_GROUP_KEYS.has(raw) && raw !== "premium") {
    return raw;
  }

  if (raw === "seafood") return "fish";
  if (raw === "standard_proteins" || raw === "protein_category") {
    return normalizeProteinFamilyKey(proteinFamilyKey);
  }

  return normalizeProteinFamilyKey(raw || proteinFamilyKey);
}

function normalizeSaladIngredientGroupKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (SALAD_INGREDIENT_GROUP_KEYS.has(raw)) return raw;
  if (LEGACY_SALAD_GROUP_ALIASES[raw]) return LEGACY_SALAD_GROUP_ALIASES[raw];
  return "";
}

function getMealPlannerRules() {
  return {
    version: MEAL_PLANNER_RULES_VERSION,
    beef: {
      proteinFamilyKey: "beef",
      maxSlotsPerDay: BEEF_DAILY_LIMIT,
    },
    standardCarbs: clone(STANDARD_CARB_RULES),
    premiumCarbs: clone(STANDARD_CARB_RULES),
    proteinGroups: PROTEIN_DISPLAY_GROUPS.map((group) => ({
      key: group.key,
      name: clone(group.name),
      sortOrder: group.sortOrder,
    })),
    premiumLargeSalad: {
      premiumKey: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
      presetKey: PREMIUM_LARGE_SALAD_PRESET_KEY,
      extraFeeHalala: PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
      groups: SALAD_SELECTION_GROUPS
        .filter((group) => !SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS.includes(group.key))
        .map((group) => ({
          key: group.key,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
        })),
      allowedProteinKeys: [...SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS],
      excludedGroupKeys: [...SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS],
    },
  };
}

function getMealPlannerCategoryDefinition({ key, dimension }) {
  return MEAL_PLANNER_CATEGORY_MAP.get(`${dimension}:${key}`) || null;
}

function getProteinVisualFamilyDefinition(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  // Direct lookup in PROTEIN_VISUAL_FAMILIES (supports "premium" tab)
  const direct = PROTEIN_VISUAL_FAMILIES.find((family) => family.key === raw);
  if (direct) return direct;
  // Fallback: normalize via family map (e.g. aliases)
  const normalized = normalizeProteinFamilyKey(raw, "");
  return normalized ? (PROTEIN_VISUAL_FAMILIES.find((family) => family.key === normalized) || null) : null;
}

function normalizeExplicitProteinFamilyKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  return PROTEIN_FAMILY_KEYS.includes(raw) ? raw : "";
}

/**
 * Canonical MenuOption family policy shared by customer serialization,
 * Dashboard pickers, and Meal Builder write validation.
 *
 * Priority for normal proteins:
 *   1. valid explicit proteinFamilyKey
 *   2. compatible explicit displayCategoryKey
 *   3. legacy static option-key mapping
 *   4. unknown (fail closed)
 *
 * Premium remains a separate visual/system-managed classification. Invalid or
 * conflicting explicit metadata never falls through to a legacy key mapping.
 */
function resolveProteinFamilyClassification(option = {}) {
  // Final catalog metadata is authoritative. Dashboard premium configuration may
  // promote any protein option, including one whose default visual family is
  // defined below, so premium overrides must win before sections are generated.
  const displayCategoryKey = String(option.displayCategoryKey || "").trim().toLowerCase();
  const selectionType = String(option.selectionType || "").trim().toLowerCase();
  if (option.isPremium === true || displayCategoryKey === "premium" || selectionType === "premium_meal") {
    return { familyKey: "premium", source: "premium", valid: true, premium: true, reasonCode: "" };
  }

  const rawProteinFamilyKey = String(option.proteinFamilyKey || "").trim().toLowerCase();
  const explicitFamilyKey = normalizeExplicitProteinFamilyKey(rawProteinFamilyKey);
  if (rawProteinFamilyKey && !explicitFamilyKey) {
    return {
      familyKey: "",
      source: "proteinFamilyKey",
      valid: false,
      premium: false,
      reasonCode: "INVALID_PROTEIN_FAMILY_KEY",
    };
  }

  const displayFamilyDefinition = getProteinVisualFamilyDefinition(displayCategoryKey);
  const displayFamilyKey = displayFamilyDefinition && displayFamilyDefinition.key !== "premium"
    ? displayFamilyDefinition.key
    : "";
  if (displayCategoryKey && !displayFamilyKey) {
    return {
      familyKey: "",
      source: "displayCategoryKey",
      valid: false,
      premium: false,
      reasonCode: "INVALID_PROTEIN_DISPLAY_CATEGORY_KEY",
    };
  }
  if (explicitFamilyKey && displayFamilyKey && explicitFamilyKey !== displayFamilyKey) {
    return {
      familyKey: "",
      source: "explicit_conflict",
      valid: false,
      premium: false,
      reasonCode: "PROTEIN_FAMILY_DISPLAY_CONFLICT",
    };
  }
  if (explicitFamilyKey) {
    return {
      familyKey: explicitFamilyKey,
      source: "proteinFamilyKey",
      valid: true,
      premium: false,
      reasonCode: "",
    };
  }
  if (displayFamilyKey) {
    return {
      familyKey: displayFamilyKey,
      source: "displayCategoryKey",
      valid: true,
      premium: false,
      reasonCode: "",
    };
  }

  // Legacy compatibility only. New authoring must persist explicit metadata.
  const optionKey = String(option.key || option.premiumKey || "").trim().toLowerCase();
  if (optionKey && optionKey in PROTEIN_VISUAL_FAMILY_OPTION_KEYS) {
    const tabKey = PROTEIN_VISUAL_FAMILY_OPTION_KEYS[optionKey];
    const tabFamily = getProteinVisualFamilyDefinition(tabKey);
    if (tabFamily) {
      return {
        familyKey: tabFamily.key,
        source: "legacy_static_key",
        valid: true,
        premium: false,
        reasonCode: "",
      };
    }
  }

  return {
    familyKey: "",
    source: "unknown",
    valid: false,
    premium: false,
    reasonCode: "PROTEIN_FAMILY_UNKNOWN",
  };
}

function resolveProteinVisualFamilyKey(option = {}) {
  return resolveProteinFamilyClassification(option).familyKey;
}

function getProteinFamilyNameI18n(optionOrFamilyKey = {}) {
  const familyKey = typeof optionOrFamilyKey === "string"
    ? optionOrFamilyKey
    : resolveProteinVisualFamilyKey(optionOrFamilyKey);
  const family = getProteinVisualFamilyDefinition(familyKey);
  return family ? clone(family.name) : null;
}

function buildProteinOptionSections(options = [], lang = "en") {
  const optionsByFamily = new Map(PROTEIN_VISUAL_FAMILIES.map((family) => [family.key, []]));

  for (const option of options || []) {
    const familyKey = resolveProteinVisualFamilyKey(option);
    if (!optionsByFamily.has(familyKey)) continue;
    optionsByFamily.get(familyKey).push(option);
  }

  return PROTEIN_VISUAL_FAMILIES
    .map((family) => {
      const familyOptions = optionsByFamily.get(family.key) || [];
      if (!familyOptions.length) return null;

      return {
        key: family.key,
        name: family.name[lang] || family.name.en,
        nameI18n: clone(family.name),
        optionKeys: familyOptions.map((option) => option.key).filter(Boolean),
        optionIds: familyOptions
          .map((option) => option.optionId || option.id || option._id)
          .filter(Boolean)
          .map((id) => String(id)),
      };
    })
    .filter(Boolean);
}

module.exports = {
  BEEF_DAILY_LIMIT,
  CUSTOMER_VISIBLE_CARB_KEYS,
  LARGE_SALAD_CATEGORY_KEY,
  LEGACY_MEAL_SELECTION_TYPES,
  LEGACY_PROTEIN_FAMILY_ALIASES,
  LEGACY_SALAD_GROUP_ALIASES,
  MEAL_PLANNER_CATEGORY_DEFINITIONS,
  MEAL_PLANNER_RULES_VERSION,
  MEAL_SELECTION_TYPES,
  PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
  PREMIUM_LARGE_SALAD_PRESET_KEY,
  PROTEIN_DISPLAY_GROUPS,
  PROTEIN_FAMILY_KEYS,
  PROTEIN_VISUAL_FAMILIES,
  PROTEIN_VISUAL_FAMILY_OPTION_KEYS,
  SALAD_INGREDIENT_GROUP_KEYS,
  SALAD_SELECTION_GROUPS,
  SANDWICH_CATEGORY_KEYS,
  STANDARD_CARB_CATEGORY_KEY,
  STANDARD_CARB_RULES,
  STANDARD_MEAL_PROTEIN_KEYS,
  STANDARD_MEAL_EXTENDED_PROTEIN_KEYS,
  STANDARD_MEAL_EXTENDED_PROTEIN_KEY_SET,
  STANDARD_MEAL_PROTEIN_TAB_KEYS,
  PREMIUM_MEAL_PROTEIN_KEYS,
  SUBSCRIPTION_COLD_SANDWICH_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
  SYSTEM_CURRENCY,
  buildProteinOptionSections,
  getProteinFamilyNameI18n,
  getMealPlannerCategoryDefinition,
  getMealPlannerRules,
  resolveProteinVisualFamilyKey,
  resolveProteinFamilyClassification,
  normalizeExplicitProteinFamilyKey,
  normalizeProteinDisplayCategoryKey,
  normalizeProteinFamilyKey,
  normalizeSaladIngredientGroupKey,
};
