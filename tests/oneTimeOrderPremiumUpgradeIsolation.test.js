process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";
process.env.ALLOW_CATALOG_RESET = "true";
process.env.BOOTSTRAP_SYNC = "true";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { seedCatalog } = require("../scripts/bootstrap/seed-catalog");
const { priceOrderCart } = require("../src/services/orders/orderPricingService");
const { priceMenuCart } = require("../src/services/orders/menuPricingService");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const Setting = require("../src/models/Setting");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`one_time_premium_isolation_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function upsertSetting(key, value) {
  await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
}

async function withPremiumUpgradeConfigQueriesForbidden(fn) {
  const originals = {
    find: PremiumUpgradeConfig.find,
    findOne: PremiumUpgradeConfig.findOne,
    findById: PremiumUpgradeConfig.findById,
  };
  const fail = () => {
    throw new Error("one-time order pricing must not query PremiumUpgradeConfig");
  };
  PremiumUpgradeConfig.find = fail;
  PremiumUpgradeConfig.findOne = fail;
  PremiumUpgradeConfig.findById = fail;
  try {
    return await fn();
  } finally {
    PremiumUpgradeConfig.find = originals.find;
    PremiumUpgradeConfig.findOne = originals.findOne;
    PremiumUpgradeConfig.findById = originals.findById;
  }
}

async function main() {
  await connect();
  try {
    await seedCatalog({ reset: true, sync: true });
    await upsertSetting("one_time_standard_meal_price_halala", 4200);

    const [steak, carb] = await Promise.all([
      BuilderProtein.findOne({ premiumKey: "beef_steak" }).lean(),
      BuilderCarb.findOne({ isActive: true }).lean(),
    ]);
    assert(steak && carb, "one-time legacy builder fixtures exist");

    await BuilderProtein.updateOne({ _id: steak._id }, { $set: { extraFeeHalala: 1500 } });
    await PremiumUpgradeConfig.create({
      sourceType: "menu_option",
      sourceId: new mongoose.Types.ObjectId(),
      selectionType: "premium_meal",
      premiumKey: "beef_steak",
      upgradeDeltaHalala: 2000,
      isEnabled: true,
      isVisible: true,
      status: "active",
    });

    const quotePayload = {
      userId: new mongoose.Types.ObjectId(),
      fulfillmentMethod: "pickup",
      pickup: { branchId: "main" },
      items: [
        {
          itemType: "standard_meal",
          qty: 1,
          selections: {
            proteinId: String(steak._id),
            carbs: [{ carbId: String(carb._id), grams: 150 }],
          },
        },
      ],
    };

    const quote = await withPremiumUpgradeConfigQueriesForbidden(() => priceOrderCart(quotePayload));
    assert.strictEqual(quote.items[0].unitPriceHalala, 5700, "one-time quote uses BuilderProtein extraFeeHalala, not PremiumUpgradeConfig");
    assert.strictEqual(quote.pricing.subtotalHalala, 5700);

    await PremiumUpgradeConfig.updateOne({ premiumKey: "beef_steak" }, { $set: { upgradeDeltaHalala: 9999 } });
    const quoteAfterConfigChange = await withPremiumUpgradeConfigQueriesForbidden(() => priceOrderCart(quotePayload));
    assert.strictEqual(quoteAfterConfigChange.items[0].unitPriceHalala, 5700, "changing subscription premium delta does not change one-time quote");

    const sandwich = await MenuProduct.findOne({ key: "grilled_chicken_cold_sandwich" }).lean();
    assert(sandwich, "one-time sandwich product exists");
    const sandwichQuote = await withPremiumUpgradeConfigQueriesForbidden(() => priceMenuCart({
      userId: new mongoose.Types.ObjectId(),
      fulfillmentMethod: "pickup",
      pickup: { branchId: "main" },
      items: [{ productId: String(sandwich._id), qty: 1 }],
    }));
    assert.strictEqual(sandwichQuote.items[0].unitPriceHalala, Number(sandwich.priceHalala || 0), "normal MenuProduct pricing is unchanged");

    const customizableProduct = await MenuProduct.findOne({ key: "basic_meal" }).lean();
    const groupRelation = await ProductOptionGroup.findOne({ productId: customizableProduct._id }).lean();
    const optionRelation = await ProductGroupOption.findOne({
      productId: customizableProduct._id,
      groupId: groupRelation.groupId,
      extraPriceHalala: { $gt: 0 },
    }).lean();
    if (optionRelation) {
      const menuQuote = await withPremiumUpgradeConfigQueriesForbidden(() => priceMenuCart({
        userId: new mongoose.Types.ObjectId(),
        fulfillmentMethod: "pickup",
        pickup: { branchId: "main" },
        items: [{
          productId: String(customizableProduct._id),
          qty: 1,
          weightGrams: 100,
          selectedOptions: [{
            groupId: String(optionRelation.groupId),
            optionId: String(optionRelation.optionId),
            qty: 1,
          }],
        }],
      }));
      assert(
        menuQuote.items[0].unitPriceHalala >= Number(customizableProduct.priceHalala || 0) + Number(optionRelation.extraPriceHalala || 0),
        "normal MenuOption/ProductGroupOption pricing remains relation-owned"
      );
    }

    console.log("one-time order premium upgrade isolation checks passed");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  try { await disconnect(); } catch (_err) {}
  process.exit(1);
});
