/**
 * Meal Planner payment contract verification.
 *
 * This intentionally exercises the HTTP endpoints while stubbing Moyasar at the
 * HTTPS boundary. It must not silently pass if initiation or verification fails.
 */

require("dotenv").config();

process.env.MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/basicdiet_test";

const { EventEmitter } = require("events");
const https = require("https");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const sinon = require("sinon");
const supertest = require("supertest");

const { createApp } = require("../src/app");
const { ensureSafeForDestructiveOp } = require("../src/utils/dbSafety");
const Addon = require("../src/models/Addon");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const Payment = require("../src/models/Payment");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const app = createApp();

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    JWT_SECRET,
    { expiresIn: "31d" }
  );
}

function dateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function assertTrue(condition, message, context) {
  if (!condition) {
    console.error(`Assertion failed: ${message}`);
    if (context) console.error("Context:", JSON.stringify(context, null, 2));
    process.exit(1);
  }
}

function assertEqual(actual, expected, message, context) {
  if (actual !== expected) {
    console.error(`Assertion failed: ${message}. Expected ${expected}, got ${actual}`);
    if (context) console.error("Context:", JSON.stringify(context, null, 2));
    process.exit(1);
  }
}

function assertCanonicalResponse(res, label) {
  assertTrue(res.status < 500, `${label} must not return 5xx`, res.body);
  assertTrue(res.body, `${label} must return JSON body`);
  assertTrue(res.body.error?.code !== "INTERNAL", `${label} must not return INTERNAL`, res.body);
}

function assertPaymentRequirementConsistent(requirement, label) {
  assertTrue(requirement && typeof requirement === "object", `${label} missing paymentRequirement`);
  if (Number(requirement.premiumPendingPaymentCount || 0) > 0) {
    assertEqual(requirement.requiresPayment, true, `${label} premium pending must require payment`, requirement);
    assertEqual(requirement.blockingReason, "PREMIUM_PAYMENT_REQUIRED", `${label} premium blocking reason`, requirement);
  }
  if (Number(requirement.addonPendingPaymentCount || 0) > 0) {
    assertEqual(requirement.requiresPayment, true, `${label} add-on pending must require payment`, requirement);
    assertEqual(requirement.blockingReason, "ADDON_PAYMENT_REQUIRED", `${label} add-on blocking reason`, requirement);
  }
  if (requirement.requiresPayment) {
    assertTrue(/^[A-Z0-9_]+$/.test(String(requirement.blockingReason || "")), `${label} blockingReason must be uppercase canonical`, requirement);
  }
}

function installMoyasarStub() {
  let invoiceSeq = 0;
  const invoices = new Map();

  const stub = sinon.stub(https, "request").callsFake((options, callback) => {
    const req = new EventEmitter();
    let requestBody = "";

    req.write = (chunk) => {
      requestBody += String(chunk || "");
    };
    req.setTimeout = () => req;
    req.destroy = (err) => {
      process.nextTick(() => req.emit("error", err));
    };
    req.end = () => {
      process.nextTick(() => {
        const method = String(options.method || "GET").toUpperCase();
        const path = String(options.path || "");
        let payload;
        let statusCode = 200;

        if (method === "POST" && path === "/v1/invoices") {
          const body = requestBody ? JSON.parse(requestBody) : {};
          const id = `inv_contract_${++invoiceSeq}`;
          payload = {
            id,
            status: "initiated",
            amount: body.amount,
            currency: body.currency || "SAR",
            url: `https://pay.test/${id}`,
            metadata: body.metadata || {},
          };
          invoices.set(id, payload);
        } else if (method === "GET" && path.startsWith("/v1/invoices?")) {
          const params = new URLSearchParams(path.split("?")[1] || "");
          const id = params.get("id");
          const invoice = invoices.get(id);
          if (!invoice) {
            statusCode = 404;
            payload = { message: "Invoice not found" };
          } else {
            payload = {
              invoices: [
                {
                  ...invoice,
                  status: "paid",
                  payments: [
                    {
                      id: `pay_${id}`,
                      status: "paid",
                      amount: invoice.amount,
                      currency: invoice.currency,
                    },
                  ],
                },
              ],
            };
          }
        } else {
          statusCode = 500;
          payload = { message: `Unexpected Moyasar stub request ${method} ${path}` };
        }

        const res = new EventEmitter();
        res.statusCode = statusCode;
        callback(res);
        res.emit("data", JSON.stringify(payload));
        res.emit("end");
      });
    };

    return req;
  });

  return () => stub.restore();
}

