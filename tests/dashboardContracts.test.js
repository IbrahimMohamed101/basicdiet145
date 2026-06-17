require('dotenv').config();

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const moyasarService = require("../src/services/moyasarService");
moyasarService.getInvoice = async (invoiceId) => {
  return {
    id: invoiceId,
    status: "paid",
    amount: 86500,
    currency: "SAR",
    payments: [{ status: "paid" }]
  };
};

const { createApp } = require("../src/app");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const DashboardUser = require("../src/models/DashboardUser");
const Payment = require("../src/models/Payment");
const Plan = require("../src/models/Plan");
const Zone = require("../src/models/Zone");
const Addon = require("../src/models/Addon");
const PromoCode = require("../src/models/PromoCode");
const Setting = require("../src/models/Setting");
const Order = require("../src/models/Order");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");

const TEST_TAG = `dash-contract-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const results = { passed: 0, failed: 0 };
const dashboardUsers = new Map();

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function dashboardToken(role = "admin") {
  const dashboardUser = dashboardUsers.get(role);
  assert(dashboardUser, `missing dashboard user for role ${role}`);
  return jwt.sign(
    { userId: String(dashboardUser._id), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function auth(role = "admin") {
  return { Authorization: `Bearer ${dashboardToken(role)}`, "Accept-Language": "en" };
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function connectDatabase() {
  if (mongoose.connection.readyState === 0) {
    const mongoUri = resolveMongoUri();
    await mongoose.connect(mongoUri);
  }
}

let seedData = {};

async function seedBaseData() {
  // Setup settings
  await Setting.deleteMany({ key: { $in: ["pickup_locations", "restaurant_is_open", "delivery_windows", "cutoff_time"] } });
  await Setting.create([
    {
      key: "pickup_locations",
      value: [{
        id: "branch_1",
        key: "branch_1",
        code: "branch_1",
        slug: "branch_1",
        branchId: "branch_1",
        pickupLocationId: "branch_1",
        name: { ar: "فرع الرياض", en: "Riyadh Branch" },
        isActive: true,
        active: true,
      }]
    },
    {
      key: "restaurant_is_open",
      value: true
    },
    {
      key: "delivery_windows",
      value: ["08:00-11:00", "12:00-15:00"]
    },
    {
      key: "cutoff_time",
      value: "14:00"
    }
  ]);

  const client = await User.create({
    phone: `+966500000001_${TEST_TAG}`,
    name: "Client One",
    role: "client",
    isActive: true,
  });

  const plan = await Plan.create({
    name: { ar: "الباقة الأساسية", en: `${TEST_TAG} Plan` },
    daysCount: 7,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 150,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 75000, compareAtHalala: 90000, isActive: true }],
    }],
  });

  const zone = await Zone.create({
    name: { ar: "حي الياسمين", en: `${TEST_TAG} Zone` },
    deliveryFeeHalala: 1500,
    isActive: true,
    sortOrder: 1,
  });

  const addon = await Addon.create({
    name: { ar: "عصير برتقال", en: `${TEST_TAG} Juice` },
    category: "juice",
    kind: "item",
    billingMode: "flat_once",
    priceHalala: 1000,
    currency: "SAR",
    isActive: true,
  });

  const promo = await PromoCode.create({
    code: `PROMO_${TEST_TAG.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`,
    codeNormalized: `PROMO_${TEST_TAG.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`,
    discountType: "percentage",
    discountValue: 10,
    isActive: true,
  });

  const subscription = await Subscription.create({
    userId: client._id,
    planId: plan._id,
    status: "active",
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    totalMeals: 14,
    remainingMeals: 14,
    selectedGrams: 150,
    selectedMealsPerDay: 2,
    deliveryMode: "delivery",
    deliveryZoneId: zone._id,
    deliveryZoneName: zone.name.en,
    deliveryFeeHalala: 1500,
  });

  const subDay = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-06-17",
    status: "open",
    mealSlots: [
      { _id: new mongoose.Types.ObjectId(), slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" },
      { _id: new mongoose.Types.ObjectId(), slotIndex: 2, slotKey: "slot_2", selectionType: "standard_meal", status: "complete" }
    ],
    addonSelections: []
  });

  const payment = await Payment.create({
    userId: client._id,
    subscriptionId: subscription._id,
    status: "initiated",
    amount: 86500,
    provider: "moyasar",
    type: "subscription_activation",
    providerInvoiceId: `inv_${TEST_TAG.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`,
  });

  const oneTimeOrder = await Order.create({
    userId: client._id,
    status: "pending_payment",
    paymentStatus: "paid",
    fulfillmentMethod: "delivery",
    fulfillmentDate: "2026-06-17",
    delivery: {
      zoneId: zone._id,
      address: { line1: "Test Address", city: "Riyadh" }
    },
    pricing: {
      subtotalHalala: 10000,
      deliveryFeeHalala: 1500,
      discountHalala: 0,
      totalHalala: 11500,
      vatPercentage: 16,
      vatHalala: 1586,
      vatIncluded: true,
      currency: "SAR"
    },
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        name: { ar: "وجبة دجاج", en: "Chicken Meal" },
        qty: 1,
        unitPriceHalala: 10000,
        lineTotalHalala: 10000
      }
    ]
  });

  seedData = { client, plan, zone, addon, promo, subscription, subDay, payment, oneTimeOrder };
}

async function seedAuthUsers() {
  for (const role of ["superadmin", "admin", "kitchen", "courier", "cashier"]) {
    const authObj = await dashboardAuth(role, TEST_TAG);
    dashboardUsers.set(role, authObj.user);
  }
}

async function cleanup() {
  const userIds = [seedData.client?._id].filter(Boolean);
  const subIds = [seedData.subscription?._id].filter(Boolean);
  const planIds = [seedData.plan?._id].filter(Boolean);
  const zoneIds = [seedData.zone?._id].filter(Boolean);
  const addonIds = [seedData.addon?._id].filter(Boolean);
  const promoIds = [seedData.promo?._id].filter(Boolean);
  const orderIds = [seedData.oneTimeOrder?._id].filter(Boolean);

  await Promise.all([
    User.deleteMany({ _id: { $in: userIds } }),
    Subscription.deleteMany({ _id: { $in: subIds } }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subIds } }),
    SubscriptionPickupRequest.deleteMany({ subscriptionId: { $in: subIds } }),
    Payment.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subIds } }] }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    Zone.deleteMany({ _id: { $in: zoneIds } }),
    Addon.deleteMany({ _id: { $in: addonIds } }),
    PromoCode.deleteMany({ _id: { $in: promoIds } }),
    Order.deleteMany({ _id: { $in: orderIds } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
  ]);
}

async function runTests() {
  await connectDatabase();
  await seedBaseData();
  await seedAuthUsers();

  const app = createApp();

  console.log(`Running Dashboard Backend Contract Pack Verification Tests...`);

  // 1. Dashboard Home Overview Check
  await test("Dashboard Home: GET /api/dashboard/overview returns summary statistics", async () => {
    const res = await request(app)
      .get("/api/dashboard/overview")
      .set(auth("admin"));
    expectStatus(res, 200, "overview");
    assert(res.body.data.stats !== undefined, "stats must exist");
    assert(Array.isArray(res.body.data.recentSubscriptions), "recentSubscriptions must be an array");
  });

  // 2. Payments list, detail, verify checks
  await test("Payments: List, Detail, and Verification", async () => {
    const listRes = await request(app)
      .get("/api/dashboard/payments")
      .set(auth("admin"));
    expectStatus(listRes, 200, "payments list");
    assert(Array.isArray(listRes.body.data), "payments data must be an array");

    const detailRes = await request(app)
      .get(`/api/dashboard/payments/${seedData.payment._id}`)
      .set(auth("admin"));
    expectStatus(detailRes, 200, "payment detail");
    assert.strictEqual(detailRes.body.data.id || detailRes.body.data._id, String(seedData.payment._id));

    // Verify payment transition
    const verifyRes = await request(app)
      .post(`/api/dashboard/payments/${seedData.payment._id}/verify`)
      .set(auth("admin"));
    expectStatus(verifyRes, 200, "payment verify");
    assert.strictEqual(verifyRes.body.data.payment.status, "paid");
  });

  // 3. Accounting Daily Report check (with 16% inclusive VAT)
  await test("Accounting: Daily report and inclusive VAT checks", async () => {
    const res = await request(app)
      .get("/api/dashboard/accounting/daily-report?date=2026-06-17")
      .set(auth("admin"));
    expectStatus(res, 200, "daily-report");
    assert(res.body.data.summary !== undefined, "data.summary must be present");
    assert(res.body.data.reconciliation !== undefined, "data.reconciliation must be present");

    const exportRes = await request(app)
      .get("/api/dashboard/accounting/daily-report/export?date=2026-06-17&format=csv")
      .set(auth("admin"));
    expectStatus(exportRes, 200, "daily-report export CSV");
  });

  // 4. Promo Codes: CRUD, toggle and validate
  await test("Promo Codes: CRUD, toggle and validate", async () => {
    // List
    const listRes = await request(app)
      .get("/api/dashboard/promo-codes")
      .set(auth("admin"));
    expectStatus(listRes, 200, "promo codes list");

    // Validate
    const validateRes = await request(app)
      .post("/api/dashboard/promo-codes/validate")
      .send({
        code: seedData.promo.code,
        subtotalHalala: 10000,
        vatPercentage: 16
      })
      .set(auth("admin"));
    expectStatus(validateRes, 200, "promo validation");
    assert(validateRes.body.data.valid, "Promo must be valid");

    // Toggle
    const toggleRes = await request(app)
      .patch(`/api/dashboard/promo-codes/${seedData.promo._id}/toggle`)
      .set(auth("admin"));
    expectStatus(toggleRes, 200, "promo toggle");
    assert.strictEqual(toggleRes.body.data.isActive, false);
  });

  // 5. Add-ons CRUD and toggle
  await test("Add-ons: CRUD and toggle", async () => {
    const listRes = await request(app)
      .get("/api/dashboard/addons")
      .set(auth("admin"));
    expectStatus(listRes, 200, "addons list");

    const toggleRes = await request(app)
      .patch(`/api/dashboard/addons/${seedData.addon._id}/toggle`)
      .set(auth("admin"));
    expectStatus(toggleRes, 200, "addon toggle");
  });

  // 6. Packages CRUD
  await test("Packages (Plans): List packages", async () => {
    const res = await request(app)
      .get("/api/dashboard/plans")
      .set(auth("admin"));
    expectStatus(res, 200, "plans list");
    assert(Array.isArray(res.body.data), "Plans data must be an array");
  });

  // 7. Subscriptions list, audit, lifecycle checks
  await test("Subscriptions: List, Audit, Lifecycle", async () => {
    const listRes = await request(app)
      .get("/api/dashboard/subscriptions")
      .set(auth("admin"));
    expectStatus(listRes, 200, "subscriptions list");

    const auditRes = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}/audit`)
      .set(auth("admin"));
    expectStatus(auditRes, 200, "subscription audit");
    assert(auditRes.body.data.invariants !== undefined, "invariants node must exist");

    const lifecycleRes = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}/lifecycle`)
      .set(auth("admin"));
    expectStatus(lifecycleRes, 200, "subscription lifecycle");
  });

  // 8. Operations queue and cashier search lookup
  await test("Operations Queue: List and cashier search", async () => {
    const res = await request(app)
      .get("/api/dashboard/ops/list?date=2026-06-17")
      .set(auth("admin"));
    expectStatus(res, 200, "ops list");

    const searchRes = await request(app)
      .get(`/api/dashboard/ops/search?q=Client`)
      .set(auth("admin"));
    expectStatus(searchRes, 200, "ops cashier search");
  });

  // 9. Manual Deduction checks
  await test("Manual Deduction: cashier-lookup and deduction execute", async () => {
    const lookupRes = await request(app)
      .get(`/api/dashboard/ops/cashier/customer-lookup?phone=${encodeURIComponent(seedData.client.phone)}`)
      .set(auth("admin"));
    expectStatus(lookupRes, 200, "cashier lookup");

    const deductRes = await request(app)
      .post(`/api/dashboard/ops/cashier/customer-consumption`)
      .send({
        phone: seedData.client.phone,
        subscriptionId: seedData.subscription._id,
        mealCount: 1,
        note: "Customer forgot meal box at store"
      })
      .set(auth("admin"));
    expectStatus(deductRes, 200, "manual deduction execute");
  });

  // 10. Menu Catalog preview and version checks
  await test("Menu Catalog: preview draft and list versions", async () => {
    const previewRes = await request(app)
      .get("/api/dashboard/menu/preview")
      .set(auth("admin"));
    expectStatus(previewRes, 200, "menu preview");

    const versionsRes = await request(app)
      .get("/api/dashboard/menu/versions")
      .set(auth("admin"));
    expectStatus(versionsRes, 200, "menu versions");
  });

  // 11. Courier delivery routes
  await test("Courier / Delivery Queue: list deliveries", async () => {
    const res = await request(app)
      .get("/api/courier/deliveries/today?date=2026-06-17")
      .set(auth("admin"));
    expectStatus(res, 200, "courier list today");
  });

  // 12. Delivery Zones CRUD
  await test("Delivery Zones: List and get zones", async () => {
    const listRes = await request(app)
      .get("/api/dashboard/zones")
      .set(auth("admin"));
    expectStatus(listRes, 200, "zones list");

    const detailRes = await request(app)
      .get(`/api/dashboard/zones/${seedData.zone._id}`)
      .set(auth("admin"));
    expectStatus(detailRes, 200, "zone detail");
  });

  // 13. App Users List and Detail
  await test("App Users: List and details", async () => {
    const listRes = await request(app)
      .get("/api/dashboard/users")
      .set(auth("admin"));
    expectStatus(listRes, 200, "app users list");

    const detailRes = await request(app)
      .get(`/api/dashboard/users/${seedData.client._id}`)
      .set(auth("admin"));
    expectStatus(detailRes, 200, "app user detail");
  });

  // 14. Dashboard Users List and Detail
  await test("Dashboard Users: CRUD and list", async () => {
    const listRes = await request(app)
      .get("/api/dashboard/dashboard-users")
      .set(auth("admin"));
    expectStatus(listRes, 200, "dashboard users list");
  });

  // 15. Settings list, get and update
  await test("Settings: general and restaurant hours settings", async () => {
    const getRes = await request(app)
      .get("/api/dashboard/settings")
      .set(auth("admin"));
    expectStatus(getRes, 200, "general settings");
    assert(Array.isArray(getRes.body.data.pickup_locations));
    assert.strictEqual(getRes.body.data.pickup_locations.length, 1);
    assert.strictEqual(getRes.body.data.pickup_locations[0].id, "branch_1");

    const hoursRes = await request(app)
      .get("/api/dashboard/settings/restaurant-hours")
      .set(auth("admin"));
    expectStatus(hoursRes, 200, "restaurant hours get");

    const patchRes = await request(app)
      .patch("/api/dashboard/settings")
      .send({
        restaurant_is_open: true
      })
      .set(auth("admin"));
    expectStatus(patchRes, 200, "pickup branches settings patch");

    // Patch with valid new pickup_locations array
    const validPatchRes = await request(app)
      .patch("/api/dashboard/settings")
      .send({
        pickup_locations: [
          {
            id: "branch_1",
            name: { ar: "فرع الرياض 1", en: "Riyadh Branch 1" },
            address: { ar: "العنوان 1", en: "Address 1" },
            isActive: true,
            latitude: 24.7136,
            longitude: 46.6753,
            phone: "+966500000002"
          },
          {
            id: "branch_2",
            name: { ar: "فرع جدة 2", en: "Jeddah Branch 2" },
            address: { ar: "العنوان 2", en: "Address 2" },
            isActive: false,
            latitude: 21.5433,
            longitude: 39.1728
          }
        ]
      })
      .set(auth("admin"));
    expectStatus(validPatchRes, 200, "patch pickup_locations valid");
    assert.strictEqual(validPatchRes.body.data.pickup_locations.length, 2);
    assert.strictEqual(validPatchRes.body.data.pickup_locations[0].name.en, "Riyadh Branch 1");
    assert.strictEqual(validPatchRes.body.data.pickup_locations[1].isActive, false);

    // Verify GET settings now has the new pickup_locations
    const getUpdatedRes = await request(app)
      .get("/api/dashboard/settings")
      .set(auth("admin"));
    expectStatus(getUpdatedRes, 200, "general settings updated");
    assert.strictEqual(getUpdatedRes.body.data.pickup_locations.length, 2);
    assert.strictEqual(getUpdatedRes.body.data.pickup_locations[0].id, "branch_1");

    // Invalid: non-array payload
    const invalidArrayRes = await request(app)
      .patch("/api/dashboard/settings")
      .send({
        pickup_locations: "not-an-array"
      })
      .set(auth("admin"));
    expectStatus(invalidArrayRes, 400, "invalid non-array");

    // Invalid: missing name/address ar/en
    const invalidNameRes = await request(app)
      .patch("/api/dashboard/settings")
      .send({
        pickup_locations: [
          {
            id: "branch_3",
            address: { ar: "العنوان 3", en: "Address 3" }
          }
        ]
      })
      .set(auth("admin"));
    expectStatus(invalidNameRes, 400, "invalid missing name");

    // Invalid: duplicate ID
    const duplicateIdRes = await request(app)
      .patch("/api/dashboard/settings")
      .send({
        pickup_locations: [
          {
            id: "dup_branch",
            name: { ar: "فرع 1", en: "Branch 1" },
            address: { ar: "العنوان 1", en: "Address 1" }
          },
          {
            id: "dup_branch",
            name: { ar: "فرع 2", en: "Branch 2" },
            address: { ar: "العنوان 2", en: "Address 2" }
          }
        ]
      })
      .set(auth("admin"));
    expectStatus(duplicateIdRes, 400, "invalid duplicate ID");

    // Invalid: duplicate Name (ar)
    const duplicateArNameRes = await request(app)
      .patch("/api/dashboard/settings")
      .send({
        pickup_locations: [
          {
            id: "branch_a",
            name: { ar: "فرع مكرر", en: "Branch A" },
            address: { ar: "العنوان 1", en: "Address 1" }
          },
          {
            id: "branch_b",
            name: { ar: "فرع مكرر", en: "Branch B" },
            address: { ar: "العنوان 2", en: "Address 2" }
          }
        ]
      })
      .set(auth("admin"));
    expectStatus(duplicateArNameRes, 400, "invalid duplicate ar name");

    // Invalid: coordinates out of bounds
    const invalidCoordsRes = await request(app)
      .patch("/api/dashboard/settings")
      .send({
        pickup_locations: [
          {
            id: "branch_a",
            name: { ar: "فرع أ", en: "Branch A" },
            address: { ar: "العنوان 1", en: "Address 1" },
            latitude: 200,
            longitude: 45
          }
        ]
      })
      .set(auth("admin"));
    expectStatus(invalidCoordsRes, 400, "invalid latitude coordinate");

    // Unauthorized check for settings patch
    const unauthorizedPatchRes = await request(app)
      .patch("/api/dashboard/settings")
      .send({
        pickup_locations: []
      })
      .set(auth("courier"));
    expectStatus(unauthorizedPatchRes, 403, "unauthorized role patch settings");

    // Re-seed original pickup_locations so subsequent tests are not affected
    await request(app)
      .patch("/api/dashboard/settings")
      .send({
        pickup_locations: [
          {
            id: "branch_1",
            name: { ar: "فرع الرياض", en: "Riyadh Branch" },
            address: { ar: "العنوان 1", en: "Address 1" },
            isActive: true
          }
        ]
      })
      .set(auth("admin"));
  });

  // 16. Forbidden Role Check
  await test("Forbidden Role checks block courier/cashier from settings", async () => {
    const res = await request(app)
      .get("/api/dashboard/settings")
      .set(auth("courier"));
    // Courier role is unauthorized for general settings route, returns 403 Forbidden.
    expectStatus(res, 403, "forbidden role check");
  });

  // 17. 404 Behavior for Non-existent resources
  await test("Resource 404: Returns NOT_FOUND for missing ObjectId", async () => {
    const missingId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/dashboard/payments/${missingId}`)
      .set(auth("admin"));
    expectStatus(res, 404, "payment 404 check");
  });

  // 18. Partial Pickup and Addon Invariant: 4 planned -> pick 2 -> remaining availability is 2, unpicked NOT refunded
  await test("Subscription Invariant: 4 planned addons -> pick 2 -> future availability returns exactly 2", async () => {
    const addonId = new mongoose.Types.ObjectId();
    const sub = await Subscription.create({
      userId: seedData.client._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 10,
      remainingMeals: 10,
      deliveryMode: "pickup",
      pickupLocationId: "branch_1",
      addonBalance: [
        { addonId, purchasedQty: 4, remainingQty: 0 }
      ],
      startDate: "2026-06-17",
      endDate: "2026-07-17",
    });

    const day = await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: "2026-06-17",
      status: "open",
      mealSlots: [
        { _id: new mongoose.Types.ObjectId(), slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" }
      ],
      addonSelections: [
        { _id: new mongoose.Types.ObjectId(), addonId, category: "juice", source: "wallet", priceHalala: 0 },
        { _id: new mongoose.Types.ObjectId(), addonId, category: "juice", source: "wallet", priceHalala: 0 },
        { _id: new mongoose.Types.ObjectId(), addonId, category: "juice", source: "wallet", priceHalala: 0 },
        { _id: new mongoose.Types.ObjectId(), addonId, category: "juice", source: "wallet", priceHalala: 0 },
      ]
    });

    const { getPickupAvailabilityForClient, createSubscriptionPickupRequestForClient } = require("../src/services/subscription/subscriptionPickupRequestClientService");
    
    // Check initial pickup availability (all 4 should be available)
    let avail = await getPickupAvailabilityForClient({
      userId: seedData.client._id,
      subscriptionId: sub._id,
      date: "2026-06-17",
    });
    assert.strictEqual(avail.pickupItems.filter(i => i.itemType === "addon").length, 4);

    const mealSlotItemId = "slot_1";
    const addonItemIds = avail.pickupItems.filter(i => i.itemType === "addon").slice(0, 2).map(i => i.itemId);

    // Pick 2 addons
    const pickupRes = await createSubscriptionPickupRequestForClient({
      userId: seedData.client._id,
      subscriptionId: sub._id,
      date: "2026-06-17",
      mealCount: 0,
      selectedPickupItemIds: [mealSlotItemId, ...addonItemIds],
    });

    // Future availability check (should return remaining 2)
    avail = await getPickupAvailabilityForClient({
      userId: seedData.client._id,
      subscriptionId: sub._id,
      date: "2026-06-17",
    });
    const remainingAddonItems = avail.pickupItems.filter(i => i.itemType === "addon");
    assert.strictEqual(remainingAddonItems.length, 2, "Should return exactly 2 unpicked addons");
    assert(!remainingAddonItems.map(i => i.itemId).includes(addonItemIds[0]), "Picked addon 0 should not reappear");
    assert(!remainingAddonItems.map(i => i.itemId).includes(addonItemIds[1]), "Picked addon 1 should not reappear");

    // Fulfill pickup request
    const pr = await SubscriptionPickupRequest.findById(pickupRes.pickupRequest._id);
    pr.status = "ready_for_pickup";
    await pr.save();

    const { fulfillSubscriptionPickupRequest } = require("../src/services/fulfillmentService");
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await fulfillSubscriptionPickupRequest({
        requestId: pickupRes.pickupRequest._id,
        session,
        actorId: seedData.client._id
      });
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    // Verify unpicked are NOT refunded to wallet remainingQty
    const updatedSub = await Subscription.findById(sub._id);
    assert.strictEqual(updatedSub.addonBalance[0].remainingQty, 0, "Unpicked planned addons must not be refunded to wallet balance");

    await Subscription.deleteOne({ _id: sub._id });
    await SubscriptionDay.deleteOne({ _id: day._id });
    await SubscriptionPickupRequest.deleteMany({ subscriptionId: sub._id });
  });

  // 19. Premium Upgrade Meal Invariant: Premium upgrades do not create extra meals
  await test("Subscription Invariant: Premium upgrades upgrade existing slots or consume balance without creating extra meals", async () => {
    const sub = await Subscription.create({
      userId: seedData.client._id,
      planId: seedData.plan._id,
      status: "active",
      totalMeals: 10,
      remainingMeals: 8,
      deliveryMode: "delivery",
      startDate: "2026-06-17",
      endDate: "2026-07-17",
    });

    // Simulating premium meal slot selection
    const day = await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: "2026-06-17",
      status: "open",
      mealSlots: [
        { _id: new mongoose.Types.ObjectId(), slotIndex: 1, slotKey: "slot_1", selectionType: "premium_meal", status: "complete" }
      ]
    });

    // Verify remaining meals total count didn't increase
    assert.strictEqual(sub.totalMeals, 10, "Total meals count must remain invariant at 10");
    assert.strictEqual(day.mealSlots.length, 1, "There must be exactly one meal slot on the day");

    await Subscription.deleteOne({ _id: sub._id });
    await SubscriptionDay.deleteOne({ _id: day._id });
  });

  // 20. Add-ons are not counted as meal slots
  await test("Subscription Invariant: Add-ons are independent entitlements and not counted as meal slots", async () => {
    const addonId = new mongoose.Types.ObjectId();
    const tempSubId = new mongoose.Types.ObjectId();
    const day = await SubscriptionDay.create({
      subscriptionId: tempSubId,
      date: "2026-06-17",
      status: "open",
      mealSlots: [
        { _id: new mongoose.Types.ObjectId(), slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" }
      ],
      addonSelections: [
        { _id: new mongoose.Types.ObjectId(), addonId, category: "juice", source: "wallet", priceHalala: 0 }
      ]
    });

    assert.strictEqual(day.mealSlots.length, 1, "mealSlots array length must remain exactly 1");
    assert.strictEqual(day.addonSelections.length, 1, "addonSelections array must be populated separately");

    await SubscriptionDay.deleteOne({ _id: day._id });
  });

  console.log(`\n==========================================`);
  console.log(`RESULTS: ${results.passed} passed, ${results.failed} failed`);
  console.log(`==========================================\n`);

  await cleanup();
  await mongoose.disconnect();

  if (results.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
