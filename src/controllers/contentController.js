const appContentService = require("../services/appContentService");
const errorResponse = require("../utils/errorResponse");
const { writeLog } = require("../utils/log");

async function writeContentActivityLogSafely(req, data) {
  if (!req || !req.dashboardUserId) return;
  try {
    await writeLog({
      entityType: "content",
      entityId: req.dashboardUserId,
      action: "subscription_terms_content_upserted_by_admin",
      byUserId: req.dashboardUserId,
      byRole: req.dashboardUserRole,
      meta: {
        key: data && data.key,
        locale: data && data.locale,
        version: data && data.version,
      },
    });
  } catch (_err) {
    // Content writes should not fail because activity logging failed.
  }
}

async function getSubscriptionTerms(req, res) {
  const locale = req.query.locale || appContentService.DEFAULT_LOCALE;
  const data = await appContentService.getActiveContentOrNull({
    key: appContentService.CONTENT_KEYS.subscriptionTerms,
    locale,
  });

  if (!data) {
    return errorResponse(res, 404, "NOT_FOUND", "Active subscription terms were not found");
  }

  return res.status(200).json({ status: true, data });
}

async function getSubscriptionTermsAdmin(req, res) {
  const locale = req.query.locale || appContentService.DEFAULT_LOCALE;
  const data = await appContentService.getActiveContentOrNull({
    key: appContentService.CONTENT_KEYS.subscriptionTerms,
    locale,
    includeUpdatedBy: true,
  });

  if (!data) {
    return errorResponse(res, 404, "NOT_FOUND", "Active subscription terms were not found");
  }

  return res.status(200).json({ status: true, data });
}

async function upsertSubscriptionTermsAdmin(req, res) {
  try {
    const payload = appContentService.validateWritePayload(req.body);
    const data = await appContentService.saveActiveContent({
      key: appContentService.CONTENT_KEYS.subscriptionTerms,
      title: payload.title,
      content: payload.content,
      locale: payload.locale,
      updatedBy: req.dashboardUserId || req.userId || null,
    });
    await writeContentActivityLogSafely(req, data);

    return res.status(200).json({ status: true, data });
  } catch (error) {
    if (error && Number.isInteger(error.status) && error.code) {
      return errorResponse(res, error.status, error.code, error.message);
    }
    throw error;
  }
}

module.exports = {
  getSubscriptionTerms,
  getSubscriptionTermsAdmin,
  upsertSubscriptionTermsAdmin,
};
