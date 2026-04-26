const { buildPaymentDescription } = require("./subscription/subscriptionWriteLocalization");
const { resolveProviderRedirectUrl } = require("./security");
function resolveSubscriptionCheckoutPaymentType({ renewedFromSubscriptionId } = {}) {
  return renewedFromSubscriptionId ? "subscription_renewal" : "subscription_activation";
}

function getInvoiceResponseId(invoice) {
  if (!invoice || typeof invoice !== "object") return "";
  return String(invoice.id || invoice.invoice_id || invoice.invoiceId || "").trim();
}

function getInvoiceResponseUrl(invoice) {
  if (!invoice || typeof invoice !== "object") return "";
  return String(invoice.url || invoice.payment_url || invoice.paymentUrl || "").trim();
}

module.exports = {
  buildPaymentDescription,
  resolveProviderRedirectUrl,
  resolveSubscriptionCheckoutPaymentType,
  getInvoiceResponseId,
  getInvoiceResponseUrl,
};
