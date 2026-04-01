const test = require("node:test");
const assert = require("node:assert/strict");

const Payment = require("../src/models/Payment");

test("Payment normalizes empty provider identifiers and keeps partial unique indexes", () => {
  const payment = new Payment({
    provider: "moyasar",
    type: "subscription_activation",
    amount: 1000,
    providerInvoiceId: "   ",
    providerPaymentId: null,
  });

  assert.equal(payment.providerInvoiceId, undefined);
  assert.equal(payment.providerPaymentId, undefined);

  const schemaIndexes = Payment.schema.indexes();
  const invoiceIndex = schemaIndexes.find(([key]) => key.providerInvoiceId === 1);
  const paymentIndex = schemaIndexes.find(([key]) => key.providerPaymentId === 1);

  assert.deepEqual(invoiceIndex[1].partialFilterExpression, {
    providerInvoiceId: { $type: "string" },
  });
  assert.deepEqual(paymentIndex[1].partialFilterExpression, {
    providerPaymentId: { $type: "string" },
  });
});
