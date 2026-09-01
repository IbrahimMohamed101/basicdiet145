"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const Payment = require("../../models/Payment");
const CheckoutDraft = require("../../models/CheckoutDraft");
const PaymentRefund = require("../../models/PaymentRefund");
const {
  calculateVatBreakdownFromInclusiveTotal,
  getSystemVatPercentage,
} = require("../../config/vat");
const { BUSINESS_TAX_IDENTITY } = require("../../config/businessTaxIdentity");

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function sumHalala(rows, field = "totalHalala") {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
    const value = toNonNegativeInteger(row && row[field]);
    return sum + (value || 0);
  }, 0);
}

function sumSignedLineItems(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
    const amount = Number(row && row.amountHalala);
    return sum + (Number.isFinite(amount) ? Math.round(amount) : 0);
  }, 0);
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function localizedName(value) {
  if (!value) return { ar: "", en: "" };
  if (typeof value === "string") return { ar: value, en: value };
  return {
    ar: text(value.ar || value.arabic || value.nameAr),
    en: text(value.en || value.english || value.nameEn),
  };
}

function firstMoneyValue(...values) {
  for (const value of values) {
    const normalized = toNonNegativeInteger(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function buildLegacyInvoiceNumber(subscription) {
  const createdAt = new Date(subscription.createdAt || subscription.startDate || Date.now());
  const fallback = new Date();
  const source = Number.isFinite(createdAt.getTime()) ? createdAt : fallback;
  const year = source.getUTCFullYear();
  const month = String(source.getUTCMonth() + 1).padStart(2, "0");
  const suffix = String(subscription._id || "").slice(-8).toUpperCase();
  return `INV-${year}${month}-${suffix}`;
}

function buildInvoiceNumber(subscription, payment, issuedAt, options = {}) {
  if (!payment || options.preserveLegacy === true) {
    return buildLegacyInvoiceNumber(subscription);
  }

  const createdAt = new Date(
    issuedAt || payment.paidAt || payment.createdAt || subscription.createdAt || subscription.startDate || Date.now()
  );
  const fallback = new Date();
  const source = Number.isFinite(createdAt.getTime()) ? createdAt : fallback;
  const year = source.getUTCFullYear();
  const month = String(source.getUTCMonth() + 1).padStart(2, "0");
  const suffix = String(payment._id || "").slice(-10).toUpperCase();
  return `INV-${year}${month}-${suffix}`;
}

function paymentTimestamp(payment) {
  const value = payment && (payment.paidAt || payment.createdAt);
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.getTime() : Number.MAX_SAFE_INTEGER;
}

function findLegacyPrimaryInvoicePayment(payments) {
  const rows = Array.isArray(payments) ? payments.filter(Boolean) : [];
  if (rows.length === 0) return null;

  const activationPayments = rows
    .filter((row) => text(row.type) === "subscription_activation")
    .sort((a, b) => paymentTimestamp(a) - paymentTimestamp(b));
  if (activationPayments.length > 0) return activationPayments[0];

  return [...rows].sort((a, b) => paymentTimestamp(a) - paymentTimestamp(b))[0] || null;
}

function resolvePaymentMethod(payment) {
  if (!payment) return null;
  const raw = text(
    payment.method ||
      (payment.metadata && payment.metadata.paymentMethod) ||
      payment.provider
  ).toLowerCase();
  if (raw === "cash") return "cash";
  if (["visa", "card", "credit_card", "credit-card", "mada"].includes(raw)) return "visa";
  if (payment.provider === "moyasar") return "moyasar";
  return raw || null;
}

async function findInvoicePayments(subscriptionId) {
  return Payment.find({
    subscriptionId,
    status: { $in: ["paid", "refunded"] },
    type: { $in: ["subscription_activation", "subscription_renewal"] },
  })
    .sort({ paidAt: -1, createdAt: -1 })
    .populate("collectedBy", "email role")
    .lean();
}

async function resolveCheckoutDraft(payment) {
  if (!payment) return null;

  if (payment.checkoutDraftId && mongoose.Types.ObjectId.isValid(payment.checkoutDraftId)) {
    const linked = await CheckoutDraft.findById(payment.checkoutDraftId).lean();
    if (linked) return linked;
  }

  return CheckoutDraft.findOne({ paymentId: payment._id }).sort({ createdAt: -1 }).lean();
}

function buildPersistedLineItems(subscription) {
  const planHalala =
    firstMoneyValue(subscription.basePlanPriceHalala, subscription.basePlanGrossHalala) || 0;
  const premiumHalala = sumHalala(subscription.premiumBalance);
  const addonsHalala = sumHalala(subscription.addonSubscriptions);
  const deliveryHalala = toNonNegativeInteger(subscription.deliveryFeeHalala) || 0;
  const discountHalala = toNonNegativeInteger(subscription.discountHalala) || 0;

  const rows = [
    { kind: "plan", labelAr: "الاشتراك الأساسي", amountHalala: planHalala },
    { kind: "premium", labelAr: "الوجبات المميزة", amountHalala: premiumHalala },
    { kind: "addons", labelAr: "اشتراكات الإضافات", amountHalala: addonsHalala },
    { kind: "delivery", labelAr: "رسوم التوصيل", amountHalala: deliveryHalala },
  ].filter((row) => row.amountHalala > 0);

  if (discountHalala > 0) {
    rows.push({ kind: "discount", labelAr: "الخصم", amountHalala: -discountHalala });
  }
  return rows;
}

function buildCheckoutDraftLineItems(checkoutDraft) {
  const breakdown = checkoutDraft && checkoutDraft.breakdown;
  if (!breakdown || typeof breakdown !== "object") return [];

  const planHalala =
    firstMoneyValue(breakdown.basePlanGrossHalala, breakdown.basePlanPriceHalala) || 0;
  const premiumHalala = toNonNegativeInteger(breakdown.premiumTotalHalala) || 0;
  const addonsHalala = toNonNegativeInteger(breakdown.addonsTotalHalala) || 0;
  const deliveryHalala = toNonNegativeInteger(breakdown.deliveryFeeHalala) || 0;
  const discountHalala = toNonNegativeInteger(breakdown.discountHalala) || 0;

  const rows = [
    { kind: "plan", labelAr: "الاشتراك الأساسي", amountHalala: planHalala },
    { kind: "premium", labelAr: "الوجبات المميزة", amountHalala: premiumHalala },
    { kind: "addons", labelAr: "اشتراكات الإضافات", amountHalala: addonsHalala },
    { kind: "delivery", labelAr: "رسوم التوصيل", amountHalala: deliveryHalala },
  ].filter((row) => row.amountHalala > 0);

  if (discountHalala > 0) {
    rows.push({ kind: "discount", labelAr: "الخصم", amountHalala: -discountHalala });
  }
  return rows;
}

function reconcileLineItemsToTotal(rows, totalHalala) {
  const target = toNonNegativeInteger(totalHalala);
  if (target === null) return Array.isArray(rows) ? rows : [];

  const normalizedRows = Array.isArray(rows) ? [...rows] : [];
  if (normalizedRows.length === 0) {
    return [
      {
        kind: "historical_payment_total",
        labelAr: "المبلغ المدفوع تاريخياً",
        amountHalala: target,
      },
    ];
  }

  const difference = target - sumSignedLineItems(normalizedRows);
  if (difference !== 0) {
    normalizedRows.push({
      kind: "payment_reconciliation_adjustment",
      labelAr: "تسوية مع سجل الدفع",
      amountHalala: difference,
    });
  }
  return normalizedRows;
}

function buildInvoiceFinancialSnapshot({ subscription, payment, checkoutDraft, paymentCount = 0 }) {
  const paymentAmountHalala = payment ? toNonNegativeInteger(payment.amount) : null;
  const subscriptionTotalHalala = toNonNegativeInteger(subscription.totalPriceHalala);
  const hasStoredSubscriptionTotal = subscriptionTotalHalala !== null && subscriptionTotalHalala > 0;
  const draftBreakdown = checkoutDraft && checkoutDraft.breakdown && typeof checkoutDraft.breakdown === "object"
    ? checkoutDraft.breakdown
    : null;
  const draftTotalHalala = draftBreakdown
    ? toNonNegativeInteger(draftBreakdown.totalHalala)
    : null;
  const hasDraftTotal = draftTotalHalala !== null;
  const multiplePayments = paymentCount > 1;

  const authoritativeTotalHalala = paymentAmountHalala !== null
    ? paymentAmountHalala
    : hasDraftTotal
      ? draftTotalHalala
      : hasStoredSubscriptionTotal
        ? subscriptionTotalHalala
        : null;

  let snapshotSource = "unavailable";
  let lineItems = [];
  let discountHalala = 0;
  let deliveryFeeHalala = 0;
  let basePlanGrossHalala = null;
  let basePlanNetHalala = null;

  if (draftBreakdown) {
    snapshotSource = "checkout_draft";
    lineItems = buildCheckoutDraftLineItems(checkoutDraft);
    discountHalala = toNonNegativeInteger(draftBreakdown.discountHalala) || 0;
    deliveryFeeHalala = toNonNegativeInteger(draftBreakdown.deliveryFeeHalala) || 0;
    basePlanGrossHalala = firstMoneyValue(
      draftBreakdown.basePlanGrossHalala,
      draftBreakdown.basePlanPriceHalala
    );
    basePlanNetHalala = firstMoneyValue(
      draftBreakdown.basePlanNetHalala,
      draftBreakdown.basePlanPriceHalala
    );
  } else if (payment) {
    const safeToUseSubscriptionBreakdown =
      !multiplePayments &&
      paymentAmountHalala !== null &&
      hasStoredSubscriptionTotal &&
      paymentAmountHalala === subscriptionTotalHalala;

    if (safeToUseSubscriptionBreakdown) {
      snapshotSource = "subscription_snapshot_matched_payment";
      lineItems = buildPersistedLineItems(subscription);
      discountHalala = toNonNegativeInteger(subscription.discountHalala) || 0;
      deliveryFeeHalala = toNonNegativeInteger(subscription.deliveryFeeHalala) || 0;
      basePlanGrossHalala = firstMoneyValue(
        subscription.basePlanGrossHalala,
        subscription.basePlanPriceHalala
      );
      basePlanNetHalala = firstMoneyValue(
        subscription.basePlanNetHalala,
        subscription.basePlanPriceHalala
      );
    } else {
      // When multiple purchases share one Subscription, its financial fields are
      // aggregate/current state and cannot safely describe one historical payment.
      // Use the immutable Payment amount instead of inventing a breakdown from
      // today's subscription/catalog values.
      snapshotSource = "payment_record";
      lineItems = paymentAmountHalala === null
        ? []
        : [{
            kind: "historical_payment_total",
            labelAr: "المبلغ المدفوع تاريخياً",
            amountHalala: paymentAmountHalala,
          }];
    }
  } else if (hasStoredSubscriptionTotal) {
    snapshotSource = "subscription_snapshot";
    lineItems = buildPersistedLineItems(subscription);
    discountHalala = toNonNegativeInteger(subscription.discountHalala) || 0;
    deliveryFeeHalala = toNonNegativeInteger(subscription.deliveryFeeHalala) || 0;
    basePlanGrossHalala = firstMoneyValue(
      subscription.basePlanGrossHalala,
      subscription.basePlanPriceHalala
    );
    basePlanNetHalala = firstMoneyValue(
      subscription.basePlanNetHalala,
      subscription.basePlanPriceHalala
    );
  }

  lineItems = reconcileLineItemsToTotal(lineItems, authoritativeTotalHalala);

  const draftPaymentMismatch =
    paymentAmountHalala !== null && hasDraftTotal
      ? paymentAmountHalala !== draftTotalHalala
      : false;
  const singlePaymentSubscriptionMismatch =
    paymentAmountHalala !== null && hasStoredSubscriptionTotal && !multiplePayments
      ? paymentAmountHalala !== subscriptionTotalHalala
      : false;

  let reconciliationStatus = "balanced_or_single_source";
  if (draftPaymentMismatch) {
    reconciliationStatus = "payment_authoritative_snapshot_mismatch";
  } else if (singlePaymentSubscriptionMismatch) {
    reconciliationStatus = "payment_authoritative_subscription_mismatch";
  } else if (multiplePayments) {
    reconciliationStatus = "payment_scoped_multi_purchase";
  }

  return {
    authoritativeTotalHalala,
    paymentAmountHalala,
    subscriptionTotalHalala: hasStoredSubscriptionTotal ? subscriptionTotalHalala : null,
    draftTotalHalala: hasDraftTotal ? draftTotalHalala : null,
    financialDataComplete: authoritativeTotalHalala !== null,
    snapshotSource,
    lineItems,
    discountHalala,
    deliveryFeeHalala,
    basePlanGrossHalala,
    basePlanNetHalala,
    multiplePayments,
    draftPaymentMismatch,
    singlePaymentSubscriptionMismatch,
    reconciliationStatus,
  };
}

function buildRefundSummary(refunds) {
  const rows = (Array.isArray(refunds) ? refunds : []).map((refund) => {
    const amountHalala = toNonNegativeInteger(refund && refund.amountHalala) || 0;
    const executionMode = text(refund && refund.executionMode);
    const rawSettled = toNonNegativeInteger(
      refund && refund.settlement && refund.settlement.settledAmountHalala
    ) || 0;
    const settledAmountHalala = executionMode === "provider_confirmed"
      ? amountHalala
      : Math.min(amountHalala, rawSettled);

    return {
      id: refund && refund._id ? String(refund._id) : "",
      amountHalala,
      vatHalala: toNonNegativeInteger(refund && refund.vatHalala) || 0,
      status: text(refund && refund.status),
      executionMode,
      refundChannel: text(refund && refund.refundChannel),
      refundedAt: toIso(refund && refund.refundedAt),
      settledAmountHalala,
      settlementStatus: text(refund && refund.settlement && refund.settlement.status),
      settlementMethod: text(refund && refund.settlement && refund.settlement.method),
      settledAt: toIso(refund && refund.settlement && refund.settlement.settledAt),
      reference: text(refund && refund.settlement && refund.settlement.reference),
    };
  });

  const recognizedAmountHalala = rows.reduce((sum, row) => sum + row.amountHalala, 0);
  const settledAmountHalala = rows.reduce((sum, row) => sum + row.settledAmountHalala, 0);

  return {
    recognizedAmountHalala,
    settledAmountHalala,
    pendingSettlementAmountHalala: Math.max(0, recognizedAmountHalala - settledAmountHalala),
    rows,
  };
}

function formatSarFromHalala(amountHalala) {
  const normalized = toNonNegativeInteger(amountHalala) || 0;
  return (normalized / 100).toFixed(2);
}

function encodeTlvField(tag, value) {
  const valueBuffer = Buffer.from(String(value), "utf8");
  if (valueBuffer.length > 255) {
    throw new Error(`QR TLV field ${tag} exceeds 255 bytes`);
  }
  return Buffer.concat([Buffer.from([tag, valueBuffer.length]), valueBuffer]);
}

function buildLocalTaxQrPayload({ sellerName, vatNumber, issuedAt, totalHalala, vatHalala }) {
  return Buffer.concat([
    encodeTlvField(1, sellerName),
    encodeTlvField(2, vatNumber),
    encodeTlvField(3, issuedAt),
    encodeTlvField(4, formatSarFromHalala(totalHalala)),
    encodeTlvField(5, formatSarFromHalala(vatHalala)),
  ]).toString("base64");
}

function isTaxRegistrationEffectiveAt(issuedAt) {
  if (!issuedAt) return false;
  const issueDate = new Date(issuedAt);
  const effectiveDate = new Date(BUSINESS_TAX_IDENTITY.vatEffectiveAt);
  if (!Number.isFinite(issueDate.getTime()) || !Number.isFinite(effectiveDate.getTime())) {
    return false;
  }
  return issueDate.getTime() >= effectiveDate.getTime();
}

async function getSubscriptionInvoice(req, res) {
  const subscriptionId = text(req.params && req.params.subscriptionId);
  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
    return res.status(400).json({
      status: false,
      message: "Invalid subscription id",
      messageAr: "معرّف الاشتراك غير صالح",
      error: { code: "INVALID_SUBSCRIPTION_ID" },
    });
  }

  const requestedPaymentId = text(req.query && req.query.paymentId);
  if (requestedPaymentId && !mongoose.Types.ObjectId.isValid(requestedPaymentId)) {
    return res.status(400).json({
      status: false,
      message: "Invalid payment id",
      messageAr: "معرّف عملية الدفع غير صالح",
      error: { code: "INVALID_PAYMENT_ID" },
    });
  }

  const subscription = await Subscription.findById(subscriptionId)
    .populate("userId", "name phone phoneE164 email")
    .populate("planId", "name daysCount durationDays currency")
    .lean();

  if (!subscription) {
    return res.status(404).json({
      status: false,
      message: "Subscription not found",
      messageAr: "الاشتراك غير موجود",
      error: { code: "SUBSCRIPTION_NOT_FOUND" },
    });
  }

  const payments = await findInvoicePayments(subscription._id);
  const payment = requestedPaymentId
    ? payments.find((row) => String(row._id) === requestedPaymentId) || null
    : payments[0] || null;

  if (requestedPaymentId && !payment) {
    return res.status(404).json({
      status: false,
      message: "Payment is not an invoice-eligible payment for this subscription",
      messageAr: "عملية الدفع لا تخص فاتورة شراء لهذا الاشتراك",
      error: { code: "INVOICE_PAYMENT_NOT_FOUND" },
    });
  }

  const legacyPrimaryPayment = findLegacyPrimaryInvoicePayment(payments);
  const preserveLegacyInvoiceNumber = Boolean(
    payment &&
      legacyPrimaryPayment &&
      String(payment._id) === String(legacyPrimaryPayment._id)
  );

  const checkoutDraft = await resolveCheckoutDraft(payment);
  const financialSnapshot = buildInvoiceFinancialSnapshot({
    subscription,
    payment,
    checkoutDraft,
    paymentCount: payments.length,
  });
  const {
    authoritativeTotalHalala,
    paymentAmountHalala,
    financialDataComplete,
    lineItems,
  } = financialSnapshot;

  const refundRows = payment
    ? await PaymentRefund.find({ paymentId: payment._id }).sort({ refundedAt: 1, createdAt: 1 }).lean()
    : [];
  const refunds = buildRefundSummary(refundRows);

  const user = subscription.userId && typeof subscription.userId === "object"
    ? subscription.userId
    : {};
  const plan = subscription.planId && typeof subscription.planId === "object"
    ? subscription.planId
    : {};
  const collectedBy = payment && payment.collectedBy && typeof payment.collectedBy === "object"
    ? payment.collectedBy
    : null;
  const currency = text(
    (payment && payment.currency) ||
      (checkoutDraft && checkoutDraft.breakdown && checkoutDraft.breakdown.currency) ||
      subscription.checkoutCurrency ||
      plan.currency ||
      "SAR"
  ).toUpperCase() || "SAR";

  const paidAt = payment ? toIso(payment.paidAt || payment.createdAt) : null;
  const issuedAt = paidAt || toIso(subscription.createdAt) || toIso(subscription.startDate);

  const taxRegistrationEffective = isTaxRegistrationEffectiveAt(issuedAt);
  const taxInvoiceEligible = financialDataComplete && taxRegistrationEffective && currency === "SAR";
  const vatBreakdown = taxInvoiceEligible
    ? calculateVatBreakdownFromInclusiveTotal(authoritativeTotalHalala)
    : null;
  const vatPercentage = vatBreakdown ? vatBreakdown.vatPercentage : getSystemVatPercentage();
  const vatHalala = vatBreakdown ? vatBreakdown.vatHalala : 0;
  const subtotalExcludingVatHalala = vatBreakdown
    ? vatBreakdown.subtotalExcludingVatHalala
    : null;
  const qrPayloadBase64 = taxInvoiceEligible
    ? buildLocalTaxQrPayload({
        sellerName: BUSINESS_TAX_IDENTITY.legalNameAr,
        vatNumber: BUSINESS_TAX_IDENTITY.vatRegistrationNumber,
        issuedAt,
        totalHalala: authoritativeTotalHalala,
        vatHalala,
      })
    : null;

  const availablePayments = payments.map((row) => ({
    id: String(row._id),
    type: text(row.type),
    status: text(row.status),
    amountHalala: toNonNegativeInteger(row.amount) || 0,
    currency: text(row.currency || "SAR").toUpperCase() || "SAR",
    provider: text(row.provider),
    method: resolvePaymentMethod(row),
    paidAt: toIso(row.paidAt || row.createdAt),
  }));

  return res.json({
    status: true,
    data: {
      invoiceNumber: buildInvoiceNumber(subscription, payment, issuedAt, {
        preserveLegacy: preserveLegacyInvoiceNumber,
      }),
      issuedAt,
      historical: true,
      invoiceType: taxInvoiceEligible ? "simplified_tax_invoice" : "subscription_invoice",
      selectedPaymentId: payment ? String(payment._id) : null,
      availablePayments,
      seller: {
        legalNameAr: BUSINESS_TAX_IDENTITY.legalNameAr,
        legalNameEn: BUSINESS_TAX_IDENTITY.legalNameEn,
        vatRegistrationNumber: BUSINESS_TAX_IDENTITY.vatRegistrationNumber,
        crNumber: BUSINESS_TAX_IDENTITY.crNumber,
        addressAr: BUSINESS_TAX_IDENTITY.addressAr,
        addressEn: BUSINESS_TAX_IDENTITY.addressEn,
      },
      tax: {
        taxInvoiceEligible,
        registrationEffective: taxRegistrationEffective,
        registrationEffectiveAt: BUSINESS_TAX_IDENTITY.vatEffectiveAt,
        vatPercentage,
        priceIncludesVat: true,
        subtotalExcludingVatHalala,
        vatHalala,
        totalIncludingVatHalala: taxInvoiceEligible ? authoritativeTotalHalala : null,
        qr: qrPayloadBase64
          ? {
              payloadBase64: qrPayloadBase64,
              encoding: "TLV_BASE64",
              generatedLocally: true,
              zatcaIntegration: false,
              fields: [
                "seller_name",
                "vat_registration_number",
                "invoice_timestamp",
                "invoice_total_including_vat",
                "vat_total",
              ],
            }
          : null,
      },
      customer: {
        id: user._id ? String(user._id) : String(subscription.userId || ""),
        name: text(user.name),
        phone: text(user.phoneE164 || user.phone),
        email: text(user.email),
      },
      subscription: {
        id: String(subscription._id),
        displayId: text(subscription.displayId) || `SUB-${String(subscription._id).slice(-6).toUpperCase()}`,
        status: text(subscription.status),
        planName: localizedName(plan.name),
        startDate: toIso(subscription.startDate),
        endDate: toIso(subscription.endDate),
        validityEndDate: toIso(subscription.validityEndDate),
        selectedGrams: toNonNegativeInteger(subscription.selectedGrams),
        selectedMealsPerDay: toNonNegativeInteger(subscription.selectedMealsPerDay),
        totalMeals: toNonNegativeInteger(subscription.totalMeals),
        deliveryMode: text(subscription.deliveryMode),
        deliveryZoneName: text(subscription.deliveryZoneName),
      },
      financial: {
        currency,
        source: payment
          ? "payment"
          : financialSnapshot.subscriptionTotalHalala !== null
            ? "subscription_snapshot"
            : "unavailable",
        snapshotSource: financialSnapshot.snapshotSource,
        financialDataComplete,
        reconciliationStatus: financialSnapshot.reconciliationStatus,
        lineItems,
        basePlanGrossHalala: financialSnapshot.basePlanGrossHalala,
        basePlanNetHalala: financialSnapshot.basePlanNetHalala,
        discountHalala: financialSnapshot.discountHalala,
        subtotalHalala: subtotalExcludingVatHalala,
        subtotalBeforeVatHalala: subtotalExcludingVatHalala,
        deliveryFeeHalala: financialSnapshot.deliveryFeeHalala,
        vatPercentage,
        vatHalala,
        priceIncludesVat: taxInvoiceEligible,
        subscriptionTotalHalala: financialSnapshot.subscriptionTotalHalala,
        checkoutDraftTotalHalala: financialSnapshot.draftTotalHalala,
        paidAmountHalala: paymentAmountHalala,
        totalHalala: authoritativeTotalHalala,
      },
      payment: payment
        ? {
            id: String(payment._id),
            type: text(payment.type),
            status: text(payment.status),
            method: resolvePaymentMethod(payment),
            provider: text(payment.provider),
            paidAt,
            refunded: payment.status === "refunded" || refunds.recognizedAmountHalala > 0,
          }
        : null,
      refunds,
      createdBy: collectedBy
        ? {
            id: collectedBy._id ? String(collectedBy._id) : null,
            email: text(collectedBy.email),
            role: text(collectedBy.role),
          }
        : null,
      warnings: [
        ...(!financialDataComplete
          ? [{ code: "FINANCIAL_DATA_INCOMPLETE", messageAr: "لا توجد قيمة دفع أو إجمالي تاريخي موثوق لهذا الاشتراك القديم." }]
          : []),
        ...(financialSnapshot.draftPaymentMismatch
          ? [{ code: "PAYMENT_SNAPSHOT_MISMATCH", messageAr: "يوجد اختلاف بين Snapshot الشراء وسجل الدفع؛ تم اعتماد المبلغ المدفوع الفعلي وإظهار تسوية واضحة داخل تفاصيل الفاتورة." }]
          : []),
        ...(financialSnapshot.singlePaymentSubscriptionMismatch
          ? [{ code: "PAYMENT_TOTAL_MISMATCH", messageAr: "يوجد اختلاف بين إجمالي الاشتراك التاريخي والمبلغ المدفوع؛ تم اعتماد سجل الدفع في الفاتورة دون إعادة تسعير من بيانات الاشتراك الحالية." }]
          : []),
        ...(payment && !checkoutDraft && payments.length > 1
          ? [{ code: "PAYMENT_BREAKDOWN_UNAVAILABLE", messageAr: "هذه عملية شراء قديمة داخل اشتراك متعدد الدفعات ولا يتوفر لها Snapshot تفصيلي؛ تم عرض المبلغ المدفوع الفعلي فقط لمنع خلط أسعار عمليات شراء مختلفة." }]
          : []),
        ...(payments.length > 1
          ? [{ code: "MULTIPLE_PURCHASE_INVOICES", messageAr: "هذا الاشتراك يحتوي أكثر من عملية شراء؛ لكل عملية دفع فاتورة مستقلة ويمكن اختيارها من قائمة الفواتير." }]
          : []),
        ...(!taxRegistrationEffective
          ? [{
              code: "PRE_VAT_EFFECTIVE_DATE",
              messageAr: "تاريخ هذه الفاتورة يسبق تاريخ نفاذ التسجيل في ضريبة القيمة المضافة؛ لذلك لا يتم إصدارها كفاتورة ضريبية ولا يتم توليد QR ضريبي لها.",
            }]
          : []),
      ],
    },
  });
}

module.exports = {
  getSubscriptionInvoice,
  buildLocalTaxQrPayload,
  buildInvoiceFinancialSnapshot,
  buildRefundSummary,
  buildInvoiceNumber,
  findLegacyPrimaryInvoicePayment,
};