async function request(method, url, body, token) {
  let req = supertest(app)[method.toLowerCase()](url);
  if (token) req = req.set("Authorization", `Bearer ${token}`);
  if (body !== undefined && body !== null) req = req.send(body);
  const res = await req;
  assertCanonicalResponse(res, `${method} ${url}`);
  return res;
}

async function seedBase() {
  await Promise.all([
    Addon.deleteMany({}),
    BuilderCarb.deleteMany({}),
    BuilderCategory.deleteMany({}),
    BuilderProtein.deleteMany({}),
    Payment.deleteMany({}),
    Plan.deleteMany({}),
    Subscription.deleteMany({}),
    SubscriptionDay.deleteMany({}),
    User.deleteMany({}),
  ]);

  const user = await User.create({ name: "Payment Contract User", phone: "+966500000901", email: "payment-contract@example.com" });
  const token = issueAppAccessToken(user._id);
  const plan = await Plan.create({
    name: { ar: "خطة", en: "Plan" },
    daysCount: 40,
    mealsPerDay: 3,
    basePriceHalala: 100000,
    isActive: true,
    isCommerciallyViable: true,
    price: 1000,
  });
  const proteinCategory = await BuilderCategory.create({ key: "protein", dimension: "protein", name: { ar: "بروتين", en: "Protein" }, isActive: true });
  const carbCategory = await BuilderCategory.create({ key: "standard_carbs", dimension: "carb", name: { ar: "كربوهيدرات", en: "Standard Carbs" }, isActive: true });
  const standardProtein = await BuilderProtein.create({
    name: { ar: "دجاج", en: "Chicken" },
    isPremium: false,
    displayCategoryKey: "chicken",
    displayCategoryId: proteinCategory._id,
    proteinFamilyKey: "chicken",
    isActive: true,
  });
  const premiumProtein = await BuilderProtein.create({
    name: { ar: "روبيان", en: "Shrimp" },
    isPremium: true,
    displayCategoryKey: "premium",
    displayCategoryId: proteinCategory._id,
    proteinFamilyKey: "seafood",
    premiumKey: "shrimp",
    extraFeeHalala: 3000,
    isActive: true,
  });
  const carb = await BuilderCarb.create({
    name: { ar: "أرز", en: "Rice" },
    displayCategoryKey: "standard_carbs",
    displayCategoryId: carbCategory._id,
    isActive: true,
  });
  const addon = await Addon.create({
    name: { ar: "عصير برتقال", en: "Orange Juice" },
    priceHalala: 1000,
    currency: "SAR",
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
  });
  const addon1300 = await Addon.create({
    name: { ar: "لبن", en: "Laban" },
    priceHalala: 1300,
    currency: "SAR",
    kind: "item",
    category: "snack",
    billingMode: "flat_once",
    isActive: true,
  });
  const addon1900 = await Addon.create({
    name: { ar: "سلطة جانبية", en: "Side Salad" },
    priceHalala: 1900,
    currency: "SAR",
    kind: "item",
    category: "small_salad",
    billingMode: "flat_once",
    isActive: true,
  });
  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: dateOffset(1),
    endDate: dateOffset(35),
    totalMeals: 120,
    remainingMeals: 120,
    selectedMealsPerDay: 3,
    deliveryMode: "delivery",
    premiumBalance: [],
    addonSubscriptions: [],
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: {
      plan: { planId: plan._id, daysCount: 40, mealsPerDay: 3 },
      pricing: { basePlanPriceHalala: 100000, totalHalala: 100000, vatPercentage: 15 },
      delivery: { mode: "delivery" },
    },
  });

  return { user, token, subscription, standardProtein, premiumProtein, carb, addon, addon1300, addon1900 };
}

function fullSelection({ standardProtein, premiumProtein, carb }) {
  return {
    mealSlots: [
      {
        slotIndex: 1,
        selectionType: "premium_meal",
        proteinId: String(premiumProtein._id),
        carbs: [{ carbId: String(carb._id), grams: 150 }],
      },
      {
        slotIndex: 2,
        selectionType: "standard_meal",
        proteinId: String(standardProtein._id),
        carbs: [{ carbId: String(carb._id), grams: 150 }],
      },
      {
        slotIndex: 3,
        selectionType: "standard_meal",
        proteinId: String(standardProtein._id),
        carbs: [{ carbId: String(carb._id), grams: 150 }],
      },
    ],
  };
}

