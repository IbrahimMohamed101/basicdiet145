const SYSTEM_CURRENCY = "SAR";

const MEAL_PLANNER_RULES_VERSION = "meal_planner_rules.v3";

const MEAL_SELECTION_TYPES = Object.freeze({
  STANDARD_MEAL: "standard_meal",
  PREMIUM_MEAL: "premium_meal",
  PREMIUM_LARGE_SALAD: "premium_large_salad",
  SANDWICH: "sandwich",
});

const LEGACY_MEAL_SELECTION_TYPES = Object.freeze({
  STANDARD_COMBO: "standard_combo",
  CUSTOM_PREMIUM_SALAD: "custom_premium_salad",
  SANDWICH: "sandwich",
});

const SANDWICH_CATEGORY_KEYS = Object.freeze(["sandwich", "sandwiches"]);

const STANDARD_CARB_CATEGORY_KEY = "standard_carbs";
const LARGE_SALAD_CATEGORY_KEY = "large_salad";

const PREMIUM_LARGE_SALAD_PREMIUM_KEY = "custom_premium_salad";
const PREMIUM_LARGE_SALAD_PRESET_KEY = LARGE_SALAD_CATEGORY_KEY;
const PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA = 3000;

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
  { key: "fish", name: { ar: "أسماك", en: "Fish" }, familyKey: "fish", sortOrder: 30 },
  { key: "eggs", name: { ar: "بيض", en: "Eggs" }, familyKey: "eggs", sortOrder: 40 },
  { key: "premium", name: { ar: "بريميوم", en: "Premium" }, familyKey: null, sortOrder: 50 },
  { key: "other", name: { ar: "أخرى", en: "Other" }, familyKey: "other", sortOrder: 60 },
]);

const PROTEIN_DISPLAY_GROUP_KEYS = new Set(PROTEIN_DISPLAY_GROUPS.map((group) => group.key));

const SALAD_SELECTION_GROUPS = Object.freeze([
  { key: "leafy_greens", name: { ar: "ورقيات", en: "Leafy Greens" }, minSelect: 0, maxSelect: 99, sortOrder: 10, source: "ingredient" },
  { key: "vegetables", name: { ar: "خضار", en: "Vegetables" }, minSelect: 0, maxSelect: 99, sortOrder: 20, source: "ingredient" },
  { key: "protein", name: { ar: "بروتين", en: "Protein" }, minSelect: 1, maxSelect: 1, sortOrder: 30, source: "protein" },
  { key: "cheese_nuts", name: { ar: "أجبان ومكسرات", en: "Cheese & Nuts" }, minSelect: 0, maxSelect: 99, sortOrder: 40, source: "ingredient" },
  { key: "fruits", name: { ar: "فواكه", en: "Fruits" }, minSelect: 0, maxSelect: 99, sortOrder: 50, source: "ingredient" },
  { key: "sauce", name: { ar: "صوص", en: "Sauce" }, minSelect: 1, maxSelect: 1, sortOrder: 60, source: "ingredient" },
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
      groups: SALAD_SELECTION_GROUPS.map((group) => ({
        key: group.key,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
      })),
    },
  };
}

function getMealPlannerCategoryDefinition({ key, dimension }) {
  return MEAL_PLANNER_CATEGORY_MAP.get(`${dimension}:${key}`) || null;
}

module.exports = {
  BEEF_DAILY_LIMIT,
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
  SALAD_INGREDIENT_GROUP_KEYS,
  SALAD_SELECTION_GROUPS,
  SANDWICH_CATEGORY_KEYS,
  STANDARD_CARB_CATEGORY_KEY,
  STANDARD_CARB_RULES,
  SYSTEM_CURRENCY,
  getMealPlannerCategoryDefinition,
  getMealPlannerRules,
  normalizeProteinDisplayCategoryKey,
  normalizeProteinFamilyKey,
  normalizeSaladIngredientGroupKey,
};
