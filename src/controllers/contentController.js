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

async function getAppVersion(req, res) {
  const data = await appContentService.getAppVersionStatus({
    platform: req.query.platform || "android",
    currentVersion: req.query.version || "0.0.0",
  });

  return res.status(200).json({ status: true, data });
}

async function getAppAd(req, res) {
  const locale = req.query.locale || appContentService.DEFAULT_LOCALE;
  const data = await appContentService.getActiveContentOrNull({
    key: appContentService.CONTENT_KEYS.appAd,
    locale,
  });

  return res.status(200).json({ status: true, data });
}

async function upsertAppVersionAdmin(req, res) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const platform = String(body.platform || "android").trim().toLowerCase();
  const latestVersion = String(body.latestVersion || "").trim();
  const minimumVersion = String(body.minimumVersion || "").trim();

  if (!latestVersion || !minimumVersion) {
    return errorResponse(res, 422, "VALIDATION_ERROR", "latestVersion and minimumVersion are required");
  }

  const data = await appContentService.saveActiveContent({
    key: "app_version",
    title: "App Version",
    content: {
      latestVersion,
      minimumVersion,
      forceUpdate: body.forceUpdate === true,
      updateUrl: String(body.updateUrl || "").trim() || null,
      messageAr: String(body.messageAr || "يوجد تحديث جديد للتطبيق.").trim(),
      messageEn: String(body.messageEn || "A new app update is available.").trim(),
    },
    locale: platform,
    updatedBy: req.dashboardUserId || req.userId || null,
  });

  return res.status(200).json({ status: true, data });
}

async function getAppAdAdmin(req, res) {
  const locale = req.query.locale || appContentService.DEFAULT_LOCALE;
  const data = await appContentService.getLatestContentOrNull({
    key: appContentService.CONTENT_KEYS.appAd,
    locale,
    includeUpdatedBy: true,
  });

  if (!data) {
    return errorResponse(res, 404, "NOT_FOUND", "App ad was not configured");
  }

  return res.status(200).json({ status: true, data });
}

async function upsertAppAdAdmin(req, res) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const title = String(body.title || "إعلان التطبيق").trim();
  const locale = String(body.locale || appContentService.DEFAULT_LOCALE).trim().toLowerCase();
  const content = body.content && typeof body.content === "object" && !Array.isArray(body.content)
    ? body.content
    : {};

  const imageUrl = String(content.imageUrl || body.imageUrl || "").trim();
  if (!imageUrl) {
    return errorResponse(res, 422, "VALIDATION_ERROR", "imageUrl is required");
  }

  const data = await appContentService.saveActiveContent({
    key: appContentService.CONTENT_KEYS.appAd,
    title,
    content: {
      imageUrl,
      linkUrl: String(content.linkUrl || body.linkUrl || "").trim() || null,
      altText: String(content.altText || body.altText || "").trim() || null,
    },
    locale,
    updatedBy: req.dashboardUserId || req.userId || null,
  });

  await writeLog({
    entityType: "content",
    entityId: req.dashboardUserId || req.userId || null,
    action: "app_ad_upserted_by_admin",
    byUserId: req.dashboardUserId || req.userId || null,
    byRole: req.dashboardUserRole || null,
    meta: { key: appContentService.CONTENT_KEYS.appAd, locale, version: data.version },
  }).catch(() => {});

  return res.status(200).json({ status: true, data: { ...data, isActive: true } });
}

async function toggleAppAdAdmin(req, res) {
  const locale = req.query.locale || appContentService.DEFAULT_LOCALE;
  const data = await appContentService.toggleContentActive({
    key: appContentService.CONTENT_KEYS.appAd,
    locale,
    updatedBy: req.dashboardUserId || req.userId || null,
  });

  if (!data) {
    return errorResponse(res, 404, "NOT_FOUND", "App ad was not configured");
  }

  await writeLog({
    entityType: "content",
    entityId: req.dashboardUserId || req.userId || null,
    action: "app_ad_toggled_by_admin",
    byUserId: req.dashboardUserId || req.userId || null,
    byRole: req.dashboardUserRole || null,
    meta: {
      key: appContentService.CONTENT_KEYS.appAd,
      locale,
      isActive: data.isActive === true,
    },
  }).catch(() => {});

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
  getAppVersion,
  getAppAd,
  getAppAdAdmin,
  upsertAppAdAdmin,
  toggleAppAdAdmin,
  getSubscriptionTermsAdmin,
  upsertSubscriptionTermsAdmin,
};