function standardSelection({ standardProtein, carb }) {
  return {
    mealSlots: [1, 2, 3].map((slotIndex) => ({
      slotIndex,
      selectionType: "standard_meal",
      proteinId: String(standardProtein._id),
      carbs: [{ carbId: String(carb._id), grams: 150 }],
    })),
  };
}

async function runPremiumFlow(ctx) {
  const date = dateOffset(8);
  await SubscriptionDay.create({ subscriptionId: ctx.subscription._id, date, status: "open" });

  const saveRes = await request("PUT", `/api/subscriptions/${ctx.subscription._id}/days/${date}/selection`, fullSelection(ctx), ctx.token);
  assertEqual(saveRes.status, 200, "Premium save status", saveRes.body);
  assertPaymentRequirementConsistent(saveRes.body.data.paymentRequirement, "premium save");
  assertEqual(saveRes.body.data.paymentRequirement.blockingReason, "PREMIUM_PAYMENT_REQUIRED", "Premium save blocking reason", saveRes.body.data.paymentRequirement);

  const confirmBlockedRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${date}/confirm`, {}, ctx.token);
  assertEqual(confirmBlockedRes.status, 422, "Premium confirm should be blocked", confirmBlockedRes.body);
  assertEqual(confirmBlockedRes.body.error.code, "PREMIUM_PAYMENT_REQUIRED", "Premium confirm error code", confirmBlockedRes.body);

  const createRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${date}/premium-extra/payments`, {
    plannerRevisionHash: saveRes.body.data.plannerRevisionHash,
  }, ctx.token);
  assertEqual(createRes.status, 201, "Premium payment creation status", createRes.body);
  const premiumCreate = createRes.body.data;
  assertTrue(premiumCreate.paymentId || premiumCreate.payment_id, "Premium payment creation returns payment id", premiumCreate);
  assertTrue(premiumCreate.payment_url, "Premium payment creation returns payment_url", premiumCreate);
  assertTrue(premiumCreate.invoice_id || premiumCreate.providerInvoiceId, "Premium payment creation returns invoice id", premiumCreate);
  assertEqual(premiumCreate.amountHalala, 3000, "Premium amountHalala", premiumCreate);
  assertEqual(premiumCreate.totalHalala, 3000, "Premium totalHalala", premiumCreate);
  assertTrue(premiumCreate.plannerRevisionHash, "Premium creation returns plannerRevisionHash", premiumCreate);
  assertTrue(premiumCreate.premiumExtraPayment, "Premium creation returns premiumExtraPayment", premiumCreate);
  assertTrue(premiumCreate.premiumSummary, "Premium creation returns premiumSummary", premiumCreate);
  assertPaymentRequirementConsistent(premiumCreate.paymentRequirement, "premium create");

  const verifyRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${date}/premium-extra/payments/${premiumCreate.paymentId || premiumCreate.payment_id}/verify`, {}, ctx.token);
  assertEqual(verifyRes.status, 200, "Premium verify status", verifyRes.body);
  const premiumVerify = verifyRes.body.data;
  assertEqual(premiumVerify.paymentStatus, "paid", "Premium verify payment status", premiumVerify);
  assertEqual(premiumVerify.applied, true, "Premium verify applies side effects", premiumVerify);
  assertEqual(premiumVerify.paymentRequirement.requiresPayment, false, "Premium verify clears payment requirement", premiumVerify.paymentRequirement);
  assertEqual(premiumVerify.premiumSummary.pendingPaymentCount, 0, "Premium verify clears pending count", premiumVerify.premiumSummary);

  const dayRes = await request("GET", `/api/subscriptions/${ctx.subscription._id}/days/${date}`, null, ctx.token);
  assertEqual(dayRes.status, 200, "Premium reload status", dayRes.body);
  assertEqual(dayRes.body.data.paymentRequirement.requiresPayment, false, "Premium reload no payment", dayRes.body.data.paymentRequirement);
  assertTrue(dayRes.body.data.mealSlots.some((slot) => slot.premiumSource === "paid_extra" || slot.premiumSource === "paid"), "Premium slot settled after verify", dayRes.body.data.mealSlots);

  const staleDate = dateOffset(9);
  await SubscriptionDay.create({ subscriptionId: ctx.subscription._id, date: staleDate, status: "open" });
  const staleSaveRes = await request("PUT", `/api/subscriptions/${ctx.subscription._id}/days/${staleDate}/selection`, fullSelection(ctx), ctx.token);
  const staleRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${staleDate}/premium-extra/payments`, {
    plannerRevisionHash: `stale_${staleSaveRes.body.data.plannerRevisionHash}`,
  }, ctx.token);
  assertEqual(staleRes.status, 409, "Stale premium payment creation status", staleRes.body);
  assertEqual(staleRes.body.error.code, "PREMIUM_EXTRA_REVISION_MISMATCH", "Stale premium payment code", staleRes.body);

  return { create: premiumCreate, verify: premiumVerify, noPaymentRequirement: dayRes.body.data.paymentRequirement };
}

