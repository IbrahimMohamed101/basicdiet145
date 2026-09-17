"use strict";

const {
  synchronizePaidPremiumState,
} = require("./subscriptionPaidPremiumStateService");

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isAlreadySettledForPayment({ day, payment } = {}) {
  if (!day || !payment || clean(payment.status) !== "paid") return false;
  const premiumExtraPayment = day.premiumExtraPayment || {};
  if (clean(premiumExtraPayment.status) !== "paid") return false;
  if (
    premiumExtraPayment.paymentId
    && payment._id
    && clean(premiumExtraPayment.paymentId) !== clean(payment._id)
  ) {
    return false;
  }
  const slots = Array.isArray(day.mealSlots) ? day.mealSlots : [];
  return !slots.some((slot) => (
    slot
      && slot.isPremium
      && clean(slot.premiumSource) === "pending_payment"
  ));
}

function createIdempotentPaidPremiumSettlementWrapper(originalSettlement) {
  if (typeof originalSettlement !== "function") throw new TypeError("originalSettlement is required");

  async function idempotentPaidPremiumSettlement(args = {}) {
    if (isAlreadySettledForPayment(args)) {
      const synchronization = await synchronizePaidPremiumState({
        subscriptionId: args.subscription && (args.subscription._id || args.subscription),
        dayId: args.day && (args.day._id || args.day),
        payment: args.payment,
        session: args.session || null,
      });
      return {
        applied: true,
        alreadySettled: true,
        premiumStateSynchronization: synchronization,
      };
    }
    return originalSettlement(args);
  }

  Object.defineProperty(idempotentPaidPremiumSettlement, "__paidPremiumSettlementIdempotent", { value: true });
  Object.defineProperty(idempotentPaidPremiumSettlement, "__paidPremiumStateSynchronized", { value: true });
  Object.defineProperty(idempotentPaidPremiumSettlement, "__original", { value: originalSettlement });
  return idempotentPaidPremiumSettlement;
}

module.exports = {
  createIdempotentPaidPremiumSettlementWrapper,
  isAlreadySettledForPayment,
};
