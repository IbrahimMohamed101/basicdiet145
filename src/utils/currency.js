const SYSTEM_CURRENCY = "SAR";

function assertSystemCurrencyOrThrow(value, fieldName) {
  const currency = String(value || SYSTEM_CURRENCY).trim().toUpperCase();
  if (currency !== SYSTEM_CURRENCY) {
    const err = new Error(`${fieldName} must be ${SYSTEM_CURRENCY}`);
    err.code = "INVALID_CURRENCY";
    throw err;
  }
  return currency;
}

module.exports = {
  SYSTEM_CURRENCY,
  assertSystemCurrencyOrThrow,
};