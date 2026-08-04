from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("src/services/dashboard/subscriptionPaymentMethodReportService.js")
text = path.read_text(encoding="utf-8")

text = replace_once(
    text,
    '''function resolveSourceChannel(payment = {}) {
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const source = safeString(payment.source).toLowerCase();
  const origin = safeString(metadata.paymentOrigin || metadata.source).toLowerCase();
  if (source.startsWith("dashboard_") || origin === "dashboard" || metadata.recordingMode === "dashboard_manual") {
    return "dashboard";
  }
  if (
    source === "mobile_app_subscription"
    || origin === "mobile_app"
    || origin === "app"
    || metadata.recordingMode === "moyasar_gateway"
  ) {
    return "app";
  }
  return "unknown";
}
''',
    '''function resolveSourceChannel(payment = {}) {
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const source = safeString(payment.source).toLowerCase();
  const origin = safeString(metadata.paymentOrigin || metadata.source).toLowerCase();
  const provider = safeString(payment.provider).toLowerCase();
  if (
    source.startsWith("dashboard_")
    || origin === "dashboard"
    || metadata.recordingMode === "dashboard_manual"
    || payment.collectedBy
  ) {
    return "dashboard";
  }
  if (
    source === "mobile_app_subscription"
    || origin === "mobile_app"
    || origin === "app"
    || metadata.recordingMode === "moyasar_gateway"
    || provider === "moyasar"
    || safeString(payment.providerPaymentId)
    || safeString(payment.providerInvoiceId)
  ) {
    return "app";
  }
  return "unknown";
}
''',
    "resolveSourceChannel",
)

text = replace_once(
    text,
    '''function resolvePaymentProvider(payment = {}, paymentMethod = "unknown") {
  const provider = safeString(payment.provider).toLowerCase();
  if (provider === "moyasar") return "moyasar";
  if (provider === "manual") return "manual_gateway";
  if (provider === "cash" || paymentMethod === "cash") return "none";
  return "unknown";
}
''',
    '''function resolvePaymentProvider(payment = {}, paymentMethod = "unknown") {
  const provider = safeString(payment.provider).toLowerCase();
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  if (
    provider === "moyasar"
    || metadata.recordingMode === "moyasar_gateway"
    || safeString(payment.providerPaymentId)
    || safeString(payment.providerInvoiceId)
  ) return "moyasar";
  if (provider === "manual" || metadata.recordingMode === "dashboard_manual") return "manual_gateway";
  if (provider === "cash" || paymentMethod === "cash") return "none";
  return "unknown";
}
''',
    "resolvePaymentProvider",
)

text = replace_once(
    text,
    '''  const provider = safeString(payment.provider, "unknown").toLowerCase();
  const status = safeString(payment.status, "unknown").toLowerCase();
  const fulfillmentMethod = safeString(subscription && subscription.deliveryMode, "unknown").toLowerCase();
  const subscriptionStatus = safeString(subscription && subscription.status, "unknown").toLowerCase();
  const paymentType = safeString(payment.type, "unknown").toLowerCase();
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
''',
    '''  const provider = safeString(payment.provider, "unknown").toLowerCase();
  const status = safeString(payment.status, "unknown").toLowerCase();
  const paymentType = safeString(payment.type, "unknown").toLowerCase();
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const accountingSnapshot = metadata.accountingSnapshot && typeof metadata.accountingSnapshot === "object"
    ? metadata.accountingSnapshot
    : {};
  const fulfillmentMethod = safeString(
    accountingSnapshot.fulfillmentMethod
      || subscription && subscription.deliveryMode
      || metadata.fulfillmentMethod,
    "unknown"
  ).toLowerCase();
  const subscriptionStatus = safeString(
    accountingSnapshot.subscriptionStatus || subscription && subscription.status,
    "unknown"
  ).toLowerCase();
''',
    "serialize snapshot block",
)

text = replace_once(
    text,
    '''  const reviewReasonsAr = buildReviewReasons({
    paymentMethod,
    subscriptionStatus,
    amountMismatch,
    customerId,
    vatSource: vat.source,
  });
''',
    '''  const reviewReasonsAr = buildReviewReasons({
    paymentMethod,
    subscriptionStatus,
    amountMismatch,
    customerId,
    vatSource: vat.source,
  });
  if (!subscription) {
    reviewReasonsAr.unshift("سجل الاشتراك المرتبط بالدفعة غير موجود");
  }
''',
    "missing subscription review reason",
)

