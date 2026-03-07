const Plan = require("../models/Plan");
const Setting = require("../models/Setting");
const DashboardUser = require("../models/DashboardUser");
const ActivityLog = require("../models/ActivityLog");
const NotificationLog = require("../models/NotificationLog");
const { processDailyCutoff } = require("../services/automationService");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const {
  normalizeDashboardEmail,
  isValidEmailFormat,
  validateDashboardPassword,
  hashDashboardPassword,
} = require("../services/dashboardPasswordService");

const MAX_PREMIUM_PRICE = 10000;
const DASHBOARD_ROLES = new Set(["superadmin", "admin", "kitchen", "courier"]);
const LEGACY_PLAN_FIELDS_TO_UNSET = {
  mealsPerDay: "",
  grams: "",
  price: "",
  skipAllowance: "",
};

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function createControlledError(status, code, message) {
  return { status, code, message };
}

function isControlledError(err) {
  return (
    err
    && Number.isInteger(err.status)
    && typeof err.code === "string"
    && typeof err.message === "string"
  );
}

function normalizeSortOrder(value, fieldName = "sortOrder") {
  const parsed = Number(value);
  if (!isNonNegativeInteger(parsed)) {
    throw createControlledError(400, "INVALID", `${fieldName} must be an integer >= 0`);
  }
  return parsed;
}

function normalizeName(input) {
  if (typeof input === "string") {
    const en = input.trim();
    if (!en) {
      throw createControlledError(400, "INVALID", "name must have at least one non-empty value in ar or en");
    }
    return { ar: "", en };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createControlledError(400, "INVALID", "name must be an object with ar/en or a non-empty string");
  }

  const ar = input.ar === undefined || input.ar === null ? "" : String(input.ar).trim();
  const en = input.en === undefined || input.en === null ? "" : String(input.en).trim();

  if (!ar && !en) {
    throw createControlledError(400, "INVALID", "name must have at least one non-empty value in ar or en");
  }

  return { ar, en };
}

