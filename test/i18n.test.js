const test = require("node:test");
const assert = require("node:assert/strict");

const requestLanguageMiddleware = require("../src/middleware/requestLanguage");
const {
  DEFAULT_LANG,
  SUPPORTED_LANGS,
  getRequestLang,
  localizeField,
  t,
} = require("../src/utils/i18n");

test("getRequestLang prefers a valid attached req.language over query and headers", () => {
  const req = {
    language: "ar",
    query: { lang: "en" },
    headers: { "accept-language": "en-US,en;q=0.9" },
  };

  assert.equal(getRequestLang(req), "ar");
});

test("getRequestLang reuses a valid attached req.lang when req.language is absent", () => {
  const req = {
    lang: "en",
    query: { lang: "ar" },
    headers: { "accept-language": "ar-SA,ar;q=0.9" },
  };

  assert.equal(getRequestLang(req), "en");
});

test("getRequestLang gives query lang priority over Accept-Language header", () => {
  const req = {
    query: { lang: "en" },
    headers: { "accept-language": "ar-SA,ar;q=0.9,en;q=0.8" },
  };

  assert.equal(getRequestLang(req), "en");
});

test("getRequestLang resolves common Accept-Language header patterns safely", () => {
  assert.equal(
    getRequestLang({ headers: { "accept-language": "en-US,en;q=0.9,ar;q=0.8" } }),
    "en"
  );
  assert.equal(getRequestLang({ headers: { "accept-language": "ar-SA" } }), "ar");
  assert.equal(getRequestLang({ headers: { "accept-language": "en" } }), "en");
});

test("getRequestLang falls back safely for unsupported or missing values", () => {
  assert.equal(
    getRequestLang({
      query: { lang: "fr" },
      headers: { "accept-language": "de-DE,de;q=0.9" },
    }),
    DEFAULT_LANG
  );
  assert.equal(getRequestLang({}), DEFAULT_LANG);
});

test("localizeField handles strings, bilingual objects, fallback, and nullish values", () => {
  assert.equal(localizeField("Legacy value", "en"), "Legacy value");
  assert.equal(localizeField({ ar: "مرحبا", en: "Hello" }, "en"), "Hello");
  assert.equal(localizeField({ ar: "مرحبا" }, "en"), "مرحبا");
  assert.equal(localizeField(null, "ar"), "");
  assert.equal(localizeField(undefined, "en"), "");
});

test("t resolves requested locale, interpolates params, and falls back safely", () => {
  assert.equal(t("foundation.greeting", "en", { name: "Sara" }), "Hello Sara");
  assert.equal(t("foundation.greeting", "ar", { name: "سارة" }), "مرحبا سارة");
  assert.equal(t("foundation.defaultOnly", "en"), "النص الافتراضي");
  assert.equal(t("foundation.missingKey", "en"), "foundation.missingKey");
});

test("requestLanguageMiddleware attaches request language context and keeps helper consistency", () => {
  const req = {
    query: { lang: "en" },
    headers: { "accept-language": "ar-SA,ar;q=0.9" },
  };

  let nextCalled = false;
  requestLanguageMiddleware(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.language, "en");
  assert.equal(req.lang, "en");
  assert.deepEqual(req.i18n.supportedLanguages, SUPPORTED_LANGS);
  assert.equal(req.i18n.language, "en");
  assert.equal(req.i18n.lang, "en");
  assert.equal(typeof req.i18n.t, "function");
  assert.equal(typeof req.i18n.localizeField, "function");
  assert.equal(req.i18n.t("foundation.greeting", { name: "Sara" }), "Hello Sara");
  assert.equal(req.i18n.localizeField({ ar: "مرحبا", en: "Hello" }), "Hello");
  assert.equal(getRequestLang(req), "en");
});

