const adminController = require("../../controllers/adminController");
const {
  normalizeDashboardPaymentResponse,
} = require("../../utils/paymentChannel");

const INSTALLED_MARKER = Symbol.for("basicdiet.dashboardPaymentChannelContractInstalled");

function wrapPaymentControllerMethod(methodName) {
  const original = adminController[methodName];
  if (typeof original !== "function" || original[INSTALLED_MARKER]) {
    return;
  }

  const wrapped = async function dashboardPaymentChannelContract(...args) {
    const res = args[1];
    if (!res || typeof res.json !== "function") {
      return original.apply(this, args);
    }

    const previousJson = res.json;
    res.json = function normalizedPaymentJson(payload) {
      return previousJson.call(this, normalizeDashboardPaymentResponse(payload));
    };

    try {
      return await original.apply(this, args);
    } finally {
      res.json = previousJson;
    }
  };

  Object.defineProperty(wrapped, INSTALLED_MARKER, {
    value: true,
    enumerable: false,
  });

  adminController[methodName] = wrapped;
}

wrapPaymentControllerMethod("listPaymentsAdmin");
wrapPaymentControllerMethod("getPaymentAdmin");

module.exports = adminController;
