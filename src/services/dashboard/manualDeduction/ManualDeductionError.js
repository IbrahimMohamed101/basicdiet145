"use strict";

class ManualDeductionError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message || code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function assertCashierOrAdminRole(role) {
  if (!["admin", "superadmin", "cashier"].includes(String(role || ""))) {
    throw new ManualDeductionError("FORBIDDEN", "Dashboard admin or cashier permission is required", 403);
  }
}

module.exports = {
  ManualDeductionError,
  assertCashierOrAdminRole,
};
