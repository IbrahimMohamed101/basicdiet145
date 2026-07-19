"use strict";

const mongoose = require("mongoose");

const MenuAuditLog = require("../../models/MenuAuditLog");
const MenuOption = require("../../models/MenuOption");
const {
  MEAL_SELECTION_TYPES,
} = require("../../config/mealPlannerContract");

const OPTION_MEAL_METADATA_FIELDS = Object.freeze([
  "selectionType",
  "proteinFamilyKey",
  "displayCategoryKey",
  "premiumKey",
  "ruleTags",
  "nutrition",
  "availableForSubscription",
]);

const ALLOWED_SELECTION_TYPES = new Set([
  "",
  ...Object.values(MEAL_SELECTION_TYPES),
]);
const KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const NUTRITION_FIELDS = Object.freeze([
  "calories",
  "proteinGrams",
  "carbGrams",
  "fatGrams",
]);

class DashboardOptionMealMetadataError extends Error {
  constructor(message, code = "MENU_VALIDATION_ERROR", details) {
    super(message);
    this.name = "DashboardOptionMealMetadataError";
    this.status = 400;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function hasOwn(source, fieldName) {
  return Object.prototype.hasOwnProperty.call(source || {}, fieldName);
}

function hasOptionMealMetadata(body = {}) {
  return OPTION_MEAL_METADATA_FIELDS.some((fieldName) => hasOwn(body, fieldName));
}

function normalizeSelectionType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!ALLOWED_SELECTION_TYPES.has(normalized)) {
    throw new DashboardOptionMealMetadataError(
      "selectionType must be a canonical Meal Planner selection type",
      "INVALID_OPTION_SELECTION_TYPE",
      {
        value,
        allowedSelectionTypes: [...ALLOWED_SELECTION_TYPES],
      }
    );
  }
  return normalized;
}

function normalizeOptionalKey(value, fieldName) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (!KEY_PATTERN.test(normalized)) {
    throw new DashboardOptionMealMetadataError(
      `${fieldName} must be empty or snake_case`,
      "INVALID_OPTION_MEAL_METADATA_KEY",
      { fieldName, value }
    );
  }
  return normalized;
}

function normalizeBoolean(value, fieldName) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new DashboardOptionMealMetadataError(
    `${fieldName} must be boolean`,
    "INVALID_OPTION_MEAL_METADATA_BOOLEAN",
    { fieldName, value }
  );
}

function normalizeRuleTags(value) {
  if (!Array.isArray(value)) {
    throw new DashboardOptionMealMetadataError(
      "ruleTags must be an array",
      "INVALID_OPTION_RULE_TAGS"
    );
  }
  return [
    ...new Set(
      value
        .map((item) => normalizeOptionalKey(item, "ruleTags[]"))
        .filter(Boolean)
    ),
  ];
}

function normalizeNutrition(value, existingNutrition = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DashboardOptionMealMetadataError(
      "nutrition must be an object",
      "INVALID_OPTION_NUTRITION"
    );
  }

  const nutrition = {
    calories: Number(existingNutrition.calories || 0),
    proteinGrams: Number(existingNutrition.proteinGrams || 0),
    carbGrams: Number(existingNutrition.carbGrams || 0),
    fatGrams: Number(existingNutrition.fatGrams || 0),
  };

  for (const fieldName of NUTRITION_FIELDS) {
    if (!hasOwn(value, fieldName)) continue;
    const parsed = Number(value[fieldName]);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new DashboardOptionMealMetadataError(
        `nutrition.${fieldName} must be a number greater than or equal to zero`,
        "INVALID_OPTION_NUTRITION_VALUE",
        { fieldName, value: value[fieldName] }
      );
    }
    nutrition[fieldName] = parsed;
  }

  return nutrition;
}

function prepareOptionMealMetadataPatch(body = {}, existing = {}) {
  if (!hasOptionMealMetadata(body)) {
    return { hasChanges: false, patch: {} };
  }

  const patch = {};
  if (hasOwn(body, "selectionType")) {
    patch.selectionType = normalizeSelectionType(body.selectionType);
  }
  if (hasOwn(body, "proteinFamilyKey")) {
    patch.proteinFamilyKey = normalizeOptionalKey(
      body.proteinFamilyKey,
      "proteinFamilyKey"
    );
  }
  if (hasOwn(body, "displayCategoryKey")) {
    patch.displayCategoryKey = normalizeOptionalKey(
      body.displayCategoryKey,
      "displayCategoryKey"
    );
  }
  if (hasOwn(body, "premiumKey")) {
    patch.premiumKey = normalizeOptionalKey(body.premiumKey, "premiumKey");
  }
  if (hasOwn(body, "ruleTags")) {
    patch.ruleTags = normalizeRuleTags(body.ruleTags);
  }
  if (hasOwn(body, "nutrition")) {
    patch.nutrition = normalizeNutrition(body.nutrition, existing.nutrition || {});
  }
  if (hasOwn(body, "availableForSubscription")) {
    patch.availableForSubscription = normalizeBoolean(
      body.availableForSubscription,
      "availableForSubscription"
    );
  }

  return { hasChanges: Object.keys(patch).length > 0, patch };
}

function serializeOptionMealMetadata(option = {}) {
  return {
    selectionType: option.selectionType || "",
    proteinFamilyKey: option.proteinFamilyKey || "",
    displayCategoryKey: option.displayCategoryKey || "",
    premiumKey: option.premiumKey || "",
    ruleTags: Array.isArray(option.ruleTags) ? option.ruleTags : [],
    nutrition: option.nutrition || {
      calories: 0,
      proteinGrams: 0,
      carbGrams: 0,
      fatGrams: 0,
    },
    availableForSubscription:
      option.availableForSubscription !== false,
  };
}

async function writeMetadataAudit({ before, after, actor = {}, action }) {
  await MenuAuditLog.create({
    entityType: "menu_option",
    entityId: after._id,
    action,
    before,
    after,
    actorId:
      actor.userId && mongoose.Types.ObjectId.isValid(String(actor.userId))
        ? actor.userId
        : null,
    actorRole: actor.role || "",
    meta: {
      fields: OPTION_MEAL_METADATA_FIELDS.filter(
        (fieldName) => JSON.stringify(before?.[fieldName]) !== JSON.stringify(after?.[fieldName])
      ),
      authority: "meal_builder_section.selectionType",
    },
  });
}

async function applyOptionMealMetadata({
  optionId,
  preparedPatch,
  body = {},
  actor = {},
  action = "option_meal_metadata_changed",
} = {}) {
  const before = await MenuOption.findById(optionId).lean();
  if (!before) {
    const error = new DashboardOptionMealMetadataError(
      "Option not found",
      "MENU_ENTITY_NOT_FOUND"
    );
    error.status = 404;
    throw error;
  }

  const prepared = preparedPatch || prepareOptionMealMetadataPatch(body, before);
  if (!prepared.hasChanges) return before;

  const after = await MenuOption.findByIdAndUpdate(
    optionId,
    { $set: prepared.patch },
    { new: true, runValidators: true }
  ).lean();

  await writeMetadataAudit({ before, after, actor, action });
  return after;
}

module.exports = {
  ALLOWED_SELECTION_TYPES,
  DashboardOptionMealMetadataError,
  OPTION_MEAL_METADATA_FIELDS,
  applyOptionMealMetadata,
  hasOptionMealMetadata,
  prepareOptionMealMetadataPatch,
  serializeOptionMealMetadata,
};
