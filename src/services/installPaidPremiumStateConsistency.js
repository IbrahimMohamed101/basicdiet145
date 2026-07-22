"use strict";

const INSTALL_KEY = Symbol.for("basicdiet.paidPremiumStateConsistency.installed");

function installPaidPremiumStateConsistency() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const premiumPaymentService = require("./subscription/premiumExtraDayPaymentService");
  const selectionService = require("./subscription/subscriptionSelectionService");
  const {
    createPaidPremiumBulkSelectionWrapper,
    createPaidPremiumSelectionOperationWrapper,
    createPaidPremiumSettlementWrapper,
  } = require("./subscription/subscriptionPaidPremiumStateService");

  if (
    !premiumPaymentService.settlePaidPremiumExtraDayPayment
    || premiumPaymentService.settlePaidPremiumExtraDayPayment.__paidPremiumStateSynchronized !== true
  ) {
    premiumPaymentService.settlePaidPremiumExtraDayPayment = createPaidPremiumSettlementWrapper(
      premiumPaymentService.settlePaidPremiumExtraDayPayment
    );
  }

  for (const functionName of ["performDaySelectionUpdate", "performDaySelectionValidation"]) {
    if (
      selectionService[functionName]
      && selectionService[functionName].__preservesPaidPremiumState !== true
    ) {
      selectionService[functionName] = createPaidPremiumSelectionOperationWrapper(
        selectionService[functionName]
      );
    }
  }

  if (
    selectionService.performBulkDaySelectionPlanningBalanceValidation
    && selectionService.performBulkDaySelectionPlanningBalanceValidation.__preservesPaidPremiumState !== true
  ) {
    selectionService.performBulkDaySelectionPlanningBalanceValidation = createPaidPremiumBulkSelectionWrapper(
      selectionService.performBulkDaySelectionPlanningBalanceValidation
    );
  }

  const state = {
    installed: true,
    settlementSynchronized: Boolean(
      premiumPaymentService.settlePaidPremiumExtraDayPayment
        && premiumPaymentService.settlePaidPremiumExtraDayPayment.__paidPremiumStateSynchronized === true
    ),
    updatePreservesPaidState: Boolean(
      selectionService.performDaySelectionUpdate
        && selectionService.performDaySelectionUpdate.__preservesPaidPremiumState === true
    ),
    validationPreservesPaidState: Boolean(
      selectionService.performDaySelectionValidation
        && selectionService.performDaySelectionValidation.__preservesPaidPremiumState === true
    ),
    bulkPreservesPaidState: Boolean(
      selectionService.performBulkDaySelectionPlanningBalanceValidation
        && selectionService.performBulkDaySelectionPlanningBalanceValidation.__preservesPaidPremiumState === true
    ),
  };
  globalThis[INSTALL_KEY] = state;
  return state;
}

installPaidPremiumStateConsistency();

module.exports = {
  INSTALL_KEY,
  installPaidPremiumStateConsistency,
};
