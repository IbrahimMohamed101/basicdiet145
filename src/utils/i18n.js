const ar = require("../locales/ar");
const en = require("../locales/en");

const SUPPORTED_LANGS = ["ar", "en"];
const DEFAULT_LANG = "en";
const LOCALES = { ar, en };

function normalizeLanguageCandidate(value) {
  if (typeof value !== "string") return "";

  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";

  const primary = normalized.split(/[-_]/)[0];
  return SUPPORTED_LANGS.includes(primary) ? primary : "";
}

function parseHeaderPreferences(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.trim()) {
    return [];
  }

  return headerValue
    .split(",")
    .map((token, index) => {
      const rawToken = token.trim();
      if (!rawToken) return null;

      const [range, ...params] = rawToken.split(";").map((part) => part.trim());
      const lang = normalizeLanguageCandidate(range);
      if (!lang) return null;

      let q = 1;
      for (const param of params) {
        if (!param.toLowerCase().startsWith("q=")) continue;
        const parsed = Number(param.slice(2));
        if (Number.isFinite(parsed)) {
          q = Math.max(0, Math.min(1, parsed));
        }
      }

      return { lang, q, index };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.q !== a.q) return b.q - a.q;
      return a.index - b.index;
    });
}

function getRequestLang(req) {
  const attachedLanguage = normalizeLanguageCandidate(req && req.language);
  if (attachedLanguage) return attachedLanguage;

  const attachedLang = normalizeLanguageCandidate(req && req.lang);
  if (attachedLang) return attachedLang;

  const queryLang = normalizeLanguageCandidate(req && req.query && req.query.lang);
  if (queryLang) return queryLang;

  const preferences = parseHeaderPreferences(req && req.headers && req.headers["accept-language"]);
  for (const preference of preferences) {
    if (preference.q > 0) return preference.lang;
  }

  return DEFAULT_LANG;
}

function localizeField(value, lang) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";

  const preferredLang = normalizeLanguageCandidate(lang) || DEFAULT_LANG;
  const preferredValue = value[preferredLang];
  if (preferredValue) return preferredValue;

  const fallbackLang = SUPPORTED_LANGS.find((candidate) => candidate !== preferredLang && value[candidate]);
  return fallbackLang ? value[fallbackLang] : "";
}

const pickLang = localizeField;

function getNestedValue(target, path) {
  if (!target || typeof target !== "object") return undefined;

  return path.split(".").reduce((current, segment) => {
    if (current == null || typeof current !== "object") return undefined;
    return current[segment];
  }, target);
}

function interpolate(template, params = {}) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : ""
  );
}

function t(key, lang, params = {}) {
  const preferredLang = normalizeLanguageCandidate(lang) || DEFAULT_LANG;
  const preferredTemplate = getNestedValue(LOCALES[preferredLang], key);
  const fallbackTemplate = getNestedValue(LOCALES[DEFAULT_LANG], key);
  const alternateLang = SUPPORTED_LANGS.find((candidate) => candidate !== preferredLang);
  const alternateTemplate = alternateLang
    ? getNestedValue(LOCALES[alternateLang], key)
    : undefined;
  const template = typeof preferredTemplate === "string"
    ? preferredTemplate
    : typeof fallbackTemplate === "string"
      ? fallbackTemplate
      : typeof alternateTemplate === "string"
        ? alternateTemplate
      : key;

  return interpolate(template, params);
}

module.exports = {
  DEFAULT_LANG,
  SUPPORTED_LANGS,
  getRequestLang,
  localizeField,
  normalizeLanguageCandidate,
  parseHeaderPreferences,
  pickLang,
  t,
};
