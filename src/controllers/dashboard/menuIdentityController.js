const SharedMenuIdentity = require("../../models/SharedMenuIdentity");
const MenuIdentityLink = require("../../models/MenuIdentityLink");
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
