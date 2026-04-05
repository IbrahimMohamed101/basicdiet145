const DEFAULT_MEAL_NUTRITION = Object.freeze({
  proteinGrams: 33,
  carbGrams: 37,
  fatGrams: 19,
});

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function getFirstDefined(body, keys) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  for (const key of keys) {
    if (hasOwn(body, key)) {
      return body[key];
    }
  }

  return undefined;
}

function normalizeNutritionNumber(value, fieldName, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be a number >= 0` };
  }

  return parsed;
}

function parseMealNutritionFromBody(body, { preserveMissing = false } = {}) {
  const mappings = [
    {
      field: "proteinGrams",
      aliases: ["proteinGrams", "protein"],
      fallback: DEFAULT_MEAL_NUTRITION.proteinGrams,
    },
    {
      field: "carbGrams",
      aliases: ["carbGrams", "carbsGrams", "carb", "carbs"],
      fallback: DEFAULT_MEAL_NUTRITION.carbGrams,
    },
    {
      field: "fatGrams",
      aliases: ["fatGrams", "fatsGrams", "fat", "fats"],
      fallback: DEFAULT_MEAL_NUTRITION.fatGrams,
    },
  ];

  const parsed = {};
  for (const mapping of mappings) {
    const rawValue = getFirstDefined(body, mapping.aliases);
    if (rawValue === undefined && preserveMissing) {
      continue;
    }

    parsed[mapping.field] = normalizeNutritionNumber(rawValue, mapping.field, mapping.fallback);
  }

  return Object.keys(parsed).length ? parsed : null;
}

function withDefaultMealNutrition(doc) {
  const source = doc && typeof doc === "object" ? doc : {};
  return {
    ...source,
    proteinGrams: normalizeNutritionNumber(
      source.proteinGrams,
      "proteinGrams",
      DEFAULT_MEAL_NUTRITION.proteinGrams
    ),
    carbGrams: normalizeNutritionNumber(
      source.carbGrams,
      "carbGrams",
      DEFAULT_MEAL_NUTRITION.carbGrams
    ),
    fatGrams: normalizeNutritionNumber(
      source.fatGrams,
      "fatGrams",
      DEFAULT_MEAL_NUTRITION.fatGrams
    ),
  };
}

module.exports = {
  DEFAULT_MEAL_NUTRITION,
  parseMealNutritionFromBody,
  withDefaultMealNutrition,
};
