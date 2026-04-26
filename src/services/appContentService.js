const mongoose = require("mongoose");

const AppContent = require("../models/AppContent");
const { SUBSCRIPTION_TERMS_DEFAULT } = require("../content/defaultSubscriptionTermsAr");

const DEFAULT_LOCALE = "ar";
const CONTENT_KEYS = Object.freeze({
  subscriptionTerms: SUBSCRIPTION_TERMS_DEFAULT.key,
});

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLocale(value) {
  const locale = String(value || DEFAULT_LOCALE).trim().toLowerCase();
  return locale || DEFAULT_LOCALE;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateContentValue(content) {
  if (isNonEmptyString(content)) {
    return content.trim();
  }

  if (!isPlainObject(content)) {
    const error = new Error("content must be a non-empty string or object");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  if (Array.isArray(content.sections) && content.sections.length === 0) {
    const error = new Error("content.sections must contain at least one section");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  if (Object.keys(content).length === 0) {
    const error = new Error("content must not be empty");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  return content;
}

function validateWritePayload(payload) {
  if (!isPlainObject(payload)) {
    const error = new Error("Request body must be an object");
    error.status = 400;
    error.code = "INVALID";
    throw error;
  }

  const title = String(payload.title || "").trim();
  const locale = normalizeLocale(payload.locale);
  const content = validateContentValue(payload.content);

  if (!title) {
    const error = new Error("title must be a non-empty string");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  if (!locale) {
    const error = new Error("locale must be a non-empty string");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  return { title, locale, content };
}

function toUpdatedByResource(updatedBy) {
  if (!updatedBy) {
    return null;
  }

  if (typeof updatedBy === "string") {
    return { id: updatedBy };
  }

  return {
    id: updatedBy._id ? String(updatedBy._id) : String(updatedBy),
    email: updatedBy.email || undefined,
    role: updatedBy.role || undefined,
  };
}

function serializeAppContent(doc, { includeUpdatedBy = false } = {}) {
  if (!doc) return null;

  const base = {
    key: doc.key,
    title: doc.title,
    content: doc.content,
    locale: doc.locale,
    version: Number(doc.version || 1),
    updatedAt: doc.updatedAt,
  };

  if (!includeUpdatedBy) {
    return base;
  }

  return {
    ...base,
    updatedBy: toUpdatedByResource(doc.updatedBy),
  };
}

async function findActiveContent({ key, locale = DEFAULT_LOCALE, includeUpdatedBy = false } = {}) {
  const query = AppContent.findOne({
    key: normalizeKey(key),
    locale: normalizeLocale(locale),
    isActive: true,
  });

  if (includeUpdatedBy) {
    query.populate("updatedBy", "email role");
  }

  return query;
}

async function getActiveContentOrNull({ key, locale = DEFAULT_LOCALE, includeUpdatedBy = false } = {}) {
  const doc = await findActiveContent({ key, locale, includeUpdatedBy });
  return serializeAppContent(doc, { includeUpdatedBy });
}

async function saveActiveContent({
  key,
  title,
  content,
  locale = DEFAULT_LOCALE,
  updatedBy = null,
} = {}) {
  const normalizedKey = normalizeKey(key);
  const normalizedLocale = normalizeLocale(locale);
  const existing = await AppContent.findOne({
    key: normalizedKey,
    locale: normalizedLocale,
    isActive: true,
  });

  const nextUpdatedBy = mongoose.Types.ObjectId.isValid(updatedBy) ? updatedBy : null;

  if (!existing) {
    const created = await AppContent.create({
      key: normalizedKey,
      title,
      content,
      locale: normalizedLocale,
      version: 1,
      isActive: true,
      updatedBy: nextUpdatedBy,
    });

    await created.populate("updatedBy", "email role");
    return serializeAppContent(created, { includeUpdatedBy: true });
  }

  existing.title = title;
  existing.content = content;
  existing.version = Number(existing.version || 1) + 1;
  existing.updatedBy = nextUpdatedBy;
  existing.isActive = true;

  await existing.save();
  await existing.populate("updatedBy", "email role");

  return serializeAppContent(existing, { includeUpdatedBy: true });
}

async function seedDefaultSubscriptionTerms({ overwrite = false } = {}) {
  const existing = await AppContent.findOne({
    key: SUBSCRIPTION_TERMS_DEFAULT.key,
    locale: SUBSCRIPTION_TERMS_DEFAULT.locale,
    isActive: true,
  });

  if (existing && !overwrite) {
    return { created: false, data: serializeAppContent(existing, { includeUpdatedBy: true }) };
  }

  const data = await saveActiveContent({
    key: SUBSCRIPTION_TERMS_DEFAULT.key,
    title: SUBSCRIPTION_TERMS_DEFAULT.title,
    content: SUBSCRIPTION_TERMS_DEFAULT.content,
    locale: SUBSCRIPTION_TERMS_DEFAULT.locale,
    updatedBy: null,
  });

  return { created: !existing, data };
}

module.exports = {
  CONTENT_KEYS,
  DEFAULT_LOCALE,
  getActiveContentOrNull,
  saveActiveContent,
  seedDefaultSubscriptionTerms,
  serializeAppContent,
  validateWritePayload,
};
