const assert = require("node:assert/strict");

const {
  PAYMENT_CHANNELS,
  resolveDashboardPaymentChannel,
  normalizeDashboardPaymentResponse,
} = require("../src/utils/paymentChannel");

assert.equal(
  resolveDashboardPaymentChannel({
    provider: "moyasar",
    status: "initiated",
    metadata: {},
  }),
  PAYMENT_CHANNELS.ELECTRONIC_GATEWAY,
  "Moyasar app payments must be electronic gateway payments"
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
    provider: "cash",
    method: "cash",
    source: "dashboard_subscription_cash",
  }),
  PAYMENT_CHANNELS.CASH,
  "Explicit cash payments must stay cash"
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

assert.equal(normalizedList.data[0].paymentMethod, PAYMENT_CHANNELS.ELECTRONIC_GATEWAY);
assert.equal(normalizedList.data[0].method, PAYMENT_CHANNELS.ELECTRONIC_GATEWAY);
assert.equal(normalizedList.data[0].paymentChannel, PAYMENT_CHANNELS.ELECTRONIC_GATEWAY);
assert.deepEqual(normalizedList.data[0].paymentMethodLabel, {
  ar: "بوابة دفع إلكتروني",
  en: "Electronic payment gateway",
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
