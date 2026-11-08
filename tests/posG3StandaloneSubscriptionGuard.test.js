"use strict";
process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET ||= "isolated-pos-g3-dashboard-jwt";
process.env.JWT_SECRET ||= "isolated-pos-g3-jwt";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");
const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const Payment = require("../src/models/Payment");
const ActivityLog = require("../src/models/ActivityLog");
const { expectedTotals } = require("../src/services/pos/expectedTotals");
const { businessDateAt } = require("../src/services/pos/businessDate");
const { hasPosCapability } = require("../src/services/pos/financialRuntime");
const { dashboardRoleHasPermission } = require("../src/constants/dashboardRoles");

test("D-091 G3 standalone cashier: cash and Visa work, mismatched/backdated payments never create entitlements", async () => {
  const uri = process.env.MONGO_URI_TEST;
  if (!uri || !/^mongodb:\/\/127\.0\.0\.1:27017\/basicdiet_pos_g3_ci_test\?/.test(uri)) {
    throw new Error("Standalone test requires disposable local basicdiet_pos_g3_ci_test");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    assert.equal(mongoose.connection.name, "basicdiet_pos_g3_ci_test");
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.equal(hello.setName, undefined, "must verify standalone/no rollback topology");
    await mongoose.connection.dropDatabase();
    await Setting.create({ key: "pickup_locations", value: [
      { id: "branch_1", name: { ar: "فرع تجريبي", en: "Test branch" }, isActive: true },
    ] });
    const customer = await User.create({ phone: "+966000000101", name: "G3 synthetic", role: "client", isActive: true });
    const plan = await Plan.create({
      name: { ar: "باقة تجريبية", en: "Test plan" }, daysCount: 7,
      currency: "SAR", isActive: true,
      gramsOptions: [{ grams: 150, isActive: true,
        mealsOptions: [{ mealsPerDay: 2, priceHalala: 75000, isActive: true }] }],
    });
    const actor = await dashboardAuth("cashier", "pos-g3-standalone");
    const token = jwt.sign({
      userId: String(actor.user._id), role: "cashier", tokenType: "dashboard_access",
    }, DASHBOARD_JWT_SECRET, { expiresIn: "1h" });
    const app = createApp();
    const authorization = { Authorization: "Bearer " + token, "Accept-Language": "en" };
    const payload = {
      userId: customer._id, planId: plan._id,
      startDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      grams: 150, mealsPerDay: 2, deliveryMode: "pickup", branchId: "branch_1",
    };
    const quoted = await request(app).post("/api/dashboard/subscriptions/quote").set(authorization).send(payload);
    assert.equal(quoted.status, 200, JSON.stringify(quoted.body).slice(0, 600));
    assert.deepEqual(quoted.body.data.allowedPaymentMethods, ["cash", "visa"]);
    const total = quoted.body.data.totalHalala;
    assert.ok(Number.isSafeInteger(total) && total > 0);

    for (const amount of [total + 5000, total - 10000]) {
      const response = await request(app).post("/api/dashboard/subscriptions")
        .set(authorization).send({ ...payload,
          payment: { method: "cash", status: "paid", collectedAmountHalala: amount } });
      assert.equal(response.status, 400, JSON.stringify(response.body).slice(0, 600));
      assert.equal(response.body.error.code, "PAYMENT_AMOUNT_MISMATCH");
      assert.equal(await Subscription.countDocuments({ userId: customer._id }), 0,
        "rejected payment must not leave any entitlement on standalone");
      assert.equal(await Payment.countDocuments({ userId: customer._id }), 0);
    }
    const closeDate = businessDateAt(new Date());
    const closingBeforeRejectedBackdate = await expectedTotals(closeDate);
    const backdated = await request(app).post("/api/dashboard/subscriptions")
      .set(authorization).send({ ...payload,
        payment: { method: "cash", status: "paid", collectedAmountHalala: total,
          paidAt: new Date(Date.now() - 86400000).toISOString() } });
    assert.equal(backdated.status, 400, JSON.stringify(backdated.body));
    assert.equal(backdated.body.error.code, "PAID_AT_NOT_ALLOWED");
    assert.equal(await Subscription.countDocuments({ userId: customer._id }), 0);
    assert.equal(await Payment.countDocuments({ userId: customer._id }), 0);
    const closingAfterRejectedBackdate = await expectedTotals(closeDate);
    assert.deepEqual(closingAfterRejectedBackdate.expected, closingBeforeRejectedBackdate.expected,
      "rejected past paidAt must not change business closing expected totals");
    const paid = await request(app).post("/api/dashboard/subscriptions")
      .set(authorization).send({ ...payload,
        payment: { method: "cash", status: "paid", collectedAmountHalala: total } });
    assert.equal(paid.status, 201, JSON.stringify(paid.body).slice(0, 900));
    const subscriptions = await Subscription.find({ userId: customer._id }).lean();
    const payments = await Payment.find({ userId: customer._id, status: "paid" }).lean();
    assert.equal(subscriptions.length, 1);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].amount, total);
    assert.equal(String(payments[0].collectedBy), String(actor.user._id));
    assert.ok(Math.abs(payments[0].paidAt.getTime() - Date.now()) < 60000);
    const secondCustomer = await User.create({
      phone: "+966000000102", name: "G3 synthetic Visa", role: "client", isActive: true,
    });
    const visa = await request(app).post("/api/dashboard/subscriptions")
      .set(authorization).send({ ...payload, userId: secondCustomer._id,
        payment: { method: "mada", status: "paid", collectedAmountHalala: total } });
    assert.equal(visa.status, 201, JSON.stringify(visa.body).slice(0, 900));
    const visaPayment = await Payment.findOne({ userId: secondCustomer._id, status: "paid" }).lean();
    assert.ok(visaPayment);
    assert.equal(visaPayment.source, Payment.DASHBOARD_SUBSCRIPTION_VISA_SOURCE);
    assert.equal(visaPayment.method, "visa");
    assert.equal(visaPayment.amount, total);
    assert.equal(await Payment.countDocuments({ userId: secondCustomer._id }), 1);
    assert.equal(await Subscription.countDocuments({ userId: secondCustomer._id }), 1);
    // Role parity: the actual authenticated customer-create route and audit,
    // not a temporary Staging-only cashier exception.
    for (const [i, role] of ["cashier", "restaurant", "admin", "superadmin", "kitchen", "courier"].entries()) {
      const roleActor = await dashboardAuth(role, "pos-g-d091");
      const number = "+966500000" + String(i + 10).padStart(3, "0");
      const response = await request(app).post("/api/admin/users")
        .set(roleActor.headers).send({
          phone: number, fullName: "G3 synthetic " + role,
          password: "StagingD091Pass!1",
        });
      if (["kitchen", "courier"].includes(role)) {
        assert.equal(response.status, 403, role + " may not create customers");
        assert.equal(await User.countDocuments({ phone: number }), 0);
      } else {
        assert.equal(response.status, 201, role + ": " + JSON.stringify(response.body).slice(0, 550));
        const created = await User.findOne({ phone: number }).lean();
        assert.equal(String(created.createdByAdminId), String(roleActor.user._id));
        const audit = await ActivityLog.findOne({
          entityType: "app_user", entityId: created._id,
          action: "app_customer_created_by_dashboard",
        }).lean();
        assert.ok(audit, role + " creates a recorded audit event");
        assert.equal(String(audit.byUserId), String(roleActor.user._id));
        assert.equal(audit.byRole, role);
      }
    }
    for (const role of ["cashier", "restaurant"]) {
      assert.equal(dashboardRoleHasPermission(role, ["restaurant"]), true);
      assert.equal(hasPosCapability(role, "pos.refund"), true);
    }
    for (const role of ["kitchen", "courier"]) {
      assert.equal(dashboardRoleHasPermission(role, ["restaurant"]), false);
      assert.equal(hasPosCapability(role, "pos.refund"), false);
    }
    assert.equal(hasPosCapability("superadmin", "pos.refund"), true);
  } finally {
    if (mongoose.connection.readyState) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  }
});