text = replace_once(
    text,
    '''    customerName: user ? safeString(user.name, user.phone) : "",
    customerPhone: user ? safeString(user.phone) : "",
    planId: safeString(subscription && subscription.planId),
    planNameAr: plan ? localizedName(plan.name) : "",
''',
    '''    customerName: user
      ? safeString(user.name, user.phone)
      : safeString(accountingSnapshot.customerName),
    customerPhone: user
      ? safeString(user.phone)
      : safeString(accountingSnapshot.customerPhone),
    planId: safeString(accountingSnapshot.planId || subscription && subscription.planId),
    planNameAr: plan ? localizedName(plan.name) : safeString(accountingSnapshot.planNameAr),
''',
    "snapshot presentation fields",
)

text = replace_once(
    text,
    '''    subscriptionPricing: {
''',
    '''    subscriptionRecordPresent: Boolean(subscription),
    subscriptionRecordPresentLabelAr: subscription ? "نعم" : "لا",
    subscriptionPricing: {
''',
    "subscription record flag",
)

text = replace_once(
    text,
    '''  const filteredRows = paymentsWithPeriods.filter(({ payment }) => {
    const subscription = subscriptionMap.get(safeString(payment.subscriptionId));
    if (!subscription) return false;
    return fulfillmentMethod === "all" || safeString(subscription.deliveryMode).toLowerCase() === fulfillmentMethod;
  });
''',
    '''  const filteredRows = paymentsWithPeriods.filter(({ payment }) => {
    const subscription = subscriptionMap.get(safeString(payment.subscriptionId));
    const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
    const accountingSnapshot = metadata.accountingSnapshot && typeof metadata.accountingSnapshot === "object"
      ? metadata.accountingSnapshot
      : {};
    const resolvedFulfillmentMethod = safeString(
      accountingSnapshot.fulfillmentMethod
        || subscription && subscription.deliveryMode
        || metadata.fulfillmentMethod,
      "unknown"
    ).toLowerCase();
    return fulfillmentMethod === "all" || resolvedFulfillmentMethod === fulfillmentMethod;
  });
''',
    "orphan payment filtering",
)

text = replace_once(
    text,
    '''  const byPaymentType = buildBucketRows(collectionItems, "paymentType", "paymentType");
  return {
    summary,
    dashboardCards: buildDashboardCards(summary),
    byPaymentMethod,
    byFulfillmentMethod,
    bySubscriptionStatus,
    byPaymentType,
''',
    '''  const byPaymentType = buildBucketRows(collectionItems, "paymentType", "paymentType");
  const bySourceChannel = buildBucketRows(collectionItems, "sourceChannel", "sourceChannel");
  const byPaymentProvider = buildBucketRows(collectionItems, "paymentProvider", "paymentProvider");
  return {
    summary,
    dashboardCards: buildDashboardCards(summary),
    byPaymentMethod,
    byFulfillmentMethod,
    bySubscriptionStatus,
    byPaymentType,
    bySourceChannel,
    byPaymentProvider,
''',
    "source and provider sections",
)

text = replace_once(
    text,
    '''      titleAr: "إجمالي التحصيل",
''',
    '''      titleAr: "إجمالي تحصيل الاشتراكات",
''',
    "gross card title",
)

text = replace_once(
    text,
    '''      key: "cards",
      titleAr: "بوابة دفع إلكتروني",
''',
    '''      key: "cards",
      titleAr: "تحصيل البطاقات (يشمل ميسر)",
''',
    "card payments title",
)

text = replace_once(
    text,
    '''      key: "moyasar",
      titleAr: "ميسر",
      valueHalala: summary.moyasarTotalHalala,
      valueSar: summary.moyasarTotalSar,
      valueFormattedAr: summary.moyasarTotalFormattedAr,
      subtitleAr: `${summary.moyasarCount} عملية`,
''',
    '''      key: "moyasar",
      titleAr: "منها عبر ميسر",
      valueHalala: summary.moyasarTotalHalala,
      valueSar: summary.moyasarTotalSar,
      valueFormattedAr: summary.moyasarTotalFormattedAr,
      subtitleAr: `${summary.moyasarCount} عملية ضمن تحصيل البطاقات — لا تُضاف مرة أخرى للإجمالي`,
''',
    "moyasar card clarification",
)