async function runAddonFlow(ctx) {
  const date = dateOffset(10);
  await SubscriptionDay.create({ subscriptionId: ctx.subscription._id, date, status: "open" });

  const saveRes = await request("PUT", `/api/subscriptions/${ctx.subscription._id}/days/${date}/selection`, {
    ...standardSelection(ctx),
    addonsOneTime: [String(ctx.addon._id)],
  }, ctx.token);
  assertEqual(saveRes.status, 200, "Add-on save status", saveRes.body);
  assertPaymentRequirementConsistent(saveRes.body.data.paymentRequirement, "add-on save");
  assertEqual(saveRes.body.data.paymentRequirement.blockingReason, "ADDON_PAYMENT_REQUIRED", "Add-on save blocking reason", saveRes.body.data.paymentRequirement);

  const createRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${date}/one-time-addons/payments`, {}, ctx.token);
  assertEqual(createRes.status, 200, "Add-on payment creation status", createRes.body);
  const addonCreate = createRes.body.data;
  assertTrue(addonCreate.payment_id, "Add-on payment creation returns payment_id", addonCreate);
  assertTrue(addonCreate.payment_url, "Add-on payment creation returns payment_url", addonCreate);
  assertTrue(addonCreate.invoice_id, "Add-on payment creation returns invoice_id", addonCreate);
  assertEqual(addonCreate.totalHalala, 1000, "Add-on totalHalala", addonCreate);

  const verifyRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${date}/one-time-addons/payments/${addonCreate.payment_id}/verify`, {}, ctx.token);
  assertEqual(verifyRes.status, 200, "Add-on verify status", verifyRes.body);
  const addonVerify = verifyRes.body.data;
  assertEqual(addonVerify.paymentStatus, "paid", "Add-on verify payment status", addonVerify);
  assertEqual(addonVerify.applied, true, "Add-on verify applies side effects", addonVerify);
  assertEqual(addonVerify.pendingCount, 0, "Add-on verify clears pending count", addonVerify);
  assertTrue(addonVerify.addonSelections.every((selection) => selection.source === "paid"), "Add-on selections are paid", addonVerify.addonSelections);

  const dayRes = await request("GET", `/api/subscriptions/${ctx.subscription._id}/days/${date}`, null, ctx.token);
  assertEqual(dayRes.status, 200, "Add-on reload status", dayRes.body);
  assertEqual(dayRes.body.data.paymentRequirement.requiresPayment, false, "Add-on reload no payment", dayRes.body.data.paymentRequirement);
  assertEqual(dayRes.body.data.paymentRequirement.addonPendingPaymentCount, 0, "Add-on reload clears pending count", dayRes.body.data.paymentRequirement);

  const noPendingRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${date}/one-time-addons/payments`, {}, ctx.token);
  assertEqual(noPendingRes.status, 409, "No-pending add-on creation status", noPendingRes.body);
  assertEqual(noPendingRes.body.error.code, "NO_PENDING_ONE_TIME_ADDONS", "No-pending add-on code", noPendingRes.body);

  return { create: addonCreate, verify: addonVerify };
}

async function runUnifiedDayPaymentFlow(ctx) {
  const premiumOnlyDate = dateOffset(11);
  await SubscriptionDay.create({ subscriptionId: ctx.subscription._id, date: premiumOnlyDate, status: "open" });
  const premiumSaveRes = await request("PUT", `/api/subscriptions/${ctx.subscription._id}/days/${premiumOnlyDate}/selection`, fullSelection(ctx), ctx.token);
  const premiumCreateRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${premiumOnlyDate}/payments`, {
    plannerRevisionHash: premiumSaveRes.body.data.plannerRevisionHash,
  }, ctx.token);
  assertEqual(premiumCreateRes.status, 201, "Unified premium-only creation status", premiumCreateRes.body);
  assertEqual(premiumCreateRes.body.data.premiumAmountHalala, 3000, "Unified premium-only premium amount", premiumCreateRes.body.data);
  assertEqual(premiumCreateRes.body.data.addonsAmountHalala, 0, "Unified premium-only add-on amount", premiumCreateRes.body.data);
  assertEqual(premiumCreateRes.body.data.totalHalala, 3000, "Unified premium-only total", premiumCreateRes.body.data);

  const premiumVerifyRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${premiumOnlyDate}/payments/${premiumCreateRes.body.data.paymentId}/verify`, {}, ctx.token);
  assertEqual(premiumVerifyRes.status, 200, "Unified premium-only verify status", premiumVerifyRes.body);
  assertEqual(premiumVerifyRes.body.data.paymentStatus, "paid", "Unified premium-only paid", premiumVerifyRes.body.data);
  assertEqual(premiumVerifyRes.body.data.paymentRequirement.requiresPayment, false, "Unified premium-only clears payment", premiumVerifyRes.body.data.paymentRequirement);

  const addonOnlyDate = dateOffset(12);
  await SubscriptionDay.create({ subscriptionId: ctx.subscription._id, date: addonOnlyDate, status: "open" });
  const addonSaveRes = await request("PUT", `/api/subscriptions/${ctx.subscription._id}/days/${addonOnlyDate}/selection`, {
    ...standardSelection(ctx),
    addonsOneTime: [String(ctx.addon1300._id), String(ctx.addon1900._id)],
  }, ctx.token);
  const addonCreateRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${addonOnlyDate}/payments`, {
    plannerRevisionHash: addonSaveRes.body.data.plannerRevisionHash,
  }, ctx.token);
  assertEqual(addonCreateRes.status, 201, "Unified add-on-only creation status", addonCreateRes.body);
  assertEqual(addonCreateRes.body.data.premiumAmountHalala, 0, "Unified add-on-only premium amount", addonCreateRes.body.data);
  assertEqual(addonCreateRes.body.data.addonsAmountHalala, 3200, "Unified add-on-only add-on amount", addonCreateRes.body.data);
  assertEqual(addonCreateRes.body.data.totalHalala, 3200, "Unified add-on-only total", addonCreateRes.body.data);

  const addonVerifyRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${addonOnlyDate}/payments/${addonCreateRes.body.data.paymentId}/verify`, {}, ctx.token);
  assertEqual(addonVerifyRes.status, 200, "Unified add-on-only verify status", addonVerifyRes.body);
  assertEqual(addonVerifyRes.body.data.paymentStatus, "paid", "Unified add-on-only paid", addonVerifyRes.body.data);
  assertEqual(addonVerifyRes.body.data.paymentRequirement.requiresPayment, false, "Unified add-on-only clears payment", addonVerifyRes.body.data.paymentRequirement);
  assertTrue(addonVerifyRes.body.data.addonSelections.every((selection) => selection.source === "paid"), "Unified add-on-only settles add-ons", addonVerifyRes.body.data.addonSelections);
  assertTrue(addonVerifyRes.body.data.addonSelections.every((selection) => String(selection.paymentId) === String(addonCreateRes.body.data.paymentId)), "Unified add-on-only stamps paymentId", addonVerifyRes.body.data.addonSelections);

  const combinedDate = dateOffset(13);
  await SubscriptionDay.create({ subscriptionId: ctx.subscription._id, date: combinedDate, status: "open" });
  const combinedSaveRes = await request("PUT", `/api/subscriptions/${ctx.subscription._id}/days/${combinedDate}/selection`, {
    ...fullSelection(ctx),
    addonsOneTime: [String(ctx.addon1300._id), String(ctx.addon1900._id)],
  }, ctx.token);
  assertEqual(combinedSaveRes.body.data.paymentRequirement.requiresPayment, true, "Unified combined save requires payment", combinedSaveRes.body.data.paymentRequirement);

  const combinedCreateRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${combinedDate}/payments`, {
    plannerRevisionHash: combinedSaveRes.body.data.plannerRevisionHash,
  }, ctx.token);
  assertEqual(combinedCreateRes.status, 201, "Unified combined creation status", combinedCreateRes.body);
  const combinedCreate = combinedCreateRes.body.data;
  assertTrue(combinedCreate.payment_id && combinedCreate.paymentId, "Unified combined returns both payment id aliases", combinedCreate);
  assertTrue(combinedCreate.invoice_id && combinedCreate.providerInvoiceId, "Unified combined returns both invoice id aliases", combinedCreate);
  assertEqual(combinedCreate.premiumAmountHalala, 3000, "Unified combined premium amount", combinedCreate);
  assertEqual(combinedCreate.addonsAmountHalala, 3200, "Unified combined add-on amount", combinedCreate);
  assertEqual(combinedCreate.totalHalala, 6200, "Unified combined single invoice total", combinedCreate);

  const combinedPayment = await Payment.findById(combinedCreate.paymentId).lean();
  assertEqual(combinedPayment.type, "day_planning_payment", "Unified combined payment type", combinedPayment);
  assertEqual(combinedPayment.amount, 6200, "Unified combined payment record amount", combinedPayment);
  assertEqual(combinedPayment.metadata.premiumAmountHalala, 3000, "Unified combined payment metadata premium amount", combinedPayment.metadata);
  assertEqual(combinedPayment.metadata.addonsAmountHalala, 3200, "Unified combined payment metadata add-on amount", combinedPayment.metadata);
  assertEqual(combinedPayment.metadata.oneTimeAddonSelections.length, 2, "Unified combined payment snapshots add-ons", combinedPayment.metadata);

  const combinedVerifyRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${combinedDate}/payments/${combinedCreate.paymentId}/verify`, {}, ctx.token);
  assertEqual(combinedVerifyRes.status, 200, "Unified combined verify status", combinedVerifyRes.body);
  const combinedVerify = combinedVerifyRes.body.data;
  assertEqual(combinedVerify.paymentStatus, "paid", "Unified combined verify payment status", combinedVerify);
  assertEqual(combinedVerify.applied, true, "Unified combined verify applies side effects", combinedVerify);
  assertEqual(combinedVerify.paymentRequirement.requiresPayment, false, "Unified combined verify clears payment requirement", combinedVerify.paymentRequirement);
  assertEqual(combinedVerify.paymentRequirement.blockingReason, "PLANNER_UNCONFIRMED", "Unified combined verify leaves planner unconfirmed", combinedVerify.paymentRequirement);
  assertEqual(combinedVerify.premiumSummary.pendingPaymentCount, 0, "Unified combined verify settles premium", combinedVerify.premiumSummary);
  assertEqual(combinedVerify.paymentRequirement.addonPendingPaymentCount, 0, "Unified combined verify settles add-ons", combinedVerify.paymentRequirement);
  assertTrue(combinedVerify.addonSelections.every((selection) => selection.source === "paid"), "Unified combined add-ons paid", combinedVerify.addonSelections);
  assertTrue(combinedVerify.addonSelections.every((selection) => String(selection.paymentId) === String(combinedCreate.paymentId)), "Unified combined add-ons stamped with unified payment id", combinedVerify.addonSelections);

  const confirmRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${combinedDate}/confirm`, {}, ctx.token);
  assertEqual(confirmRes.status, 200, "Unified combined confirm works after verify", confirmRes.body);
  assertEqual(confirmRes.body.data.paymentRequirement.requiresPayment, false, "Unified combined confirmed day no payment", confirmRes.body.data.paymentRequirement);
  assertEqual(confirmRes.body.data.commercialState, "confirmed", "Unified combined commercial state confirmed", confirmRes.body.data);

  const staleDate = dateOffset(14);
  await SubscriptionDay.create({ subscriptionId: ctx.subscription._id, date: staleDate, status: "open" });
  const staleSaveRes = await request("PUT", `/api/subscriptions/${ctx.subscription._id}/days/${staleDate}/selection`, {
    ...fullSelection(ctx),
    addonsOneTime: [String(ctx.addon._id)],
  }, ctx.token);
  const staleRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${staleDate}/payments`, {
    plannerRevisionHash: `stale_${staleSaveRes.body.data.plannerRevisionHash}`,
  }, ctx.token);
  assertEqual(staleRes.status, 409, "Unified stale plannerRevisionHash status", staleRes.body);
  assertEqual(staleRes.body.error.code, "DAY_PAYMENT_REVISION_MISMATCH", "Unified stale plannerRevisionHash code", staleRes.body);

  const mutationDate = dateOffset(15);
  await SubscriptionDay.create({ subscriptionId: ctx.subscription._id, date: mutationDate, status: "open" });
  const mutationSaveRes = await request("PUT", `/api/subscriptions/${ctx.subscription._id}/days/${mutationDate}/selection`, {
    ...standardSelection(ctx),
    addonsOneTime: [String(ctx.addon1300._id)],
  }, ctx.token);
  const mutationCreateRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${mutationDate}/payments`, {
    plannerRevisionHash: mutationSaveRes.body.data.plannerRevisionHash,
  }, ctx.token);
  assertEqual(mutationCreateRes.status, 201, "Unified mutation safety creation status", mutationCreateRes.body);
  assertEqual(mutationCreateRes.body.data.addonsAmountHalala, 1300, "Unified mutation safety original amount", mutationCreateRes.body.data);
  await SubscriptionDay.updateOne(
    { subscriptionId: ctx.subscription._id, date: mutationDate },
    {
      $push: {
        addonSelections: {
          addonId: ctx.addon1900._id,
          name: "Side Salad",
          category: "small_salad",
          source: "pending_payment",
          priceHalala: 1900,
          currency: "SAR",
          consumedAt: new Date(),
        },
      },
    }
  );
  const mutationVerifyRes = await request("POST", `/api/subscriptions/${ctx.subscription._id}/days/${mutationDate}/payments/${mutationCreateRes.body.data.paymentId}/verify`, {}, ctx.token);
  assertEqual(mutationVerifyRes.status, 409, "Unified mutation safety rejects changed add-ons", mutationVerifyRes.body);
  assertEqual(mutationVerifyRes.body.error.code, "DAY_PAYMENT_REVISION_MISMATCH", "Unified mutation safety code", mutationVerifyRes.body);
  const mutatedDay = await SubscriptionDay.findOne({ subscriptionId: ctx.subscription._id, date: mutationDate }).lean();
  assertEqual(mutatedDay.addonSelections.filter((selection) => selection.source === "pending_payment").length, 2, "Unified mutation safety leaves pending add-ons unpaid", mutatedDay.addonSelections);

  return { create: combinedCreate, verify: combinedVerify };
}

