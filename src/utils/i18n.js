/**
 * i18n utilities for multilingual content resolution.
 *
 * Supported languages: "ar" (Arabic, default) | "en" (English)
 *
 * Usage on read endpoints:
 *   const lang = getRequestLang(req);               // "ar" | "en"
 *   const name = pickLang(doc.name, lang);           // plain string
 */

const SUPPORTED_LANGS = ["ar", "en"];
const DEFAULT_LANG = "ar";

/**
 * Extract the preferred language from the request.
 * Reads the full `Accept-Language` header preference list and normalises
 * to "ar" or "en".
 * Defaults to "ar" when the header is absent or unrecognised.
 *
 * @param {import("express").Request} req
 * @returns {"ar"|"en"}
 */
function getRequestLang(req) {
  const raw = String(req.headers["accept-language"] || "").trim().toLowerCase();
  if (!raw) return DEFAULT_LANG;

  // Fix: parse RFC 7231 style language priorities (e.g. "de,de;q=0.9,en;q=0.8")
  const preferences = raw
    .split(",")
    .map((token, index) => {
      const part = token.trim();
      if (!part) return null;

      const [range, ...params] = part.split(";").map((s) => s.trim());
      const primary = range.split("-")[0];
      if (!primary) return null;

      let q = 1;
      for (const param of params) {
        if (!param.startsWith("q=")) continue;
        const qVal = Number(param.slice(2));
        if (Number.isFinite(qVal)) {
          q = Math.max(0, Math.min(1, qVal));
        }
      }

      return { primary, q, index };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.q !== a.q) return b.q - a.q;
      return a.index - b.index;
    });

  for (const pref of preferences) {
    if (pref.q <= 0) continue;
    if (SUPPORTED_LANGS.includes(pref.primary)) return pref.primary;
  }

  return DEFAULT_LANG;
}

/**
 * Pick the correct language string from a multilingual field.
 *
 * Handles three shapes for backward compatibility:
 *   1. `{ ar: "...", en: "..." }` — the new standard shape
 *   2. A plain `string` — old single-language values; returned as-is
 *   3. `null` / `undefined` — returns ""
 *
 * Fallback order when the requested language is empty/missing:
 *   requested lang → the other lang → ""
 *
 * @param {Object|string|null|undefined} obj  Multilingual field value
 * @param {"ar"|"en"} lang                    Preferred language
 * @returns {string}
 */
function pickLang(obj, lang) {
  if (!obj) return "";
  if (typeof obj === "string") return obj; // backward compat with old plain strings

  const preferred = obj[lang];
  if (preferred) return preferred;

  // Fallback to the other supported language
  const fallback = SUPPORTED_LANGS.find((l) => l !== lang && obj[l]);
  return fallback ? obj[fallback] : "";
}

module.exports = { getRequestLang, pickLang, SUPPORTED_LANGS, DEFAULT_LANG };
