const { pickLang } = require("./i18n");

const UNCATEGORIZED_MEAL_SECTION_KEY = "__uncategorized__";

function resolveSortValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCategoryKey(value) {
  if (value === undefined || value === null) return "";

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\p{Letter}\p{Number}_]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return normalized;
}

function isAsciiText(value) {
  return /^[\x00-\x7F]+$/.test(String(value || ""));
}

function titleCaseWords(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function humanizeCategoryKey(key, lang = "ar") {
  const normalizedKey = normalizeCategoryKey(key);
  if (!normalizedKey) {
    return lang === "en" ? "Other Meals" : "وجبات أخرى";
  }

  const rawText = normalizedKey.replace(/[_-]+/g, " ").trim();
  if (!rawText) {
    return lang === "en" ? "Other Meals" : "وجبات أخرى";
  }

  return isAsciiText(rawText) ? titleCaseWords(rawText) : rawText;
}

function resolveMealCategoryEntry(doc, lang = "ar") {
  if (!doc) return null;

  const key = normalizeCategoryKey(doc.key);
  return {
    id: doc._id ? String(doc._id) : null,
    key,
    name: pickLang(doc.name, lang) || humanizeCategoryKey(key, lang),
    description: pickLang(doc.description, lang) || "",
    sortOrder: resolveSortValue(doc.sortOrder),
    isActive: doc.isActive !== false,
    isFallback: false,
  };
}

function buildFallbackMealCategoryEntry(categoryKey, lang = "ar") {
  const normalizedKey = normalizeCategoryKey(categoryKey);
  const key = normalizedKey || UNCATEGORIZED_MEAL_SECTION_KEY;

  return {
    id: null,
    key,
    name: humanizeCategoryKey(normalizedKey, lang),
    description: "",
    sortOrder: Number.MAX_SAFE_INTEGER,
    isActive: true,
    isFallback: true,
  };
}

function buildMealCategoryMap(categoryDocs = [], lang = "ar") {
  const map = new Map();

  for (const doc of Array.isArray(categoryDocs) ? categoryDocs : []) {
    const entry = resolveMealCategoryEntry(doc, lang);
    if (!entry) continue;
    if (entry.id) {
      map.set(String(entry.id), entry);
    }
    if (entry.key) {
      map.set(String(entry.key), entry);
    }
  }

  return map;
}

function resolveMealCategoryForKey(categoryId, categoryMap, lang = "ar") {
  const normalizedValue = normalizeCategoryKey(categoryId);
  if (normalizedValue && categoryMap && categoryMap.has(normalizedValue)) {
    return categoryMap.get(normalizedValue);
  }
  const rawValue = categoryId ? String(categoryId) : "";
  if (rawValue && categoryMap && categoryMap.has(rawValue)) {
    return categoryMap.get(rawValue);
  }
  return null;
}

function sortMealSectionEntries(a, b) {
  const sortDiff = resolveSortValue(a && a.category && a.category.sortOrder)
    - resolveSortValue(b && b.category && b.category.sortOrder);
  if (sortDiff !== 0) return sortDiff;

  const aName = String(a && a.category && a.category.name ? a.category.name : "");
  const bName = String(b && b.category && b.category.name ? b.category.name : "");
  return aName.localeCompare(bName);
}

function buildMealSections({ meals = [], categoryDocs = [], lang = "ar", itemResolver } = {}) {
  const categoryMap = buildMealCategoryMap(categoryDocs, lang);
  const sectionsByKey = new Map();

  for (const meal of Array.isArray(meals) ? meals : []) {
    const category = resolveMealCategoryForKey(
      meal && (meal.categoryId !== undefined && meal.categoryId !== null ? meal.categoryId : meal.category),
      categoryMap,
      lang
    );
    if (!category) continue;
    if (!sectionsByKey.has(category.key)) {
      sectionsByKey.set(category.key, { category, items: [] });
    }

    const item = typeof itemResolver === "function" ? itemResolver(meal, category) : meal;
    sectionsByKey.get(category.key).items.push(item);
  }

  return Array.from(sectionsByKey.values()).sort(sortMealSectionEntries);
}

module.exports = {
  UNCATEGORIZED_MEAL_SECTION_KEY,
  normalizeCategoryKey,
  humanizeCategoryKey,
  resolveMealCategoryEntry,
  resolveMealCategoryForKey,
  buildMealCategoryMap,
  buildMealSections,
};
