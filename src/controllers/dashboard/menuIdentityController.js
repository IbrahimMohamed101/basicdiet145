const asyncHandler = require("../../middleware/asyncHandler");
const { getRequestLang } = require("../../utils/i18n");
const service = require("../../services/dashboard/menuIdentityService");

exports.listMenuIdentities = asyncHandler(async (req, res) => {
  const result = await service.listMenuIdentities(req.query);
  res.json({ status: true, data: result.items, meta: result.meta });
});

exports.getMenuIdentity = asyncHandler(async (req, res) => {
  const item = await service.getMenuIdentity(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  res.json({ status: true, data: item });
});

exports.getMenuIdentityLinks = asyncHandler(async (req, res) => {
  const data = await service.getMenuIdentityLinks(req.params.id, getRequestLang(req));
  res.json({ status: true, data });
});

exports.listMenuIdentityLinks = asyncHandler(async (req, res) => {
  const result = await service.listMenuIdentityLinks(req.query, getRequestLang(req));
  res.json({ status: true, data: result.items, meta: result.meta });
});

exports.listSuggestions = asyncHandler(async (req, res) => {
  try {
    const result = await service.listSuggestions(req.query);
    res.json({ status: true, data: result.items, meta: result.meta });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

exports.getSuggestion = asyncHandler(async (req, res) => {
  try {
    const data = await service.getSuggestion(req.params.id);
    if (!data) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    res.json({ status: true, data });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

exports.approveSuggestion = asyncHandler(async (req, res) => {
  try {
    const result = await service.approveSuggestion(req.params.id, {
      notes: req.body.notes,
      dashboardUserId: req.dashboardUserId,
      dashboardUserRole: req.dashboardUserRole,
    });
    res.status(result.statusCode).json(result.body);
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

exports.rejectSuggestion = asyncHandler(async (req, res) => {
  try {
    const result = await service.rejectSuggestion(req.params.id, {
      notes: req.body.notes,
      dashboardUserId: req.dashboardUserId,
    });
    res.status(result.statusCode).json(result.body);
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});
