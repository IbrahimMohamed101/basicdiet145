const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");
const {
  synchronizePaymentForRedirect,
  resolvePaymentForRedirect,
} = require("../services/paymentFlowService");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function appendResultParams(targetUrl, payload = {}) {
  const url = new URL(targetUrl);
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function renderPaymentPage({ title, heading, body, tone = "success" }) {
  const border = tone === "danger" ? "#dc2626" : tone === "warning" ? "#d97706" : "#15803d";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }
      .card { max-width: 640px; margin: 48px auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08); border-top: 6px solid ${border}; }
      h1 { margin-top: 0; font-size: 28px; }
      p { line-height: 1.6; margin-bottom: 12px; }
      code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${escapeHtml(heading)}</h1>
      <p>${body}</p>
    </main>
  </body>
</html>`;
}

async function verifyPayment(req, res) {
  try {
    const result = await synchronizePaymentForRedirect(req.query, { source: "api_verify" });
    return res.status(200).json({ status: true, data: result });
  } catch (err) {
    logger.error("Payment verify endpoint failed", {
      error: err.message,
      code: err.code || null,
      query: {
        payment_type: req.query && req.query.payment_type ? String(req.query.payment_type) : null,
        draft_id: req.query && req.query.draft_id ? String(req.query.draft_id) : null,
        subscription_id: req.query && req.query.subscription_id ? String(req.query.subscription_id) : null,
        date: req.query && req.query.date ? String(req.query.date) : null,
      },
    });
    return errorResponse(res, err.status || 500, err.code || "INTERNAL", err.message || "Payment verification failed");
  }
}

async function handlePaymentSuccess(req, res) {
  try {
    const result = await synchronizePaymentForRedirect(req.query, { source: "success_redirect" });
    const redirectUrl = result.successRedirectUrl
      ? appendResultParams(result.successRedirectUrl, {
        payment_status: result.paymentStatus,
        payment_id: result.paymentId,
        payment_type: result.paymentType,
        applied: result.applied,
      })
      : "";

    if (redirectUrl) {
      return res.redirect(302, redirectUrl);
    }

    if (result.paymentStatus === "paid" && result.applied) {
      return res.status(200).type("html").send(
        renderPaymentPage({
          title: "Payment successful",
          heading: "Payment confirmed",
          body: "Your payment was verified successfully and the related subscription change has been applied.",
          tone: "success",
        })
      );
    }

    return res.status(200).type("html").send(
      renderPaymentPage({
        title: "Payment pending",
        heading: "Payment received",
        body: `Payment status is <code>${escapeHtml(result.paymentStatus || "pending")}</code>. We are still waiting for final confirmation from the provider.`,
        tone: "warning",
      })
    );
  } catch (err) {
    if (err.code === "INVALID_REDIRECT_CONTEXT") {
      return res.status(200).type("html").send(
        renderPaymentPage({
          title: "Payment completed",
          heading: "Payment received",
          body: "The payment provider returned successfully. If your app did not refresh automatically, open the app and check the latest subscription/payment status.",
          tone: "success",
        })
      );
    }
    logger.error("Payment success redirect failed", {
      error: err.message,
      code: err.code || null,
    });
    return res.status(err.status || 500).type("html").send(
      renderPaymentPage({
        title: "Payment verification failed",
        heading: "Unable to confirm payment",
        body: escapeHtml(err.message || "We could not verify this payment."),
        tone: "danger",
      })
    );
  }
}

async function handlePaymentCancel(req, res) {
  const payment = await resolvePaymentForRedirect(req.query).catch(() => null);
  const redirectContext = payment && payment.metadata && payment.metadata.redirectContext
    ? payment.metadata.redirectContext
    : {};
  const redirectUrl = redirectContext.cancelRedirectUrl
    ? appendResultParams(redirectContext.cancelRedirectUrl, {
      payment_status: "canceled",
      payment_id: payment ? String(payment._id) : "",
      payment_type: payment ? payment.type : String(req.query.payment_type || ""),
    })
    : "";

  if (redirectUrl) {
    return res.redirect(302, redirectUrl);
  }

  return res.status(200).type("html").send(
    renderPaymentPage({
      title: "Payment canceled",
      heading: "Payment was canceled",
      body: "No changes were activated. You can safely go back and try the payment again.",
      tone: "warning",
    })
  );
}

module.exports = {
  verifyPayment,
  handlePaymentSuccess,
  handlePaymentCancel,
};
