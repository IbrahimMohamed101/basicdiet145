"use strict";

function isActiveSubscriptionForOperations(subscription) {
  return Boolean(subscription && String(subscription.status || "").trim() === "active");
}

module.exports = {
  isActiveSubscriptionForOperations,
};
