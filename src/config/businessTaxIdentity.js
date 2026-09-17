"use strict";

function envText(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === null || String(value).trim() === ""
    ? fallback
    : String(value).trim();
}

const BUSINESS_TAX_IDENTITY = Object.freeze({
  legalNameAr: envText("BUSINESS_LEGAL_NAME_AR", "مؤسسة بيسيك دايت"),
  legalNameEn: envText("BUSINESS_LEGAL_NAME_EN", "Basic Diet Establishment"),
  vatRegistrationNumber: envText("BUSINESS_VAT_NUMBER", "313015429700003"),
  crNumber: envText("BUSINESS_CR_NUMBER", "7050136014"),
  addressAr: envText(
    "BUSINESS_ADDRESS_AR",
    "جدة - حي الصفا - المغيرة بن عبدالله - 23455"
  ),
  addressEn: envText(
    "BUSINESS_ADDRESS_EN",
    "Jeddah - As Safa Dist - Al Mughirah Bin Abdullah - 23455"
  ),
  vatEffectiveAt: envText(
    "BUSINESS_VAT_EFFECTIVE_AT",
    "2025-10-01T00:00:00+03:00"
  ),
});

module.exports = {
  BUSINESS_TAX_IDENTITY,
};
