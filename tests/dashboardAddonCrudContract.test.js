process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Addon = require("../src/models/Addon");
const AddonPlanPrice = require("../src/models/AddonPlanPrice");
const Plan = require("../src/models/Plan");
const MenuProduct = require("../src/models/MenuProduct");
const MenuCategory = require("../src/models/MenuCategory");

const {
  listAddonsAdmin,
  createAddon,
  updateAddon,
  getAddonAdmin
} = require("../src/controllers/addonController");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { storageEngine: "wiredTiger" } });
  const uri = mongoServer.getUri(`addon_crud_test_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.data = obj;
      return this;
    },
  };
  return res;
}

async function runTests() {
  await connect();
  try {
    console.log("--- 1. Set Up Mock Data ---");
    const menuCategory = await MenuCategory.create({
      key: "drinks",
      name: { en: "Drinks", ar: "مشروبات" },
      isActive: true,
    });

    const juice1 = await MenuProduct.create({
      categoryId: menuCategory._id,
      key: "orange_juice_test",
      name: { en: "Orange Juice", ar: "عصير برتقال" },
      priceHalala: 1000,
      availableFor: ["subscription"],
      isActive: true,
    });

    const juice2 = await MenuProduct.create({
      categoryId: menuCategory._id,
      key: "apple_juice_test",
      name: { en: "Apple Juice", ar: "عصير تفاح" },
      priceHalala: 1200,
      availableFor: ["subscription"],
      isActive: true,
    });

    const basePlan1 = await Plan.create({
      name: { en: "7 Days Plan", ar: "7 أيام" },
      daysCount: 7,
      durationDays: 7,
      active: true,
      available: true,
      isAvailable: true,
      currency: "SAR",
      isActive: true,
    });

    const basePlan2 = await Plan.create({
      name: { en: "30 Days Plan", ar: "30 يوم" },
      daysCount: 30,
      durationDays: 30,
      active: true,
      available: true,
      isAvailable: true,
      currency: "SAR",
      isActive: true,
    });

    console.log("--- 2. GET /api/dashboard/addons (Empty Database) ---");
    {
      const req = { query: {} };
      const res = mockResponse();
      await listAddonsAdmin(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.data.data.items, []);
      assert.deepStrictEqual(res.data.data.plans, []);
      assert.deepStrictEqual(res.data.data.meta.addonPlanCategories, [
        {
          key: "juice",
          label: { ar: "اشتراك العصير", en: "Juice Subscription" },
          description: { ar: "اختيارات العصائر والمشروبات", en: "Juice and drink entitlement" },
        },
        {
          key: "small_salad",
          label: { ar: "اشتراك السلطة الصغيرة", en: "Small Salad Subscription" },
          description: { ar: "اختيارات السلطة الصغيرة", en: "Small salad entitlement" },
        },
        {
          key: "snack",
          label: { ar: "اشتراك السناك", en: "Snack Subscription" },
          description: { ar: "اختيارات السناك والحلويات الصحية", en: "Snack and healthy dessert entitlement" },
        },
      ]);
      assert.strictEqual(res.data.data.summary.totalItems, 0);
      assert.strictEqual(res.data.data.summary.totalPlans, 0);
    }

    console.log("--- 3. POST /api/dashboard/addons (Create Subscription Plan) ---");
    let createdPlanId;
    {
      const req = {
        body: {
          name: { en: "Fresh Juice Subscription", ar: "اشتراك عصير طازج" },
          kind: "plan",
          category: "juice",
          menuProductIds: [juice1._id, juice2._id],
          planPrices: [
            { basePlanId: basePlan1._id, priceHalala: 7000, isActive: true },
            { basePlanId: basePlan2._id, priceHalala: 26000, isActive: true }
          ]
        }
      };
      const res = mockResponse();
      await createAddon(req, res);
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.data.status, true);
      assert.strictEqual(res.data.data.name.en, "Fresh Juice Subscription");
      assert.strictEqual(res.data.data.kind, "plan");
      assert.strictEqual(res.data.data.category, "juice");
      assert.strictEqual(res.data.data.menuProducts.length, 2);
      assert.strictEqual(res.data.data.menuProducts[0].name.en, "Orange Juice");
      assert.strictEqual(res.data.data.planPrices.length, 2);
      assert.strictEqual(res.data.data.planPrices[0].priceHalala, 7000);
      assert.strictEqual(res.data.data.planPrices[0].priceSar, 70);
      assert.strictEqual(res.data.data.pricingMode, "base_plan_matrix");
      createdPlanId = res.data.data.id;
    }

    console.log("--- 4. GET /api/dashboard/addons (Single populated plan) ---");
    {
      const req = { query: {} };
      const res = mockResponse();
      await listAddonsAdmin(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.data.plans.length, 1);
      assert.strictEqual(res.data.data.plans[0].name.en, "Fresh Juice Subscription");
      assert.strictEqual(res.data.data.plans[0].menuProducts.length, 2);
      assert.strictEqual(res.data.data.plans[0].planPrices.length, 2);
      assert.strictEqual(res.data.data.summary.totalPlans, 1);
    }

    console.log("--- 5. PUT /api/dashboard/addons/:id (Update Subscription Plan) ---");
    {
      const req = {
        params: { id: createdPlanId },
        body: {
          name: { en: "Super Juice Subscription", ar: "اشتراك عصير سوبر" },
          kind: "plan",
          category: "juice",
          menuProductIds: [juice2._id], // Remove juice1
          planPrices: [
            { basePlanId: basePlan1._id, priceHalala: 8000, isActive: true } // Update price, remove basePlan2 price
          ]
        }
      };
      const res = mockResponse();
      await updateAddon(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.data.name.en, "Super Juice Subscription");
      assert.strictEqual(res.data.data.menuProducts.length, 1);
      assert.strictEqual(res.data.data.menuProducts[0].name.en, "Apple Juice");
      assert.strictEqual(res.data.data.planPrices.length, 1);
      assert.strictEqual(res.data.data.planPrices[0].priceHalala, 8000);
    }

    console.log("--- 6. POST /api/dashboard/addons (Create Item) ---");
    {
      const req = {
        body: {
          name: { en: "One-time Salad", ar: "سلطة لمرة واحدة" },
          kind: "item",
          category: "small_salad",
          priceHalala: 1500,
          billingMode: "flat_once",
        }
      };
      const res = mockResponse();
      await createAddon(req, res);
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.data.data.name.en, "One-time Salad");
      assert.strictEqual(res.data.data.kind, "item");
      assert.strictEqual(res.data.data.priceHalala, 1500);
      assert.strictEqual(res.data.data.priceSar, 15);
    }

    console.log("--- 7. GET /api/dashboard/addons (Populated structured payload) ---");
    {
      const req = { query: {} };
      const res = mockResponse();
      await listAddonsAdmin(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.data.items.length, 1);
      assert.strictEqual(res.data.data.plans.length, 1);
      assert.strictEqual(res.data.data.summary.totalItems, 1);
      assert.strictEqual(res.data.data.summary.totalPlans, 1);

      // Verify legacyCompatibility block in plan
      const plan = res.data.data.plans[0];
      assert.ok(plan.legacyCompatibility);
      assert.strictEqual(plan.legacyCompatibility.priceHalala, 0);

      // Verify top level fields in item
      const item = res.data.data.items[0];
      assert.strictEqual(item.priceHalala, 1500);
      assert.strictEqual(item.priceSar, 15);
    }

    console.log("--- 8. Strict Validations: Invalid category for plan ---");
    {
      const req = {
        body: {
          name: { en: "Invalid Category Plan", ar: "خطة غير صالحة" },
          kind: "plan",
          category: "desert", // invalid — unknown category
          menuProductIds: [juice1._id],
        }
      };
      const res = mockResponse();
      await createAddon(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.data.error.code, "INVALID");
      assert.ok(res.data.error.message.toLowerCase().includes("juice") || res.data.error.message.toLowerCase().includes("category"),
        "Error must mention valid categories");
    }

    console.log("--- 8b. Strict Validations: Invalid category 'proteins' for plan ---");
    {
      // 'proteins' is a menu product category — not a valid addon plan category
      const req = {
        body: {
          name: { en: "Proteins Plan", ar: "خطة بروتين" },
          kind: "plan",
          category: "proteins",
          menuProductIds: [juice1._id],
        }
      };
      const res = mockResponse();
      await createAddon(req, res);
      assert.strictEqual(res.statusCode, 400, "'proteins' must be rejected as an addon plan category");
      assert.strictEqual(res.data.error.code, "INVALID");
    }

    console.log("--- 8c. Strict Validations: Invalid category 'addons' for plan ---");
    {
      const req = {
        body: {
          name: { en: "Addons Category Plan", ar: "خطة إضافات" },
          kind: "plan",
          category: "addons",
          menuProductIds: [juice1._id],
        }
      };
      const res = mockResponse();
      await createAddon(req, res);
      assert.strictEqual(res.statusCode, 400, "'addons' must be rejected as an addon plan category");
    }

    console.log("--- 9. Strict Validations: Duplicate basePlanId ---");
    {
      const req = {
        body: {
          name: { en: "Duplicate Plan Prices", ar: "تكرار الأسعار" },
          kind: "plan",
          category: "juice",
          planPrices: [
            { basePlanId: basePlan1._id, priceHalala: 1000, isActive: true },
            { basePlanId: basePlan1._id, priceHalala: 2000, isActive: true } // duplicate
          ]
        }
      };
      const res = mockResponse();
      await createAddon(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.data.error.message.includes("Duplicate basePlanId"));
    }

    console.log("--- 10. Strict Validations: Non-existent basePlanId ---");
    {
      const req = {
        body: {
          name: { en: "Fake Base Plan", ar: "خطة أساسية وهمية" },
          kind: "plan",
          category: "juice",
          planPrices: [
            { basePlanId: new mongoose.Types.ObjectId(), priceHalala: 1000, isActive: true }
          ]
        }
      };
      const res = mockResponse();
      await createAddon(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.data.error.message.includes("basePlanIds in planPrices do not exist"));
    }

    console.log("--- 11. Transaction Rollback Simulation on duplicate active price ---");
    {
      // First, let's pre-create an active price matrix row for basePlan1 in database manually
      // We will try to create a plan that has two identical active prices for basePlan1 to trigger the DUPLICATE_ACTIVE_PRICE throw
      const req = {
        body: {
          name: { en: "Rollback Test Plan", ar: "خطة التراجع" },
          kind: "plan",
          category: "juice",
          planPrices: [
            { basePlanId: basePlan1._id, priceHalala: 1000, isActive: true },
            { basePlanId: basePlan1._id, priceHalala: 1000, isActive: true }
          ]
        }
      };
      const res = mockResponse();
      await createAddon(req, res);
      assert.strictEqual(res.statusCode, 400);

      // Verify that no addon document with name "Rollback Test Plan" exists in database (rolled back)
      const found = await Addon.findOne({ "name.en": "Rollback Test Plan" });
      assert.strictEqual(found, null);
    }

    console.log("--- 12. GET /addons/:id (Individual populated plan read) ---");
    {
      const req = { params: { id: createdPlanId }, query: {} };
      const res = mockResponse();
      await getAddonAdmin(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.status, true);
      assert.strictEqual(res.data.data.name.en, "Super Juice Subscription");
      assert.strictEqual(res.data.data.menuProducts.length, 1);
      assert.strictEqual(res.data.data.planPrices.length, 1);
    }

    console.log("--- 13. data.items excludes test/contract-named records by default ---");
    {
      // Create a test/contract-named item
      await Addon.create({
        name: { en: "dash-contract-xyz Juice", ar: "عصير تجريبي" },
        kind: "item",
        category: "juice",
        priceHalala: 500,
        billingMode: "flat_once",
        isActive: true,
        currency: "SAR",
      });
      // Create a test-prefixed item
      await Addon.create({
        name: { en: "Test Snack Item", ar: "سناك تجريبي" },
        kind: "item",
        category: "snack",
        priceHalala: 700,
        billingMode: "flat_once",
        isActive: true,
        currency: "SAR",
      });
      // Create a real item (should appear)
      await Addon.create({
        name: { en: "Real Snack Box", ar: "صندوق سناك حقيقي" },
        kind: "item",
        category: "snack",
        priceHalala: 1500,
        billingMode: "flat_once",
        isActive: true,
        currency: "SAR",
      });

      const req = { query: {} };
      const res = mockResponse();
      await listAddonsAdmin(req, res);
      assert.strictEqual(res.statusCode, 200);

      const itemNames = res.data.data.items.map(i => i.name && i.name.en);
      assert.ok(!itemNames.some(n => n && n.startsWith("dash-contract-")),
        "data.items must not contain dash-contract- named items");
      assert.ok(!itemNames.some(n => n && /^test\s/i.test(n)),
        "data.items must not contain test-prefixed named items");
      assert.ok(itemNames.includes("Real Snack Box"),
        "Real items must appear in data.items");
    }

    console.log("--- 14. meta.addonPlanCategories only allowed keys: juice, small_salad, snack ---");
    {
      const req = { query: {} };
      const res = mockResponse();
      await listAddonsAdmin(req, res);
      assert.strictEqual(res.statusCode, 200);
      const cats = res.data.data.meta.addonPlanCategories;
      const keys = cats.map(c => c.key);
      const allowedKeys = new Set(["juice", "small_salad", "snack"]);
      assert.ok(keys.every(k => allowedKeys.has(k)), `Only juice/small_salad/snack allowed. Got: ${JSON.stringify(keys)}`);
      // Verify rich structure
      for (const cat of cats) {
        assert.ok(cat.key, `category must have key`);
        assert.ok(cat.label && cat.label.en && cat.label.ar, `category must have label.en and label.ar`);
        assert.ok(cat.description && cat.description.en && cat.description.ar, `category must have description.en and description.ar`);
      }
    }

    console.log("All dashboard CRUD contract verification tests passed successfully!");
  } finally {
    await disconnect();
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
