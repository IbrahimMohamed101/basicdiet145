const { getRequestLang, localizeField, SUPPORTED_LANGS, t } = require("../utils/i18n");

function requestLanguageMiddleware(req, _res, next) {
  const language = getRequestLang(req);

  req.language = language;
  req.lang = language;
  req.i18n = {
    language,
    lang: language,
    supportedLanguages: [...SUPPORTED_LANGS],
    t: (key, params = {}) => t(key, language, params),
    localizeField: (value) => localizeField(value, language),
  };

  next();
}

module.exports = requestLanguageMiddleware;
