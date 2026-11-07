"use strict";

// D-088: all POS prices are VAT inclusive; round HALF_UP once per invoice
// line, using integer halalas only. This module never accepts float money.
class PosInvoiceMathError extends Error {
  constructor(message, code = "POS_DISCOUNT_INVALID") {
    super(message);
    this.code = code;
    this.status = 400;
  }
}
const MAX_HALALAS = 1_000_000_000;
const safeAmount = (x) => Number.isSafeInteger(x) && x >= 0 && x <= MAX_HALALAS;
function invalid(message) { throw new PosInvoiceMathError(message); }
function assertAmount(value, message = "قيمة المبلغ غير صالحة.") {
  if (!safeAmount(value)) invalid(message);
  return value;
}
function normalizeDiscount(discount) {
  if (discount == null) return null;
  if (!discount || !["percent", "fixed"].includes(discount.type)) invalid("نوع الخصم غير صالح.");
  if (discount.type === "fixed") {
    return { type: "fixed", value: assertAmount(discount.value, "قيمة الخصم غير صالحة.") };
  }
  // Hundredths of one percent, e.g. 10.25% = 1025 bps.
  const scaled = discount.value * 100;
  if (!Number.isFinite(scaled) || !Number.isSafeInteger(Math.round(scaled))
    || Math.abs(scaled - Math.round(scaled)) > 1e-8 || scaled < 0 || scaled > 10000) {
    invalid("نسبة الخصم يجب أن تكون بين صفر و100% بحد أقصى منزلتين عشريتين.");
  }
  return { type: "percent", value: Math.round(scaled) };
}
function applyDiscount(gross, discount) {
  if (!discount) return 0;
  const amount = discount.type === "fixed"
    ? discount.value
    : Math.floor((gross * discount.value + 5000) / 10000);
  if (amount > gross) invalid("الخصم أكبر من قيمة السطر أو الفاتورة؛ لا يمكن إصدار إجمالي سالب.");
  return amount;
}
function vatOnInclusiveGross(gross) {
  assertAmount(gross);
  return Math.floor((gross * 30 + 115) / 230);
}
function pricePosInvoice(input, options = {}) {
  const { lines, invoiceDiscount } = input || {};
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) invalid("سطور الفاتورة غير صالحة.");
  const cap = options.cashierDiscountCapHalalas ?? null;
  if (cap !== null) assertAmount(cap, "إعداد سقف خصم الكاشير غير صالح.");
  const prepared = lines.map((line, index) => {
    if (!line || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 990
      || !safeAmount(line.unitPriceHalalas) || !safeAmount(line.unitPriceHalalas * line.quantity)) {
      invalid("سعر أو كمية سطر الفاتورة غير صالح.");
    }
    const beforeDiscountHalalas = line.quantity * line.unitPriceHalalas;
    const discount = normalizeDiscount(line.discount);
    const lineDiscountHalalas = applyDiscount(beforeDiscountHalalas, discount);
    const afterLineDiscountHalalas = beforeDiscountHalalas - lineDiscountHalalas;
    return { ...line, index, beforeDiscountHalalas, discount,
      lineDiscountHalalas, afterLineDiscountHalalas };
  });
  const base = prepared.reduce((sum, line) => sum + line.afterLineDiscountHalalas, 0);
  assertAmount(base, "إجمالي السطور أكبر من الحد المسموح.");
  const invDiscount = normalizeDiscount(invoiceDiscount);
  const invoiceDiscountHalalas = applyDiscount(base, invDiscount);
  const allocation = prepared.map(() => 0);
  if (invoiceDiscountHalalas > 0 && base > 0) {
    const fractions = prepared.map((line, index) => {
      const numerator = invoiceDiscountHalalas * line.afterLineDiscountHalalas;
      const quotient = Math.floor(numerator / base);
      allocation[index] = quotient;
      return { index, remainder: numerator % base, amount: line.afterLineDiscountHalalas };
    });
    let remaining = invoiceDiscountHalalas - allocation.reduce((a, b) => a + b, 0);
    fractions.sort((a, b) => b.remainder - a.remainder || b.amount - a.amount || a.index - b.index);
    for (const f of fractions) {
      if (remaining-- <= 0) break;
      allocation[f.index] += 1;
    }
  }
  const priced = prepared.map((line, index) => {
    const invoiceDiscountPartHalalas = allocation[index];
    const grossHalalas = line.afterLineDiscountHalalas - invoiceDiscountPartHalalas;
    if (grossHalalas < 0) invalid("الخصم جعل قيمة السطر بالسالب.");
    const vatHalalas = vatOnInclusiveGross(grossHalalas);
    return { ...line,
      invoiceDiscountPartHalalas,
      grossHalalas, vatHalalas, netHalalas: grossHalalas - vatHalalas,
    };
  });
  const totals = priced.reduce((out, line) => {
    out.beforeDiscountHalalas += line.beforeDiscountHalalas;
    out.lineDiscountHalalas += line.lineDiscountHalalas;
    out.grossHalalas += line.grossHalalas;
    out.vatHalalas += line.vatHalalas;
    out.netHalalas += line.netHalalas;
    return out;
  }, { beforeDiscountHalalas: 0, lineDiscountHalalas: 0,
    grossHalalas: 0, vatHalalas: 0, netHalalas: 0 });
  Object.values(totals).forEach((n) => assertAmount(n, "الإجمالي تجاوز الحد الآمن."));
  const totalDiscountHalalas = totals.lineDiscountHalalas + invoiceDiscountHalalas;
  if (cap !== null && totalDiscountHalalas > cap) invalid("مجموع الخصومات تجاوز سقف الكاشير.");
  if (totals.beforeDiscountHalalas !== totals.grossHalalas + totalDiscountHalalas
    || totals.grossHalalas !== totals.netHalalas + totals.vatHalalas
    || allocation.reduce((a, b) => a + b, 0) !== invoiceDiscountHalalas) {
    invalid("خطأ في توزيع الخصومات أو الضريبة.");
  }
  return { lines: priced, totals: { ...totals, invoiceDiscountHalalas, totalDiscountHalalas },
    rounding: "HALF_UP_PER_LINE", vatRate: "15%", currency: "SAR" };
}
module.exports = { pricePosInvoice, vatOnInclusiveGross, PosInvoiceMathError };
