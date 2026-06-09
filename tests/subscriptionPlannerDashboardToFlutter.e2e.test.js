process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";
process.env.MOYASAR_SECRET_KEY = process.env.MOYASAR_SECRET_KEY || "test_moyasar_secret";

const assert = require("assert");
const { EventEmitter } = require("events");
const https = require("https");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");
const sinon = require("sinon");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const CatalogItem = require("../src/models/CatalogItem");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const Payment = require("../src/models/Payment");
const Plan = require("../src/models/Plan");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");

function tokenFor(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET,
    { expiresIn: "31d" }
  );
}

function installMoyasarStub() {
  let invoiceSeq = 0;
  const invoices = new Map();
  const stub = sinon.stub(https, "request").callsFake((options, callback) => {
    const req = new EventEmitter();
    let requestBody = "";
    req.write = (chunk) => { requestBody += String(chunk || ""); };
    req.setTimeout = () => req;
    req.destroy = (err) => process.nextTick(() => req.emit("error", err));
    req.end = () => {
      process.nextTick(() => {
        const method = String(options.method || "GET").toUpperCase();
        const path = String(options.path || "");
        let statusCode = 200;
        let payload;
        if (method === "POST" && path === "/v1/invoices") {
          const body = requestBody ? JSON.parse(requestBody) : {};
          const id = `inv_e2e_${++invoiceSeq}`;
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
          const id = new URLSearchParams(path.split("?")[1] || "").get("id");
          const invoice = invoices.get(id);
          if (!invoice) {
            statusCode = 404;
            payload = { message: "Invoice not found" };
          } else {
            payload = {
              invoices: [{
                ...invoice,
                status: "paid",
                payments: [{
                  id: `pay_${id}`,
                  status: "paid",
                  amount: invoice.amount,
                  currency: invoice.currency,
                }],
              }],
            };
          }
        } else {
          statusCode = 500;
          payload = { message: `Unexpected Moyasar request ${method} ${path}` };
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

async function connect() {
  const mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "subscription_planner_dashboard_to_flutter" },
  });
  const uri = mongoServer.getUri("subscription_planner_dashboard_to_flutter");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  return mongoServer;
}

async function catalogItem(key, itemKind) {
  return CatalogItem.create({
    key,
    itemKind,
    nameI18n: { en: key, ar: key },
    isActive: true,
    isAvailable: true,
  });
}

async function seedCatalog() {
  const now = new Date();
  const [customCategory, juiceCategory, drinkCategory, snackCategory, saladCategory] = await Promise.all([
    MenuCategory.create({ key: "custom_order", name: { en: "Custom Order", ar: "Custom Order" }, isActive: true, isAvailable: true, publishedAt: now }),
    MenuCategory.create({ key: "juices", name: { en: "Juices", ar: "Juices" }, isActive: true, isAvailable: true, publishedAt: now }),
    MenuCategory.create({ key: "drinks", name: { en: "Drinks", ar: "Drinks" }, isActive: true, isAvailable: true, publishedAt: now }),
    MenuCategory.create({ key: "desserts", name: { en: "Desserts", ar: "Desserts" }, isActive: true, isAvailable: true, publishedAt: now }),
    MenuCategory.create({ key: "light_options", name: { en: "Light Options", ar: "Light Options" }, isActive: true, isAvailable: true, publishedAt: now }),
  ]);
  const [proteinsGroup, carbsGroup] = await Promise.all([
    MenuOptionGroup.create({ key: "proteins", name: { en: "Protein", ar: "Protein" }, isActive: true, isAvailable: true, publishedAt: now }),
    MenuOptionGroup.create({ key: "carbs", name: { en: "Carbs", ar: "Carbs" }, isActive: true, isAvailable: true, publishedAt: now }),
  ]);
  const [basicItem, saladItem, chickenItem, riceItem] = await Promise.all([
    catalogItem("basic_meal_item", "product"),
    catalogItem("premium_large_salad_item", "product"),
    catalogItem("grilled_chicken_item", "protein"),
    catalogItem("white_rice_item", "carb"),
  ]);
  const [basicMeal, premiumLargeSalad, chicken, rice] = await Promise.all([
    MenuProduct.create({
      categoryId: customCategory._id,
      catalogItemId: basicItem._id,
      key: "basic_meal",
      itemType: "basic_meal",
      name: { en: "Basic Meal", ar: "Basic Meal" },
      pricingModel: "per_100g",
      priceHalala: 1900,
      currency: "SAR",
      availableFor: ["subscription"],
      isActive: true,
      isAvailable: true,
      publishedAt: now,
    }),
    MenuProduct.create({
      categoryId: customCategory._id,
      catalogItemId: saladItem._id,
      key: "premium_large_salad",
      itemType: "premium_large_salad",
      name: { en: "Premium Large Salad", ar: "Premium Large Salad" },
      pricingModel: "fixed",
      priceHalala: 3000,
      currency: "SAR",
      availableFor: ["subscription"],
      isActive: true,
      isAvailable: true,
      publishedAt: now,
    }),
    MenuOption.create({
      groupId: proteinsGroup._id,
      catalogItemId: chickenItem._id,
      key: "grilled_chicken",
      name: { en: "Grilled Chicken", ar: "Grilled Chicken" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      isActive: true,
      isAvailable: true,
      publishedAt: now,
    }),
    MenuOption.create({
      groupId: carbsGroup._id,
      catalogItemId: riceItem._id,
      key: "white_rice",
      name: { en: "White Rice", ar: "White Rice" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      isActive: true,
      isAvailable: true,
      publishedAt: now,
    }),
  ]);

  for (const product of [basicMeal, premiumLargeSalad]) {
    await ProductOptionGroup.create({ productId: product._id, groupId: proteinsGroup._id, minSelections: 1, maxSelections: 1, isRequired: true });
    await ProductGroupOption.create({ productId: product._id, groupId: proteinsGroup._id, optionId: chicken._id });
  }
  await ProductOptionGroup.create({ productId: basicMeal._id, groupId: carbsGroup._id, minSelections: 1, maxSelections: 2, isRequired: true });
  await ProductGroupOption.create({ productId: basicMeal._id, groupId: carbsGroup._id, optionId: rice._id });

  const addonProducts = await Promise.all([
    MenuProduct.create({ categoryId: juiceCategory._id, key: "orange_juice", itemType: "juice", name: { en: "Orange Juice", ar: "Orange Juice" }, pricingModel: "fixed", priceHalala: 1000, currency: "SAR", availableFor: ["one_time", "subscription"], isActive: true, isAvailable: true, publishedAt: now }),
    MenuProduct.create({ categoryId: drinkCategory._id, key: "water", itemType: "drink", name: { en: "Water", ar: "Water" }, pricingModel: "fixed", priceHalala: 200, currency: "SAR", availableFor: ["one_time", "subscription"], isActive: true, isAvailable: true, publishedAt: now }),
    MenuProduct.create({ categoryId: snackCategory._id, key: "laban", itemType: "dessert", name: { en: "Laban", ar: "Laban" }, pricingModel: "fixed", priceHalala: 1300, currency: "SAR", availableFor: ["one_time", "subscription"], isActive: true, isAvailable: true, publishedAt: now }),
    MenuProduct.create({ categoryId: saladCategory._id, key: "green_salad", itemType: "green_salad", name: { en: "Green Salad", ar: "Green Salad" }, pricingModel: "fixed", priceHalala: 1900, currency: "SAR", availableFor: ["one_time", "subscription"], isActive: true, isAvailable: true, publishedAt: now }),
  ]);

  return { premiumLargeSalad, proteinsGroup, chicken, addon: addonProducts[0], addonProducts };
}

function premiumSaladPayload(fixture) {
  return {
    contractVersion: "meal_planner_menu.v3",
    mealSlots: [{
      slotIndex: 1,
      selectionType: "premium_large_salad",
      productId: String(fixture.premiumLargeSalad._id),
      selectedOptions: [{
        groupId: String(fixture.proteinsGroup._id),
        groupKey: "proteins",
        optionId: String(fixture.chicken._id),
        optionKey: "grilled_chicken",
        quantity: 1,
      }],
    }],
    addonsOneTime: [String(fixture.addon._id)],
  };
}

async function run() {
  const mongoServer = await connect();
  const restoreMoyasar = installMoyasarStub();
  try {
    const fixture = await seedCatalog();
    const user = await User.create({ phone: "+966500000003", password: "password" });
    const plan = await Plan.create({
      name: { en: "Planner E2E", ar: "Planner E2E" },
      daysCount: 30,
      mealsPerDay: 1,
      basePriceHalala: 50000,
      isActive: true,
      isCommerciallyViable: true,
      price: 500,
    });
    const subscription = await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: "active",
      startDate: "2026-10-01",
      endDate: "2026-10-30",
      totalMeals: 30,
      remainingMeals: 30,
      selectedMealsPerDay: 1,
      deliveryMode: "pickup",
      premiumBalance: [],
    });
    const date = "2026-10-20";
    await SubscriptionDay.create({ subscriptionId: subscription._id, date, status: "open" });

    const app = createApp();
    const api = request(app);
    const { headers: dashboardHeaders } = await dashboardAuth("admin", "planner-e2e");
    const appHeaders = { Authorization: `Bearer ${tokenFor(user._id)}` };

    const readinessRes = await api.get("/api/dashboard/health/meal-planner").set(dashboardHeaders);
    assert.strictEqual(readinessRes.status, 200, `readiness endpoint: ${JSON.stringify(readinessRes.body)}`);
    assert.strictEqual(readinessRes.body.data.ready, true, JSON.stringify(readinessRes.body.data, null, 2));

    const menuRes = await api.get("/api/subscriptions/meal-planner-menu?lang=ar").set(appHeaders);
    assert.strictEqual(menuRes.status, 200, `meal planner menu: ${JSON.stringify(menuRes.body)}`);
    assert(menuRes.body.data?.builderCatalog, "meal planner menu returns builderCatalog");
    assert.strictEqual(menuRes.body.data.builderCatalog.contractVersion, "meal_planner_menu.v3");
    assert.strictEqual(menuRes.body.data.plannerCatalog, undefined, "flutter planner payload does not use plannerCatalog");
    assert.strictEqual(menuRes.body.data.builderCatalogV2, undefined, "flutter planner payload does not use builderCatalogV2");
    for (const key of ["categories", "proteins", "carbs", "premiumProteins", "premiumLargeSalad"]) {
      assert.strictEqual(menuRes.body.data.builderCatalog[key], undefined, `flutter planner payload omits legacy ${key}`);
    }
    for (const section of menuRes.body.data.builderCatalog.sections) {
      if (section.nameI18n?.ar) assert.strictEqual(section.name, section.nameI18n.ar, `section ${section.key} uses Arabic label`);
      for (const product of section.products || []) {
        if (product.nameI18n?.ar) assert.strictEqual(product.name, product.nameI18n.ar, `product ${product.key} uses Arabic label`);
        for (const group of product.optionGroups || []) {
          if (group.nameI18n?.ar) assert.strictEqual(group.name, group.nameI18n.ar, `group ${group.key} uses Arabic label`);
          for (const option of group.options || []) {
            if (option.nameI18n?.ar) assert.strictEqual(option.name, option.nameI18n.ar, `option ${option.key} uses Arabic label`);
          }
        }
      }
    }
    const plannerSectionsByKey = new Map(menuRes.body.data.builderCatalog.sections.map((section) => [section.key, section]));
    const premiumSaladProduct = (plannerSectionsByKey.get("premium_large_salad")?.products || [])
      .concat(plannerSectionsByKey.get("premium")?.products || [])
      .find((product) => product.key === "premium_large_salad");
    assert(premiumSaladProduct, "plannerCatalog-only payload exposes premium_large_salad product");
    assert.strictEqual(premiumSaladProduct.action.requiresBuilder, true);
    assert((premiumSaladProduct.optionGroups || []).length > 0, "premium_large_salad exposes option groups");

    const addonRes = await api.get("/api/subscriptions/addon-choices").set(appHeaders);
    assert.strictEqual(addonRes.status, 200, `addon choices: ${JSON.stringify(addonRes.body)}`);
    assert(addonRes.body.data.juice.choices.some((choice) => String(choice.id) === String(fixture.addon._id)), "addon choices include seeded juice");
    assert(addonRes.body.data.juice.choices.some((choice) => choice.categoryKey === "drinks" && choice.type === "menu_product"), "addon choices include drink MenuProducts");
    assert(addonRes.body.data.snack.choices.some((choice) => choice.categoryKey === "desserts" && choice.itemType === "dessert" && choice.type === "menu_product"), "addon choices include dessert/snack MenuProducts");
    assert(addonRes.body.data.small_salad.choices.some((choice) => choice.categoryKey === "light_options" && choice.key === "green_salad" && choice.type === "menu_product"), "addon choices include salad MenuProducts");
    assert(Object.values(addonRes.body.data).flatMap((entry) => entry.choices || []).every((choice) => choice.kind !== "plan" && choice.type !== "subscription"), "daily add-on choices exclude subscription plan rows");

    const initialDayRes = await api.get(`/api/subscriptions/${subscription._id}/days/${date}`).set(appHeaders);
    assert.strictEqual(initialDayRes.status, 200, `initial day read: ${JSON.stringify(initialDayRes.body)}`);

    const saveRes = await api.put(`/api/subscriptions/${subscription._id}/days/${date}/selection`).set(appHeaders).send(premiumSaladPayload(fixture));
    assert.strictEqual(saveRes.status, 200, `v3 save: ${JSON.stringify(saveRes.body)}`);
    assert(saveRes.body.data.plannerRevisionHash, "v3 save returns plannerRevisionHash");
    assert.strictEqual(saveRes.body.data.paymentRequirement.requiresPayment, true);
    assert.strictEqual(saveRes.body.data.paymentRequirement.blockingReason, "PREMIUM_PAYMENT_REQUIRED");
    assert.strictEqual(saveRes.body.data.paymentRequirement.addonPendingPaymentCount, 1);

    const createRes = await api
      .post(`/api/subscriptions/${subscription._id}/days/${date}/payments`)
      .set(appHeaders)
      .send({ plannerRevisionHash: saveRes.body.data.plannerRevisionHash });
    assert.strictEqual(createRes.status, 201, `unified payment create: ${JSON.stringify(createRes.body)}`);
    assert(createRes.body.data.paymentId && createRes.body.data.payment_id, "payment create returns both payment id aliases");
    assert.strictEqual(createRes.body.data.premiumAmountHalala, 3000);
    assert.strictEqual(createRes.body.data.addonsAmountHalala, 1000);
    assert.strictEqual(createRes.body.data.totalHalala, 4000);
    assert(createRes.body.data.paymentUrl || createRes.body.data.payment_url, "payment create returns provider URL");

    const payment = await Payment.findById(createRes.body.data.paymentId).lean();
    assert.strictEqual(payment.type, "day_planning_payment");

    const verifyRes = await api
      .post(`/api/subscriptions/${subscription._id}/days/${date}/payments/${createRes.body.data.paymentId}/verify`)
      .set(appHeaders)
      .send({});
    assert.strictEqual(verifyRes.status, 200, `unified payment verify: ${JSON.stringify(verifyRes.body)}`);
    assert.strictEqual(verifyRes.body.data.paymentStatus, "paid");
    assert.strictEqual(verifyRes.body.data.requiresPayment, false);
    assert.strictEqual(verifyRes.body.data.paymentRequirement.requiresPayment, false);

    const confirmRes = await api.post(`/api/subscriptions/${subscription._id}/days/${date}/confirm`).set(appHeaders).send({});
    assert.strictEqual(confirmRes.status, 200, `confirm day: ${JSON.stringify(confirmRes.body)}`);
    assert.strictEqual(confirmRes.body.data.commercialState, "confirmed");

    const finalDayRes = await api.get(`/api/subscriptions/${subscription._id}/days/${date}`).set(appHeaders);
    assert.strictEqual(finalDayRes.status, 200, `final day read: ${JSON.stringify(finalDayRes.body)}`);
    assert.strictEqual(finalDayRes.body.data.commercialState, "confirmed");

    console.log("subscription planner dashboard-to-flutter e2e checks passed");
  } finally {
    restoreMoyasar();
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
