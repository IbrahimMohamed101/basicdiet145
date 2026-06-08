const mealBuilderService = require("../../services/subscription/mealBuilderConfigService");
const errorResponse = require("../../utils/errorResponse");
const { getRequestLang } = require("../../utils/i18n");

function actorFromRequest(req) {
  return {
    userId: req.dashboardUserId,
    role: req.dashboardUserRole,
  };
}

function send(res, data, statusCode = 200) {
  return res.status(statusCode).json({ status: true, data });
}

function handleMealBuilderError(err, res) {
  if (err && err.status && err.code) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  if (err && err.name === "ValidationError") {
    return errorResponse(res, 400, "MEAL_BUILDER_VALIDATION_ERROR", "Meal Builder validation failed", Object.values(err.errors || {}).map((item) => item.message));
  }
  if (err && err.code === 11000) {
    return errorResponse(res, 409, "MEAL_BUILDER_CONFLICT", "Meal Builder conflict", err.keyValue || undefined);
  }
  return errorResponse(res, 500, "MEAL_BUILDER_INTERNAL_ERROR", "Unexpected Meal Builder error");
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (err) {
      try {
        return handleMealBuilderError(err, res);
      } catch (unhandled) {
        return next(unhandled);
      }
    }
  };
}

const getMealBuilder = wrap(async (req, res) => {
  const lang = getRequestLang(req);
  return send(res, await mealBuilderService.getDashboardState({ lang }));
});

const getHydratedDraft = wrap(async (req, res) => {
  const lang = getRequestLang(req);
  return send(res, await mealBuilderService.getHydratedDraft({ lang }));
});

const createDraft = wrap(async (req, res) => send(res, await mealBuilderService.createDraft({
  sections: req.body && req.body.sections,
  notes: req.body && req.body.notes,
  actor: actorFromRequest(req),
}), 201));

const updateDraft = wrap(async (req, res) => send(res, await mealBuilderService.updateDraft({
  sections: req.body && req.body.sections,
  notes: req.body && req.body.notes,
  actor: actorFromRequest(req),
})));

const validateDraft = wrap(async (req, res) => {
  if (req.body && Array.isArray(req.body.sections)) {
    return send(res, await mealBuilderService.validatePayload(req.body));
  }
  const state = await mealBuilderService.getDashboardState({ lang: getRequestLang(req) });
  return send(res, state.validation.draft || {
    status: "error",
    ready: false,
    errors: [{ level: "error", code: "MEAL_BUILDER_DRAFT_NOT_FOUND", message: "No current Meal Builder draft found" }],
    warnings: [],
    checks: [],
    summary: { sections: 0, errors: 1, warnings: 0 },
  });
});

const publishDraft = wrap(async (req, res) => send(res, await mealBuilderService.publishDraft({
  notes: req.body && req.body.notes,
  actor: actorFromRequest(req),
})));

const getPicker = wrap(async (req, res) => send(res, await mealBuilderService.getSectionPicker({
  sectionKey: req.params.sectionKey,
  lang: getRequestLang(req),
  q: req.query.q || req.query.search,
  include: req.query.include,
  includeUnavailable: req.query.includeUnavailable,
  includeNotLinked: req.query.includeNotLinked,
  page: req.query.page,
  limit: req.query.limit,
})));

const getReadiness = wrap(async (_req, res) => send(res, await mealBuilderService.getReadinessReport()));

module.exports = {
  createDraft,
  getHydratedDraft,
  getMealBuilder,
  getPicker,
  getReadiness,
  publishDraft,
  updateDraft,
  validateDraft,
};
