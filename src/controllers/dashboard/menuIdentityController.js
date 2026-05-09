const SharedMenuIdentity = require("../../models/SharedMenuIdentity");
const MenuIdentityLink = require("../../models/MenuIdentityLink");
const MenuIdentitySuggestion = require("../../models/MenuIdentitySuggestion");
const ActivityLog = require("../../models/ActivityLog");
const { resolveOptionalPagination, buildPaginationMeta } = require("../../utils/optionalPagination");
const { pickLang, getRequestLang } = require("../../utils/i18n");
const asyncHandler = require("../../middleware/asyncHandler");
const mongoose = require("mongoose");

const getModel = (modelName) => {
  try {
    return mongoose.model(modelName);
  } catch (e) {
    return null;
  }
};

const resolveSourceSummaries = async (links, lang) => {
  const summaries = [];
  for (const link of links) {
    const Model = getModel(link.sourceModel);
    let displayName = null;
    if (Model) {
      try {
        const doc = await Model.findById(link.sourceId).select("name").lean();
        displayName = doc ? pickLang(doc.name, lang) : null;
      } catch (e) {
        // Ignore resolution errors
      }
    }
    summaries.push({
      ...link,
      sourceDisplayName: displayName,
    });
  }
  return summaries;
};

/**
 * GET /api/dashboard/menu-identities
 */
exports.listMenuIdentities = asyncHandler(async (req, res) => {
  const lang = getRequestLang(req);
  const pagination = resolveOptionalPagination(req.query, 100, 50) || { page: 1, limit: 50 };

  const filter = {};
  if (req.query.key) filter.key = new RegExp(req.query.key, "i");
  if (req.query.type) filter.type = req.query.type;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === "true";

  const total = await SharedMenuIdentity.countDocuments(filter);
  const items = await SharedMenuIdentity.find(filter)
    .sort({ key: 1 })
    .skip((pagination.page - 1) * pagination.limit)
    .limit(pagination.limit)
    .lean();

  res.json({
    status: true,
    data: items,
    meta: buildPaginationMeta(pagination.page, pagination.limit, total),
  });
});

/**
 * GET /api/dashboard/menu-identities/:id
 */
exports.getMenuIdentity = asyncHandler(async (req, res) => {
  const item = await SharedMenuIdentity.findById(req.params.id).lean();
  if (!item) {
    return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  }
  res.json({ status: true, data: item });
});

/**
 * GET /api/dashboard/menu-identities/:id/links
 */
exports.getMenuIdentityLinks = asyncHandler(async (req, res) => {
  const lang = getRequestLang(req);
  const links = await MenuIdentityLink.find({ identityId: req.params.id }).lean();
  const summaryLinks = await resolveSourceSummaries(links, lang);

  res.json({ status: true, data: summaryLinks });
});

/**
 * GET /api/dashboard/menu-identity-links
 */
exports.listMenuIdentityLinks = asyncHandler(async (req, res) => {
  const lang = getRequestLang(req);
  const pagination = resolveOptionalPagination(req.query, 100, 50) || { page: 1, limit: 50 };

  const filter = {};
  if (req.query.channel) filter.channel = req.query.channel;
  if (req.query.sourceModel) filter.sourceModel = req.query.sourceModel;
  if (req.query.confidence) filter.confidence = req.query.confidence;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === "true";
  if (req.query.identityId) filter.identityId = req.query.identityId;

  const total = await MenuIdentityLink.countDocuments(filter);
  const items = await MenuIdentityLink.find(filter)
    .sort({ createdAt: -1 })
    .skip((pagination.page - 1) * pagination.limit)
    .limit(pagination.limit)
    .lean();

  const summaryItems = await resolveSourceSummaries(items, lang);

  res.json({
    status: true,
    data: summaryItems,
    meta: buildPaginationMeta(pagination.page, pagination.limit, total),
  });
});

/**
 * GET /api/dashboard/menu-identity-suggestions
 */