async function run() {
  if (process.env.NODE_ENV !== "test") {
    console.error("NODE_ENV must be test");
    process.exit(1);
  }
  if (!process.env.MONGODB_URI || !process.env.MONGODB_URI.includes("_test")) {
    console.error("MONGODB_URI must point at a _test database");
    process.exit(1);
  }

  const restoreMoyasar = installMoyasarStub();
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await ensureSafeForDestructiveOp(mongoose.connection.db);

    const ctx = await seedBase();
    const premium = await runPremiumFlow(ctx);
    const addon = await runAddonFlow(ctx);
    const unified = await runUnifiedDayPaymentFlow(ctx);

    console.log("Premium payment creation example:", JSON.stringify(premium.create, null, 2));
    console.log("Premium verify example:", JSON.stringify(premium.verify, null, 2));
    console.log("No-payment requirement example:", JSON.stringify(premium.noPaymentRequirement, null, 2));
    console.log("Add-on payment creation example:", JSON.stringify(addon.create, null, 2));
    console.log("Add-on verify example:", JSON.stringify(addon.verify, null, 2));
    console.log("Unified payment creation example:", JSON.stringify(unified.create, null, 2));
    console.log("Unified verify example:", JSON.stringify(unified.verify, null, 2));
    console.log("\n--- PAYMENT CONTRACT CHECKS PASSED ---");
  } catch (err) {
    console.error("Test failed:", err);
    process.exitCode = 1;
  } finally {
    restoreMoyasar();
    await mongoose.disconnect();
  }
}

run();