function parsePositiveIntegerOrThrow(value, fieldName) {
  const parsed = Number(value);
  if (!isPositiveInteger(parsed)) {
    throw createControlledError(400, "INVALID", `${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parsePathPositiveIntegerOrRespond(res, value, fieldName) {
  try {
    return parsePositiveIntegerOrThrow(value, fieldName);
  } catch (err) {
    if (isControlledError(err)) {
      errorResponse(res, err.status, err.code, err.message);
      return null;
    }
    throw err;
  }
}

function validateObjectIdOrRespond(res, value, fieldName = "id") {
  try {
    validateObjectId(value, fieldName);
    return true;
  } catch (err) {
    errorResponse(res, err.status, err.code, err.message);
    return false;
  }
}

function validatePlanPayloadOrThrow(payload, { requireGramsOptions = true } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createControlledError(400, "INVALID", "Request body must be an object");
  }

  const name = normalizeName(payload.name);

  const daysCount = Number(payload.daysCount);
  if (!isPositiveInteger(daysCount)) {
    throw createControlledError(400, "INVALID", "daysCount must be a positive integer");
  }

  const currency = payload.currency === undefined ? "SAR" : String(payload.currency).trim();
  if (!currency) {
    throw createControlledError(400, "INVALID", "currency must be a non-empty string");
  }

  const skipAllowanceCompensatedDays =
    payload.skipAllowanceCompensatedDays === undefined
      ? 0
      : Number(payload.skipAllowanceCompensatedDays);
  if (!isNonNegativeInteger(skipAllowanceCompensatedDays)) {
    throw createControlledError(400, "INVALID", "skipAllowanceCompensatedDays must be an integer >= 0");
  }

  const rawFreezePolicy = payload.freezePolicy === undefined ? {} : payload.freezePolicy;
  if (!rawFreezePolicy || typeof rawFreezePolicy !== "object" || Array.isArray(rawFreezePolicy)) {
    throw createControlledError(400, "INVALID", "freezePolicy must be an object");
  }

  const freezePolicy = {
    enabled:
      rawFreezePolicy.enabled === undefined
        ? true
        : Boolean(rawFreezePolicy.enabled),
    maxDays:
      rawFreezePolicy.maxDays === undefined
        ? 31
        : Number(rawFreezePolicy.maxDays),
    maxTimes:
      rawFreezePolicy.maxTimes === undefined
        ? 1
        : Number(rawFreezePolicy.maxTimes),
  };

  if (!isPositiveInteger(freezePolicy.maxDays)) {
    throw createControlledError(400, "INVALID", "freezePolicy.maxDays must be an integer >= 1");
  }
  if (!isNonNegativeInteger(freezePolicy.maxTimes)) {
    throw createControlledError(400, "INVALID", "freezePolicy.maxTimes must be an integer >= 0");
  }

  const isActive = payload.isActive === undefined ? true : Boolean(payload.isActive);
  const sortOrder = payload.sortOrder === undefined ? 0 : normalizeSortOrder(payload.sortOrder, "sortOrder");

  if (!Array.isArray(payload.gramsOptions)) {
    throw createControlledError(400, "INVALID", "gramsOptions must be an array");
  }

  if (requireGramsOptions && payload.gramsOptions.length < 1) {
    throw createControlledError(400, "INVALID", "gramsOptions must contain at least one item");
  }

  const gramsValues = new Set();
  const gramsOptions = payload.gramsOptions.map((rawGramsOption, gramsIndex) => {
    if (!rawGramsOption || typeof rawGramsOption !== "object" || Array.isArray(rawGramsOption)) {
      throw createControlledError(400, "INVALID", `gramsOptions[${gramsIndex}] must be an object`);
    }

    const grams = Number(rawGramsOption.grams);
    if (!isPositiveInteger(grams)) {
      throw createControlledError(400, "INVALID", `gramsOptions[${gramsIndex}].grams must be a positive integer`);
    }
    if (gramsValues.has(grams)) {
      throw createControlledError(409, "CONFLICT", `Duplicate grams value ${grams} is not allowed`);
    }
    gramsValues.add(grams);

    if (!Array.isArray(rawGramsOption.mealsOptions) || rawGramsOption.mealsOptions.length < 1) {
      throw createControlledError(
        400,
        "INVALID",
        `gramsOptions[${gramsIndex}].mealsOptions must be an array with at least one item`
      );
    }

    const mealsValues = new Set();
    const mealsOptions = rawGramsOption.mealsOptions.map((rawMealOption, mealIndex) => {
      if (!rawMealOption || typeof rawMealOption !== "object" || Array.isArray(rawMealOption)) {
        throw createControlledError(
          400,
          "INVALID",
          `gramsOptions[${gramsIndex}].mealsOptions[${mealIndex}] must be an object`
        );
      }

      const mealsPerDay = Number(rawMealOption.mealsPerDay);
      if (!isPositiveInteger(mealsPerDay)) {
        throw createControlledError(
          400,
          "INVALID",
          `gramsOptions[${gramsIndex}].mealsOptions[${mealIndex}].mealsPerDay must be a positive integer`
        );
      }
      if (mealsValues.has(mealsPerDay)) {
        throw createControlledError(
          409,
          "CONFLICT",
          `Duplicate mealsPerDay value ${mealsPerDay} is not allowed in grams ${grams}`
        );
      }
      mealsValues.add(mealsPerDay);

      const priceHalala = Number(rawMealOption.priceHalala);
      if (!isNonNegativeInteger(priceHalala)) {
        throw createControlledError(
          400,
          "INVALID",
          `gramsOptions[${gramsIndex}].mealsOptions[${mealIndex}].priceHalala must be an integer >= 0`
        );
      }

      const compareAtHalala = Number(rawMealOption.compareAtHalala);
      if (!isNonNegativeInteger(compareAtHalala)) {
        throw createControlledError(
          400,
          "INVALID",
          `gramsOptions[${gramsIndex}].mealsOptions[${mealIndex}].compareAtHalala must be an integer >= 0`
        );
      }

      return {
        mealsPerDay,
        priceHalala,
        compareAtHalala,
        isActive: rawMealOption.isActive === undefined ? true : Boolean(rawMealOption.isActive),
        sortOrder:
          rawMealOption.sortOrder === undefined
            ? 0
            : normalizeSortOrder(
              rawMealOption.sortOrder,
              `gramsOptions[${gramsIndex}].mealsOptions[${mealIndex}].sortOrder`
            ),
      };
    });

    return {
      grams,
      mealsOptions,
      isActive: rawGramsOption.isActive === undefined ? true : Boolean(rawGramsOption.isActive),
      sortOrder:
        rawGramsOption.sortOrder === undefined
          ? 0
          : normalizeSortOrder(rawGramsOption.sortOrder, `gramsOptions[${gramsIndex}].sortOrder`),
    };
  });

  return {
    name,
    daysCount,
    currency,
    gramsOptions,
    skipAllowanceCompensatedDays,
    freezePolicy,
    isActive,
    sortOrder,
  };
}

function findGramsIndex(plan, grams) {
  if (!Array.isArray(plan.gramsOptions)) {
    return -1;
  }
  return plan.gramsOptions.findIndex((option) => option.grams === grams);
}

function findMealsIndex(gramsOption, mealsPerDay) {
  if (!Array.isArray(gramsOption.mealsOptions)) {
    return -1;
  }
  return gramsOption.mealsOptions.findIndex((option) => option.mealsPerDay === mealsPerDay);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolvePagination(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  if (query.limit === undefined || query.limit === null || query.limit === "") {
    return { page, limit: 50 };
  }
  const parsedLimit = Number(query.limit);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    return { error: { status: 400, code: "INVALID", message: "limit must be a positive number" } };
  }
  if (parsedLimit > 200) {
    return { error: { status: 400, code: "INVALID", message: "limit cannot exceed 200" } };
  }
  return { page, limit: Math.min(Math.floor(parsedLimit), 200) };
}

function parseDateFilterOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function isValidWindowRange(window) {
  if (typeof window !== "string") return false;
  const match = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(window);
  if (!match) return false;
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  const endMinutes = Number(match[3]) * 60 + Number(match[4]);
  return endMinutes > startMinutes;
}

async function listPlansAdmin(_req, res) {
  const plans = await Plan.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: plans });
}

async function getPlanAdmin(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }
  const plan = await Plan.findById(id).lean();
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  return res.status(200).json({ ok: true, data: plan });
}

async function createPlan(req, res) {
  try {
    const normalizedPayload = validatePlanPayloadOrThrow(req.body || {}, { requireGramsOptions: true });
    const plan = await Plan.create(normalizedPayload);
    return res.status(201).json({ ok: true, data: { id: plan.id } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updatePlan(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  try {
    const normalizedPayload = validatePlanPayloadOrThrow(req.body || {}, { requireGramsOptions: true });
    const updated = await Plan.findByIdAndUpdate(
      id,
      { $set: normalizedPayload, $unset: LEGACY_PLAN_FIELDS_TO_UNSET },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }

    return res.status(200).json({ ok: true, data: { id: updated.id } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deletePlan(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const deleted = await Plan.findByIdAndDelete(id).lean();
  if (!deleted) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }

  return res.status(200).json({ ok: true });
}

async function togglePlanActive(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const plan = await Plan.findById(id);
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  if (!Array.isArray(plan.gramsOptions)) {
    plan.gramsOptions = [];
  }

  plan.isActive = !plan.isActive;
  await plan.save();

  return res.status(200).json({ ok: true, data: { id: plan.id, isActive: plan.isActive } });
}

async function updatePlanSortOrder(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");
    const updated = await Plan.findByIdAndUpdate(id, { sortOrder }, { new: true, runValidators: true });
    if (!updated) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    return res.status(200).json({ ok: true, data: { id: updated.id, sortOrder: updated.sortOrder } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function clonePlan(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const existing = await Plan.findById(id).lean();
  if (!existing) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }

  try {
    const normalizedPayload = validatePlanPayloadOrThrow(
      {
        name: existing.name,
        daysCount: existing.daysCount,
        currency: existing.currency,
        gramsOptions: existing.gramsOptions,
        skipAllowanceCompensatedDays: existing.skipAllowanceCompensatedDays,
        freezePolicy: existing.freezePolicy,
        isActive: existing.isActive,
        sortOrder: existing.sortOrder,
      },
      { requireGramsOptions: true }
    );

    const cloned = await Plan.create(normalizedPayload);
    return res.status(201).json({ ok: true, data: { id: cloned.id } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function cloneGramsRow(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  try {
    const grams = parsePositiveIntegerOrThrow(req.body && req.body.grams, "grams");
    const newGrams = parsePositiveIntegerOrThrow(req.body && req.body.newGrams, "newGrams");

    const plan = await Plan.findById(id);
    if (!plan) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    if (!Array.isArray(plan.gramsOptions)) {
      plan.gramsOptions = [];
    }

    const sourceIndex = findGramsIndex(plan, grams);
    if (sourceIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
    }

    if (findGramsIndex(plan, newGrams) !== -1) {
      return errorResponse(res, 409, "CONFLICT", `Grams option ${newGrams} already exists`);
    }

    const source = plan.gramsOptions[sourceIndex];
    const sourceMeals = Array.isArray(source.mealsOptions) ? source.mealsOptions : [];
    const clonedMeals = sourceMeals.map((mealOption) => ({
      mealsPerDay: mealOption.mealsPerDay,
      priceHalala: mealOption.priceHalala,
      compareAtHalala: mealOption.compareAtHalala,
      isActive: mealOption.isActive,
      sortOrder: mealOption.sortOrder,
    }));

    plan.gramsOptions.push({
      grams: newGrams,
      mealsOptions: clonedMeals,
      isActive: source.isActive,
      sortOrder: source.sortOrder,
    });

    await plan.save();
    return res.status(201).json({ ok: true, data: { id: plan.id } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deleteGramsRow(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }

  const plan = await Plan.findById(id);
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  if (!Array.isArray(plan.gramsOptions)) {
    plan.gramsOptions = [];
  }
  if (plan.gramsOptions.length === 0) {
    return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
  }

  const gramsIndex = findGramsIndex(plan, grams);
  if (gramsIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
  }

  if (plan.gramsOptions.length <= 1) {
    return errorResponse(res, 400, "INVALID", "Cannot delete the last grams option");
  }

  plan.gramsOptions.splice(gramsIndex, 1);
  await plan.save();

  return res.status(200).json({ ok: true });
}

async function toggleGramsRow(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }

  const plan = await Plan.findById(id);
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  if (!Array.isArray(plan.gramsOptions)) {
    plan.gramsOptions = [];
  }

  const gramsIndex = findGramsIndex(plan, grams);
  if (gramsIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
  }

  plan.gramsOptions[gramsIndex].isActive = !plan.gramsOptions[gramsIndex].isActive;
  await plan.save();

  return res.status(200).json({
    ok: true,
    data: {
      id: plan.id,
      grams,
      isActive: plan.gramsOptions[gramsIndex].isActive,
    },
  });
}

async function updateGramsSortOrder(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");

    const plan = await Plan.findById(id);
    if (!plan) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    if (!Array.isArray(plan.gramsOptions)) {
      plan.gramsOptions = [];
    }

    const gramsIndex = findGramsIndex(plan, grams);
    if (gramsIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
    }

    plan.gramsOptions[gramsIndex].sortOrder = sortOrder;
    await plan.save();

    return res.status(200).json({ ok: true, data: { id: plan.id, grams, sortOrder } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function cloneMealsOption(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }

  try {
    const mealsPerDay = parsePositiveIntegerOrThrow(req.body && req.body.mealsPerDay, "mealsPerDay");
    const newMealsPerDay = parsePositiveIntegerOrThrow(req.body && req.body.newMealsPerDay, "newMealsPerDay");

    const plan = await Plan.findById(id);
    if (!plan) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    if (!Array.isArray(plan.gramsOptions)) {
      plan.gramsOptions = [];
    }

    const gramsIndex = findGramsIndex(plan, grams);
    if (gramsIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
    }

    const gramsOption = plan.gramsOptions[gramsIndex];
    const sourceIndex = findMealsIndex(gramsOption, mealsPerDay);
    if (sourceIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Meals option ${mealsPerDay} not found in grams ${grams}`);
    }

    if (findMealsIndex(gramsOption, newMealsPerDay) !== -1) {
      return errorResponse(
        res,
        409,
        "CONFLICT",
        `Meals option ${newMealsPerDay} already exists in grams ${grams}`
      );
    }

    const source = gramsOption.mealsOptions[sourceIndex];
    gramsOption.mealsOptions.push({
      mealsPerDay: newMealsPerDay,
      priceHalala: source.priceHalala,
      compareAtHalala: source.compareAtHalala,
      isActive: source.isActive,
      sortOrder: source.sortOrder,
    });

    await plan.save();
    return res.status(201).json({ ok: true, data: { id: plan.id } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deleteMealsOption(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }
  const mealsPerDay = parsePathPositiveIntegerOrRespond(res, req.params.mealsPerDay, "mealsPerDay");
  if (mealsPerDay === null) {
    return undefined;
  }

  const plan = await Plan.findById(id);
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  if (!Array.isArray(plan.gramsOptions)) {
    plan.gramsOptions = [];
  }

  const gramsIndex = findGramsIndex(plan, grams);
  if (gramsIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
  }

  const gramsOption = plan.gramsOptions[gramsIndex];
  const mealIndex = findMealsIndex(gramsOption, mealsPerDay);
  if (mealIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Meals option ${mealsPerDay} not found in grams ${grams}`);
  }

  if (gramsOption.mealsOptions.length <= 1) {
    return errorResponse(res, 400, "INVALID", "Cannot delete the last meals option for this grams row");
  }

  gramsOption.mealsOptions.splice(mealIndex, 1);
  await plan.save();

  return res.status(200).json({ ok: true });
}

async function toggleMealsOption(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }
  const mealsPerDay = parsePathPositiveIntegerOrRespond(res, req.params.mealsPerDay, "mealsPerDay");
  if (mealsPerDay === null) {
    return undefined;
  }

  const plan = await Plan.findById(id);
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  if (!Array.isArray(plan.gramsOptions)) {
    plan.gramsOptions = [];
  }

  const gramsIndex = findGramsIndex(plan, grams);
  if (gramsIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
  }

  const gramsOption = plan.gramsOptions[gramsIndex];
  const mealIndex = findMealsIndex(gramsOption, mealsPerDay);
  if (mealIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Meals option ${mealsPerDay} not found in grams ${grams}`);
  }

  gramsOption.mealsOptions[mealIndex].isActive = !gramsOption.mealsOptions[mealIndex].isActive;
  await plan.save();

  return res.status(200).json({
    ok: true,
    data: {
      id: plan.id,
      grams,
      mealsPerDay,
      isActive: gramsOption.mealsOptions[mealIndex].isActive,
    },
  });
}

async function updateMealsSortOrder(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }
  const mealsPerDay = parsePathPositiveIntegerOrRespond(res, req.params.mealsPerDay, "mealsPerDay");
  if (mealsPerDay === null) {
    return undefined;
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");

    const plan = await Plan.findById(id);
    if (!plan) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    if (!Array.isArray(plan.gramsOptions)) {
      plan.gramsOptions = [];
    }

    const gramsIndex = findGramsIndex(plan, grams);
    if (gramsIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
    }

    const gramsOption = plan.gramsOptions[gramsIndex];
    const mealIndex = findMealsIndex(gramsOption, mealsPerDay);
    if (mealIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Meals option ${mealsPerDay} not found in grams ${grams}`);
    }

    gramsOption.mealsOptions[mealIndex].sortOrder = sortOrder;
    await plan.save();

    return res.status(200).json({ ok: true, data: { id: plan.id, grams, mealsPerDay, sortOrder } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateSetting(key, value, res) {
  await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
  return res.status(200).json({ ok: true });
}

async function updateCutoff(req, res) {
  const { time } = req.body || {};
  if (!time) return errorResponse(res, 400, "INVALID", "Missing time");
  // SECURITY FIX: Validate strict HH:mm format and clock bounds before persisting cutoff setting.
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return errorResponse(res, 400, "INVALID", "Invalid time format, expected HH:mm");
  }
  const [hours, minutes] = time.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return errorResponse(res, 400, "INVALID", "Invalid time value");
  }
  return updateSetting("cutoff_time", time, res);
}

async function updateDeliveryWindows(req, res) {
  const { windows } = req.body || {};
  if (!windows || !Array.isArray(windows))
    return errorResponse(res, 400, "INVALID", "Missing windows array");
  // MEDIUM AUDIT FIX: Validate window format and dedupe entries to prevent ambiguous delivery slot configuration.
  const normalized = windows.map((window) => (typeof window === "string" ? window.trim() : window));
  if (!normalized.every((window) => isValidWindowRange(window))) {
    return errorResponse(res, 400, "INVALID", "Each window must match HH:mm-HH:mm");
  }
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    return errorResponse(res, 400, "INVALID", "Duplicate delivery windows are not allowed");
  }
  return updateSetting("delivery_windows", normalized, res);
}

async function updateSkipAllowance(req, res) {
  const { days, skipAllowance } = req.body || {};
  const rawValue = skipAllowance !== undefined ? skipAllowance : days;
  if (rawValue === undefined) {
    return errorResponse(res, 400, "INVALID", "Missing skipAllowance");
  }
  const parsedDays = Number(rawValue);
  // BUSINESS RULE: Admin-configured global skip allowance must be an integer >= 0; 0 disables all skips.
  if (!Number.isInteger(parsedDays) || parsedDays < 0) {
    return errorResponse(res, 400, "INVALID", "skipAllowance must be an integer >= 0");
  }
  await Setting.findOneAndUpdate(
    { key: "skipAllowance" },
    { value: parsedDays, skipAllowance: parsedDays },
    { upsert: true }
  );
  return res.status(200).json({ ok: true, data: { skipAllowance: parsedDays } });
}

async function updatePremiumPrice(req, res) {
  const { price } = req.body || {};
  if (price === undefined)
    return errorResponse(res, 400, "INVALID", "Missing price");
  const parsedPrice = Number(price);
  // MEDIUM AUDIT FIX: Premium price must be numeric, finite, positive, and bounded to avoid corrupt billing settings.
  if (!Number.isFinite(parsedPrice)) {
    return errorResponse(res, 400, "INVALID", "price must be a finite number");
  }
  if (parsedPrice <= 0) {
    return errorResponse(res, 400, "INVALID", "price must be greater than 0");
  }
  if (parsedPrice > MAX_PREMIUM_PRICE) {
    return errorResponse(res, 400, "INVALID", `price must be <= ${MAX_PREMIUM_PRICE}`);
  }
  return updateSetting("premium_price", parsedPrice, res);
}

async function listDashboardUsers(_req, res) {
  const users = await DashboardUser.find()
    .select("-passwordHash")
    .sort({ createdAt: -1 })
    .lean();
  return res.status(200).json({ ok: true, data: users });
}

async function createDashboardUser(req, res) {
  const { email, role, password, isActive } = req.body || {};
  const normalizedEmail = normalizeDashboardEmail(email);
  if (!normalizedEmail || !role || !password) {
    return errorResponse(res, 400, "INVALID", "Missing email, role, or password");
  }
  if (!isValidEmailFormat(normalizedEmail)) {
    return errorResponse(res, 400, "INVALID", "Invalid email format");
  }
  if (!DASHBOARD_ROLES.has(role)) {
    return errorResponse(res, 400, "INVALID", "role must be one of: superadmin, admin, kitchen, courier");
  }
  const passwordValidation = validateDashboardPassword(password);
  if (!passwordValidation.ok) {
    return errorResponse(res, 400, "INVALID", passwordValidation.message);
  }
  const existing = await DashboardUser.findOne({
    email: { $regex: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, "i") },
  }).lean();
  if (existing) {
    return errorResponse(res, 409, "CONFLICT", "Dashboard user already exists");
  }
  const passwordHash = await hashDashboardPassword(password);
  const user = await DashboardUser.create({
    email: normalizedEmail,
    role,
    passwordHash,
    isActive: isActive === undefined ? true : Boolean(isActive),
    passwordChangedAt: new Date(),
  });
  return res.status(201).json({ ok: true, data: { id: user.id } });
}

async function listActivityLogs(req, res) {
  const {
    entityType,
    entityId,
    action,
    from,
    to,
    byRole,
  } = req.query || {};

  const query = {};
  if (entityType) query.entityType = entityType;
  // MEDIUM AUDIT FIX: Validate filter ObjectIds/dates to avoid CastError and return controlled 400 responses.
  if (entityId) {
    try {
      validateObjectId(entityId, "entityId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    query.entityId = entityId;
  }
  if (action) query.action = action;
  if (byRole) query.byRole = byRole;
  const parsedFrom = from ? parseDateFilterOrNull(from) : null;
  if (from && !parsedFrom) {
    return errorResponse(res, 400, "INVALID", "from must be a valid date");
  }
  const parsedTo = to ? parseDateFilterOrNull(to) : null;
  if (to && !parsedTo) {
    return errorResponse(res, 400, "INVALID", "to must be a valid date");
  }
  if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
    return errorResponse(res, 400, "INVALID", "from must be before or equal to to");
  }
  if (from || to) {
    query.createdAt = {};
    if (parsedFrom) query.createdAt.$gte = parsedFrom;
    if (parsedTo) query.createdAt.$lte = parsedTo;
  }

  const pagination = resolvePagination(req.query || {});
  if (pagination.error) {
    return errorResponse(res, pagination.error.status, pagination.error.code, pagination.error.message);
  }
  const skip = (pagination.page - 1) * pagination.limit;

  const [logs, total] = await Promise.all([
    ActivityLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean(),
    ActivityLog.countDocuments(query),
  ]);

  return res.status(200).json({
    ok: true,
    data: logs,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
    },
  });
}

async function listNotificationLogs(req, res) {
  const { userId, entityId, from, to } = req.query || {};
  const query = {};
  if (userId) {
    try {
      validateObjectId(userId, "userId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    query.userId = userId;
  }
  // MEDIUM AUDIT FIX: Validate filter ObjectIds/dates to avoid CastError and return controlled 400 responses.
  if (entityId) {
    try {
      validateObjectId(entityId, "entityId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    query.entityId = entityId;
  }
  const parsedFrom = from ? parseDateFilterOrNull(from) : null;
  if (from && !parsedFrom) {
    return errorResponse(res, 400, "INVALID", "from must be a valid date");
  }
  const parsedTo = to ? parseDateFilterOrNull(to) : null;
  if (to && !parsedTo) {
    return errorResponse(res, 400, "INVALID", "to must be a valid date");
  }
  if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
    return errorResponse(res, 400, "INVALID", "from must be before or equal to to");
  }
  if (from || to) {
    query.createdAt = {};
    if (parsedFrom) query.createdAt.$gte = parsedFrom;
    if (parsedTo) query.createdAt.$lte = parsedTo;
  }

  const pagination = resolvePagination(req.query || {});
  if (pagination.error) {
    return errorResponse(res, pagination.error.status, pagination.error.code, pagination.error.message);
  }
  const skip = (pagination.page - 1) * pagination.limit;

  const [logs, total] = await Promise.all([
    NotificationLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(pagination.limit).lean(),
    NotificationLog.countDocuments(query),
  ]);

  return res.status(200).json({
    ok: true,
    data: logs,
    meta: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
  });
}

module.exports = {
  listPlansAdmin,
  getPlanAdmin,
  createPlan,
  updatePlan,
  deletePlan,
  togglePlanActive,
  updatePlanSortOrder,
  clonePlan,
  cloneGramsRow,
  deleteGramsRow,
  toggleGramsRow,
  updateGramsSortOrder,
  cloneMealsOption,
  deleteMealsOption,
  toggleMealsOption,
  updateMealsSortOrder,
  updateCutoff,
  updateDeliveryWindows,
  updateSkipAllowance,
  updatePremiumPrice,
  listDashboardUsers,
  createDashboardUser,
  listActivityLogs,
  listNotificationLogs,
  triggerDailyCutoff: async (req, res) => {
    try {
      await processDailyCutoff();
      return res.status(200).json({ ok: true, message: "Cutoff processed successfully" });
    } catch (err) {
      if (err && err.code === "JOB_RUNNING") {
        // MEDIUM AUDIT FIX: Surface cutoff lock contention as explicit 409 so callers can retry safely.
        return errorResponse(res, 409, "JOB_RUNNING", "Daily cutoff job is already running");
      }
      logger.error("adminController.triggerDailyCutoff failed", { error: err.message, stack: err.stack });
      return errorResponse(res, 500, "INTERNAL", "Cutoff processing failed");
    }
  }
};
