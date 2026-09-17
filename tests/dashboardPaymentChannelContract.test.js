const assert = require("node:assert/strict");

const {
  PAYMENT_CHANNELS,
  buildMobileAppSubscriptionPaymentRecord,
  resolveDashboardPaymentChannel,
  normalizeDashboardPaymentResponse,
} = require("../src/utils/paymentChannel");

const mobileSubscriptionPayment = buildMobileAppSubscriptionPaymentRecord({
  type: "subscription_activation",
  amount: 10000,
  metadata: { draftId: "draft-1" },
});
assert.equal(mobileSubscriptionPayment.provider, "moyasar");
assert.equal(mobileSubscriptionPayment.method, "moyasar");
assert.equal(mobileSubscriptionPayment.source, "mobile_app_subscription");
assert.equal(mobileSubscriptionPayment.metadata.paymentMethod, "moyasar");
assert.equal(mobileSubscriptionPayment.metadata.paymentChannel, "moyasar");
assert.equal(mobileSubscriptionPayment.metadata.paymentOrigin, "mobile_app");
assert.equal(mobileSubscriptionPayment.metadata.recordingMode, "moyasar_gateway");
assert.equal(mobileSubscriptionPayment.metadata.gatewayUsed, true);
assert.equal(mobileSubscriptionPayment.metadata.draftId, "draft-1");

assert.equal(
  resolveDashboardPaymentChannel({
    provider: "moyasar",
    status: "initiated",
    metadata: {},
  }),
  PAYMENT_CHANNELS.MOYASAR,
  "Moyasar app payments must stay identifiable as Moyasar"
);

assert.equal(
  resolveDashboardPaymentChannel({
    provider: "manual",
    method: "visa",
    source: "dashboard_subscription_visa",
    metadata: { paymentMethod: "visa" },
  }),
  PAYMENT_CHANNELS.ELECTRONIC_GATEWAY,
  "Dashboard Visa payments must be electronic gateway payments"
);

assert.equal(
  resolveDashboardPaymentChannel({
    provider: "moyasar",
    method: "moyasar",
    source: "dashboard_subscription_visa",
  }),
  PAYMENT_CHANNELS.ELECTRONIC_GATEWAY,
  "Explicit dashboard Visa origin must win over a stale Moyasar provider value"
);

assert.equal(
  resolveDashboardPaymentChannel({
    provider: "moyasar",
    method: "moyasar",
    source: "dashboard_subscription_cash",
  }),
  PAYMENT_CHANNELS.CASH,
  "Explicit dashboard cash origin must win over stale provider values"
);

assert.equal(
  resolveDashboardPaymentChannel({
    provider: "future_gateway",
    method: "new_wallet",
  }),
  PAYMENT_CHANNELS.ELECTRONIC_GATEWAY,
  "Unknown non-cash gateways must never silently fall back to cash"
);

const normalizedList = normalizeDashboardPaymentResponse({
  status: true,
  data: [
    { _id: "gateway", provider: "moyasar", paymentMethod: "moyasar" },
    { _id: "cash", provider: "cash", paymentMethod: "cash" },
  ],
});

assert.equal(normalizedList.data[0].paymentMethod, PAYMENT_CHANNELS.MOYASAR);
assert.equal(normalizedList.data[0].method, PAYMENT_CHANNELS.MOYASAR);
assert.equal(normalizedList.data[0].paymentChannel, PAYMENT_CHANNELS.MOYASAR);
assert.deepEqual(normalizedList.data[0].paymentMethodLabel, {
  ar: "ميسر",
  en: "Moyasar",
});
assert.equal(normalizedList.data[0].provider, "moyasar", "Provider traceability must be preserved");

assert.equal(normalizedList.data[1].paymentMethod, PAYMENT_CHANNELS.CASH);
assert.equal(normalizedList.data[1].method, PAYMENT_CHANNELS.CASH);
assert.equal(normalizedList.data[1].paymentChannel, PAYMENT_CHANNELS.CASH);
assert.deepEqual(normalizedList.data[1].paymentMethodLabel, { ar: "كاش", en: "Cash" });

const normalizedDetail = normalizeDashboardPaymentResponse({
  status: true,
  data: {
    _id: "manual-visa",
    provider: "manual",
    metadata: { paymentMethod: "visa" },
  },
});
assert.equal(normalizedDetail.data.paymentMethod, PAYMENT_CHANNELS.ELECTRONIC_GATEWAY);

console.log("dashboardPaymentChannelContract.test.js passed");