exports.listSuggestions = asyncHandler(async (req, res) => {
  try {
    const pagination = resolveOptionalPagination(req.query, 100, 50) || { page: 1, limit: 50 };
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.confidence) filter.confidence = req.query.confidence;

    const total = await MenuIdentitySuggestion.countDocuments(filter);
    const items = await MenuIdentitySuggestion.find(filter)
      .sort({ createdAt: -1 })
      .skip((pagination.page - 1) * pagination.limit)
      .limit(pagination.limit)
      .lean();

    res.json({
      status: true,
      data: items,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

/**
 * GET /api/dashboard/menu-identity-suggestions/:id
 */
exports.getSuggestion = asyncHandler(async (req, res) => {
  try {
    const data = await MenuIdentitySuggestion.findById(req.params.id).lean();
    if (!data) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    res.json({ status: true, data });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

/**
 * POST /api/dashboard/menu-identity-suggestions/:id/approve
 */
exports.approveSuggestion = asyncHandler(async (req, res) => {
  try {
    const suggestion = await MenuIdentitySuggestion.findById(req.params.id);
    if (!suggestion) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (suggestion.status !== "pending") {
      return res.status(400).json({ ok: false, error: "ALREADY_PROCESSED", status: suggestion.status });
    }

    // 1. Conflict Check: Do any of the proposed links already have an active identity?
    for (const link of suggestion.proposedLinks) {
      const existing = await MenuIdentityLink.findOne({
        channel: link.channel,
        sourceModel: link.sourceModel,
        sourceId: link.sourceId,
        isActive: true,
      });
      if (existing) {
        return res.status(409).json({
          ok: false,
          error: "CONFLICT",
          message: `Source ${link.sourceModel} (${link.sourceId}) already linked to identity ${existing.identityId}`,
        });
      }
    }

    // 2. Create/Find SharedMenuIdentity
    let identity = await SharedMenuIdentity.findOne({ key: suggestion.identityKey });
    if (!identity) {
      identity = await SharedMenuIdentity.create({
        key: suggestion.identityKey,
        type: suggestion.type,
        name: suggestion.identityName,
      });
    }

    // 3. Create Links
    const createdLinks = [];
    for (const l of suggestion.proposedLinks) {
      const linkDoc = await MenuIdentityLink.create({
        identityId: identity._id,
        channel: l.channel,
        sourceModel: l.sourceModel,
        sourceId: l.sourceId,
        confidence: suggestion.confidence,
        status: "confirmed",
        isActive: true,
      });
      createdLinks.push(linkDoc._id);
    }

    // 4. Update Suggestion
    suggestion.status = "approved";
    suggestion.reviewedBy = req.dashboardUserId;
    suggestion.reviewedAt = new Date();
    suggestion.notes = req.body.notes;
    await suggestion.save();

    // 5. Activity Log
    await ActivityLog.create({
      entityType: "menu_identity_suggestion",
      entityId: suggestion._id,
      action: "approve",
      byUserId: req.dashboardUserId,
      byRole: req.dashboardUserRole,
      meta: { identityId: identity._id, linksCount: createdLinks.length },
    });

    res.json({
      status: true,
      message: "Suggestion approved and mapping established",
      data: { identityId: identity._id, linksCount: createdLinks.length },
    });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

/**
 * POST /api/dashboard/menu-identity-suggestions/:id/reject
 */
exports.rejectSuggestion = asyncHandler(async (req, res) => {
  try {
    const suggestion = await MenuIdentitySuggestion.findById(req.params.id);
    if (!suggestion) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (suggestion.status !== "pending") {
      return res.status(400).json({ ok: false, error: "ALREADY_PROCESSED", status: suggestion.status });
    }

    suggestion.status = "rejected";
    suggestion.reviewedBy = req.dashboardUserId;
    suggestion.reviewedAt = new Date();
    suggestion.notes = req.body.notes;
    await suggestion.save();

    res.json({ status: true, message: "Suggestion rejected" });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});
