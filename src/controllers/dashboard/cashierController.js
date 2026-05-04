"use strict";

/**
 * Cashier Controller
 *
 * Exposes two endpoints for the kitchen/cashier dashboard:
 *
 *   GET  /api/dashboard/kitchen/customer-lookup?phone=05xxxxxxxx
 *     Search a customer by phone number and return their profile and active
 *     subscription balances.
 *
 *   POST /api/dashboard/kitchen/customer-consumption
 *     Record a manual meal deduction. Body: { phone, subscriptionId?, mealCount, note? }
 */

const { lookupCustomerByPhone, recordCashierConsumption } = require("../../services/dashboard/cashierConsumptionService");
const errorResponse = require("../../utils/errorResponse");

async function customerLookup(req, res) {
  const phone = String(req.query.phone || "").trim();

  try {
    const result = await lookupCustomerByPhone(phone);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || "INTERNAL_ERROR";
    const message = err.message || "Customer lookup failed";
    return errorResponse(res, status, code, message);
  }
}

async function customerConsumption(req, res) {
  const body = req.body || {};
  const phone = String(body.phone || "").trim();
  const subscriptionId = body.subscriptionId || null;
  const mealCount = body.mealCount;
  const note = body.note || null;

  const actor = {
    actorType: req.dashboardUserRole || req.userRole || "kitchen",
    actorId: req.dashboardUserId || req.userId || null,
  };

  try {
    const result = await recordCashierConsumption({
      phone,
      subscriptionId,
      mealCount,
      note,
      actor,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || "INTERNAL_ERROR";
    const message = err.message || "Consumption recording failed";
    return errorResponse(res, status, code, message);
  }
}

module.exports = { customerLookup, customerConsumption };
