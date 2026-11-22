"use strict";

const mongoose = require("mongoose");

const ALERT_STATUSES = Object.freeze(["open", "acknowledged", "resolved"]);
const ALERT_SEVERITIES = Object.freeze(["critical", "high", "medium", "low"]);

/**
 * One row per meal-ledger problem found by the daily reconciliation scan.
 *
 * - "open"          shown to dashboard staff until someone verifies it or the
 *                   scan stops finding the problem.
 * - "acknowledged"  a staff member checked it and left a note; it stops being
 *                   counted as pending but stays on record and keeps being
 *                   refreshed while the problem exists.
 * - "resolved"      the scan no longer finds it (fixed) or the subscription is
 *                   no longer current. It is reopened if the problem comes back.
 *
 * The alert never changes a customer balance; it is only a to-do for staff.
 */
const MealLedgerAlertSchema = new mongoose.Schema(
  {
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    code: { type: String, required: true, trim: true },
    // code plus the day it is about, e.g. "STALE_RESERVATION:2026-11-17".
    dedupeKey: { type: String, required: true, trim: true },
    date: { type: String, default: null },
    severity: { type: String, enum: ALERT_SEVERITIES, required: true },
    message: { type: String, default: "" },
    action: { type: String, default: "" },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    status: { type: String, enum: ALERT_STATUSES, required: true, default: "open" },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    reopenCount: { type: Number, default: 0, min: 0 },
    resolvedAt: { type: Date, default: null },
    resolvedReason: { type: String, default: "" },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: {
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
      role: { type: String, default: "" },
    },
    acknowledgedNote: { type: String, default: "" },
  },
  { timestamps: true }
);

MealLedgerAlertSchema.index({ subscriptionId: 1, dedupeKey: 1 }, { unique: true, name: "meal_ledger_alert_identity" });
MealLedgerAlertSchema.index({ status: 1, severity: 1, lastSeenAt: -1 }, { name: "meal_ledger_alert_board" });

module.exports = mongoose.model("MealLedgerAlert", MealLedgerAlertSchema);
module.exports.ALERT_STATUSES = ALERT_STATUSES;
module.exports.ALERT_SEVERITIES = ALERT_SEVERITIES;