text = replace_once(
    text,
    '''    paymentMethodTreatment: "طريقة الدفع تعتمد على حقل الدفعة أولًا، ثم بياناتها الوصفية، ثم سجل الحركة القديم لاسترجاع البيانات التاريخية.",
''',
    '''    paymentMethodTreatment: "طريقة الدفع وقناة المصدر ومزود الدفع محاور مستقلة؛ ميسر يظهر كمزود داخل تحصيل البطاقات ولا يُجمع مرتين.",
''',
    "accounting policy clarification",
)

path.write_text(text, encoding="utf-8")

# Keep the focused contract test aligned with the new source/provider axes and orphan-payment behavior.
test_path = Path("tests/dashboardSubscriptionPaymentDailyReport.test.js")
test_text = test_path.read_text(encoding="utf-8")

test_text = replace_once(
    test_text,
    '''  await Payment.create({
    provider: "cash",
    type: "subscription_activation",
    status: "paid",
    amount: 20000,
    currency: "SAR",
    userId: visaUser._id,
    subscriptionId: visaSubscription._id,
    source: Payment.DASHBOARD_SUBSCRIPTION_VISA_SOURCE,
    applied: true,
    paidAt: new Date("2026-07-24T11:00:00.000Z"),
  });
''',
    '''  await Payment.create({
    provider: "cash",
    type: "subscription_activation",
    status: "paid",
    amount: 20000,
    currency: "SAR",
    userId: visaUser._id,
    subscriptionId: visaSubscription._id,
    source: Payment.DASHBOARD_SUBSCRIPTION_VISA_SOURCE,
    applied: true,
    paidAt: new Date("2026-07-24T11:00:00.000Z"),
  });
  await Payment.create({
    provider: "moyasar",
    type: "subscription_activation",
    status: "paid",
    amount: 15000,
    currency: "SAR",
    userId: cashUser._id,
    subscriptionId: new mongoose.Types.ObjectId(),
    source: "mobile_app_subscription",
    providerPaymentId: `${TEST_PREFIX}-orphan-payment`,
    applied: true,
    paidAt: new Date("2026-07-25T10:00:00.000Z"),
    metadata: {
      recordingMode: "moyasar_gateway",
      accountingSnapshot: {
        customerName: "Cash Customer",
        customerPhone: TEST_PHONES[0],
        planNameAr: TEST_PREFIX,
        fulfillmentMethod: "pickup",
        subscriptionStatus: "active",
      },
    },
  });
''',
    "orphan payment fixture",
)

test_text = replace_once(
    test_text,
    '''    assert(res.body.data.items.every((row) => row.gatewayUsed === false));

    res = await auth(
''',
    '''    assert(res.body.data.items.every((row) => row.gatewayUsed === false));
    assert(res.body.data.bySourceChannel.some((row) => row.sourceChannel === "dashboard"));
    assert(res.body.data.byPaymentProvider.some((row) => row.paymentProvider === "none"));
    assert(res.body.data.byPaymentProvider.some((row) => row.paymentProvider === "manual_gateway"));

    res = await auth(
      request(app).get("/api/dashboard/accounting/subscription-payments/daily?date=2026-07-25"),
      adminToken
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.summary.totalPaymentsCount, 1);
    assert.strictEqual(res.body.data.summary.moyasarCount, 1);
    assert.strictEqual(res.body.data.summary.moyasarTotalHalala, 15000);
    assert.strictEqual(res.body.data.items[0].paymentProvider, "moyasar");
    assert.strictEqual(res.body.data.items[0].sourceChannel, "app");
    assert.strictEqual(res.body.data.items[0].subscriptionRecordPresent, false);
    assert.strictEqual(res.body.data.items[0].needsReview, true);
    assert(res.body.data.items[0].reviewReasonsAr.includes("سجل الاشتراك المرتبط بالدفعة غير موجود"));

    res = await auth(
''',
    "orphan payment assertions",
)

test_path.write_text(test_text, encoding="utf-8")
