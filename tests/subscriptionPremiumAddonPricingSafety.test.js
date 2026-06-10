process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const {
  validateCanonicalMealSlots,
} = require("../src/services/subscription/canonicalMealSlotPlannerService");
const {
  countCompleteMealSlots,
} = require("../src/services/subscription/subscriptionPlanningBalanceService");
const {
  reconcileAddonInclusions,
} = require("../src/services/subscription/subscriptionSelectionService");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`subscription_phase2_pricing_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function seedSaladCatalog() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "salads",
    name: { en: "Salads", ar: "Salads" },
    publishedAt: now,
  });
  const [proteinGroup, sauceGroup] = await Promise.all([
    MenuOptionGroup.create({ key: "proteins", name: { en: "Proteins", ar: "Proteins" }, publishedAt: now }),
    MenuOptionGroup.create({ key: "sauce", name: { en: "Sauce", ar: "Sauce" }, publishedAt: now }),
  ]);
  const [premiumSalad, basicSalad] = await Promise.all([
    MenuProduct.create({
      categoryId: category._id,
      key: "premium_large_salad",
      itemType: "premium_large_salad",
      name: { en: "Premium Large Salad", ar: "Premium Large Salad" },
      priceHalala: 3100,
      availableFor: ["subscription"],
      publishedAt: now,
    }),
    MenuProduct.create({
      categoryId: category._id,
      key: "basic_salad",
      itemType: "basic_salad",
      name: { en: "Basic Salad", ar: "Basic Salad" },
      priceHalala: 1,
      availableFor: ["subscription"],
      publishedAt: now,
    }),
  ]);
  const [protein, sauce] = await Promise.all([
    MenuOption.create({
      groupId: proteinGroup._id,
      key: "grilled_chicken",
      name: { en: "Grilled Chicken", ar: "Grilled Chicken" },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      availableFor: ["subscription"],
      publishedAt: now,
    }),
    MenuOption.create({
      groupId: sauceGroup._id,
      key: "ranch",
      name: { en: "Ranch", ar: "Ranch" },
      availableFor: ["subscription"],
      publishedAt: now,
    }),
  ]);

  for (const product of [premiumSalad, basicSalad]) {
    await ProductOptionGroup.create({ productId: product._id, groupId: proteinGroup._id, minSelections: 1, maxSelections: 1, isRequired: true });
    await ProductOptionGroup.create({ productId: product._id, groupId: sauceGroup._id, minSelections: 1, maxSelections: 1, isRequired: true });
    await ProductGroupOption.create({ productId: product._id, groupId: proteinGroup._id, optionId: protein._id });
    await ProductGroupOption.create({ productId: product._id, groupId: sauceGroup._id, optionId: sauce._id });
  }

  return { premiumSalad, basicSalad, proteinGroup, sauceGroup, protein, sauce };
}

function premiumSaladSlot(fixture, product, extraFields = {}) {
  return {
    slotIndex: 1,
    selectionType: "premium_large_salad",
    productId: String(product._id),
    price: 0,
    amountHalala: 0,
    premiumExtraFeeHalala: 0,
    unitPrice: 0,
    discount: 999999,
    total: 0,
    selectedOptions: [
      {
        groupId: String(fixture.proteinGroup._id),
        groupKey: "proteins",
        optionId: String(fixture.protein._id),
        optionKey: "grilled_chicken",
        quantity: 1,
        unitPrice: 0,
        amountHalala: 0,
      },
      {
        groupId: String(fixture.sauceGroup._id),
        groupKey: "sauce",
        optionId: String(fixture.sauce._id),
        optionKey: "ranch",
        quantity: 1,
        unitPrice: 0,
        amountHalala: 0,
      },
    ],
    ...extraFields,
  };
}

async function main() {
  await connect();
  try {
    const fixture = await seedSaladCatalog();

    const premiumResult = await validateCanonicalMealSlots({
      mealSlots: [premiumSaladSlot(fixture, fixture.premiumSalad)],
      mealsPerDayLimit: 1,
      subscription: { premiumBalance: [] },
    });
    assert.strictEqual(premiumResult.valid, true, JSON.stringify(premiumResult));
    assert.strictEqual(premiumResult.processedSlots[0].premiumKey, "premium_large_salad");
    assert.strictEqual(premiumResult.processedSlots[0].premiumExtraFeeHalala, 3100);
    assert.strictEqual(premiumResult.plannerMeta.completeSlotCount, 1);
    assert.strictEqual(premiumResult.plannerMeta.premiumSlotCount, 1);
    assert.strictEqual(countCompleteMealSlots(premiumResult.processedSlots), 1);

    const basicResult = await validateCanonicalMealSlots({
      mealSlots: [premiumSaladSlot(fixture, fixture.basicSalad)],
      mealsPerDayLimit: 1,
      subscription: { premiumBalance: [] },
    });
    assert.strictEqual(basicResult.valid, false, JSON.stringify(basicResult));
    assert.strictEqual(basicResult.errorCode, "PLANNER_PRODUCT_UNAVAILABLE");

    const addonDoc = {
      _id: new mongoose.Types.ObjectId(),
      name: { en: "Juice", ar: "Juice" },
      price: 0,
      priceHalala: 1800,
      currency: "SAR",
    };
    const addonContainer = { addonSelections: [] };
    await reconcileAddonInclusions(
      { addonSubscriptions: [] },
      addonContainer,
      [String(addonDoc._id)],
      {
        resolveChoiceProductById: async () => ({
          product: addonDoc,
          addonCategory: "juice",
        }),
      }
    );
    assert.strictEqual(addonContainer.addonSelections.length, 1);
    assert.strictEqual(addonContainer.addonSelections[0].source, "pending_payment");
    assert.strictEqual(addonContainer.addonSelections[0].priceHalala, 1800);
    assert.strictEqual(countCompleteMealSlots([{ status: "complete" }]), 1);

    console.log("subscription premium/add-on pricing safety checks passed");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await disconnect(); } catch (_err) {}
  process.exit(1);
});
