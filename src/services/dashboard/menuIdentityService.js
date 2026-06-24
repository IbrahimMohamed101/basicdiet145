const mongoose = require("mongoose");

const ActivityLog = require("../../models/ActivityLog");
const MenuIdentityLink = require("../../models/MenuIdentityLink");
const MenuIdentitySuggestion = require("../../models/MenuIdentitySuggestion");
const SharedMenuIdentity = require("../../models/SharedMenuIdentity");
const { resolveOptionalPagination, buildPaginationMeta } = require("../../utils/optionalPagination");
const { pickLang } = require("../../utils/i18n");

function getModel(modelName) {
  try {
    return mongoose.model(modelName);
  } catch (_err) {
    return null;
  }
}

async function resolveSourceSummaries(links, lang) {
  const summaries = [];
  for (const link of links) {
    const Model = getModel(link.sourceModel);
    let displayName = null;
    if (Model) {
      try {
        const doc = await Model.findById(link.sourceId).select("name").lean();
        displayName = doc ? pickLang(doc.name, lang) : null;
      } catch (_err) {
        // Preserve best-effort source resolution.
      }
    }
    summaries.push({ ...link, sourceDisplayName: displayName });
  }
  return summaries;
}

function paginationFor(query) {
  return resolveOptionalPagination(query, 100, 50) || { page: 1, limit: 50 };
}

async function listMenuIdentities(query = {}) {
  const pagination = paginationFor(query);
  const filter = {};
  if (query.key) filter.key = new RegExp(query.key, "i");
  if (query.type) filter.type = query.type;
  if (query.isActive !== undefined) filter.isActive = query.isActive === "true";
  const total = await SharedMenuIdentity.countDocuments(filter);
  const items = await SharedMenuIdentity.find(filter)
    .sort({ key: 1 })
    .skip((pagination.page - 1) * pagination.limit)
    .limit(pagination.limit)
    .lean();
  return { items, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
}

async function getMenuIdentity(id) {
  return SharedMenuIdentity.findById(id).lean();
}

async function getMenuIdentityLinks(id, lang) {
  const links = await MenuIdentityLink.find({ identityId: id }).lean();
  return resolveSourceSummaries(links, lang);
}

async function listMenuIdentityLinks(query = {}, lang) {
  const pagination = paginationFor(query);
  const filter = {};
  if (query.channel) filter.channel = query.channel;
  if (query.sourceModel) filter.sourceModel = query.sourceModel;
  if (query.confidence) filter.confidence = query.confidence;
  if (query.status) filter.status = query.status;
  if (query.isActive !== undefined) filter.isActive = query.isActive === "true";
  if (query.identityId) filter.identityId = query.identityId;
  const total = await MenuIdentityLink.countDocuments(filter);
  const items = await MenuIdentityLink.find(filter)
    .sort({ createdAt: -1 })
    .skip((pagination.page - 1) * pagination.limit)
    .limit(pagination.limit)
    .lean();
  return {
    items: await resolveSourceSummaries(items, lang),
    meta: buildPaginationMeta(pagination.page, pagination.limit, total),
  };
}

async function listSuggestions(query = {}) {
  const pagination = paginationFor(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.confidence) filter.confidence = query.confidence;
  const total = await MenuIdentitySuggestion.countDocuments(filter);
  const items = await MenuIdentitySuggestion.find(filter)
    .sort({ createdAt: -1 })
    .skip((pagination.page - 1) * pagination.limit)
    .limit(pagination.limit)
    .lean();
  return { items, meta: buildPaginationMeta(pagination.page, pagination.limit, total) };
}

async function getSuggestion(id) {
  return MenuIdentitySuggestion.findById(id).lean();
}

async function approveSuggestion(id, { notes, dashboardUserId, dashboardUserRole } = {}) {
  const suggestion = await MenuIdentitySuggestion.findById(id);
  if (!suggestion) return { statusCode: 404, body: { ok: false, error: "NOT_FOUND" } };
  if (suggestion.status !== "pending") {
    return { statusCode: 400, body: { ok: false, error: "ALREADY_PROCESSED", status: suggestion.status } };
  }

  for (const link of suggestion.proposedLinks) {
    const existing = await MenuIdentityLink.findOne({
      channel: link.channel,
      sourceModel: link.sourceModel,
      sourceId: link.sourceId,
      isActive: true,
    });
    if (existing) {
      return {
        statusCode: 409,
        body: {
          ok: false,
          error: "CONFLICT",
          message: `Source ${link.sourceModel} (${link.sourceId}) already linked to identity ${existing.identityId}`,
        },
      };
    }
  }

  let identity = await SharedMenuIdentity.findOne({ key: suggestion.identityKey });
  if (!identity) {
    identity = await SharedMenuIdentity.create({
      key: suggestion.identityKey,
      type: suggestion.type,
      name: suggestion.identityName,
    });
  }

  const createdLinks = [];
  for (const link of suggestion.proposedLinks) {
    const linkDoc = await MenuIdentityLink.create({
      identityId: identity._id,
      channel: link.channel,
      sourceModel: link.sourceModel,
      sourceId: link.sourceId,
      confidence: suggestion.confidence,
      status: "confirmed",
      isActive: true,
    });
    createdLinks.push(linkDoc._id);
  }

  suggestion.status = "approved";
  suggestion.reviewedBy = dashboardUserId;
  suggestion.reviewedAt = new Date();
  suggestion.notes = notes;
  await suggestion.save();

  await ActivityLog.create({
    entityType: "menu_identity_suggestion",
    entityId: suggestion._id,
    action: "approve",
    byUserId: dashboardUserId,
    byRole: dashboardUserRole,
    meta: { identityId: identity._id, linksCount: createdLinks.length },
  });

  return {
    statusCode: 200,
    body: {
      status: true,
      message: "Suggestion approved and mapping established",
      data: { identityId: identity._id, linksCount: createdLinks.length },
    },
  };
}

async function rejectSuggestion(id, { notes, dashboardUserId } = {}) {
  const suggestion = await MenuIdentitySuggestion.findById(id);
  if (!suggestion) return { statusCode: 404, body: { ok: false, error: "NOT_FOUND" } };
  if (suggestion.status !== "pending") {
    return { statusCode: 400, body: { ok: false, error: "ALREADY_PROCESSED", status: suggestion.status } };
  }
  suggestion.status = "rejected";
  suggestion.reviewedBy = dashboardUserId;
  suggestion.reviewedAt = new Date();
  suggestion.notes = notes;
  await suggestion.save();
  return { statusCode: 200, body: { status: true, message: "Suggestion rejected" } };
}

module.exports = {
  listMenuIdentities,
  getMenuIdentity,
  getMenuIdentityLinks,
  listMenuIdentityLinks,
  listSuggestions,
  getSuggestion,
  approveSuggestion,
  rejectSuggestion,
};
