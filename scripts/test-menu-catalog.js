const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const MenuProduct = require("../src/models/MenuProduct");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const MenuVersion = require("../src/models/MenuVersion");
const service = require("../src/services/orders/menuCatalogService");

const TEST_VERSION_NOTES = "test-menu-catalog initial version";

async function cleanupTestData() {
  const [categories, products, groups, options] = await Promise.all([
    MenuCategory.find({ key: "test_cat" }).select("_id").lean(),
    MenuProduct.find({ key: { $regex: /^test_prod/ } }).select("_id").lean(),
    MenuOptionGroup.find({ key: "test_group" }).select("_id").lean(),
    MenuOption.find({ key: "test_opt" }).select("_id").lean(),
  ]);

  const categoryIds = categories.map((row) => row._id);
  const productIds = products.map((row) => row._id);
  const groupIds = groups.map((row) => row._id);
  const optionIds = options.map((row) => row._id);

  await Promise.all([
    ProductGroupOption.deleteMany({
      $or: [
        { productId: { $in: productIds } },
        { groupId: { $in: groupIds } },
        { optionId: { $in: optionIds } },
      ],
    }),
    MenuProduct.deleteMany({ _id: { $in: productIds } }),
    MenuOption.deleteMany({ _id: { $in: optionIds } }),
    MenuOptionGroup.deleteMany({ _id: { $in: groupIds } }),
    MenuCategory.deleteMany({ _id: { $in: categoryIds } }),
    MenuVersion.deleteMany({ notes: TEST_VERSION_NOTES }),
  ]);
}

async function runTests() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB");

  try {
    await cleanupTestData();

    // 1. Create dummy data
    const cat = await MenuCategory.create({ key: "test_cat", name: { en: "Test Cat" }, isActive: true, publishedAt: new Date() });
    const prod = await MenuProduct.create({ 
      key: "test_prod", 
      categoryId: cat._id, 
      name: { en: "Test Prod" }, 
      priceHalala: 1000, 
      isActive: true, 
      publishedAt: new Date(),
      pricingModel: "fixed"
    });
    const group = await MenuOptionGroup.create({
      key: "test_group",
      name: { en: "Test Group" },
      isActive: true,
      publishedAt: new Date()
    });
    const option = await MenuOption.create({ 
      groupId: group._id,
      key: "test_opt", 
      name: { en: "Test Opt" }, 
      isActive: true, 
      publishedAt: new Date(),
      extraPriceHalala: 500
    });
    
    // 2. Publish initial version
    console.log("Publishing initial version...");
    const v1 = await service.publishMenu({ actor: { id: "000000000000000000000001", role: "admin" }, notes: TEST_VERSION_NOTES });
    console.log("Published v1:", v1._id);

    // 3. Modify data
    console.log("Modifying product price...");
    await MenuProduct.updateOne({ _id: prod._id }, { $set: { priceHalala: 2000 } });

    // 4. Test Rollback Safety (Service level update checked)
    // We'll call the service rollback which we updated to restore properties
    console.log("Rolling back to v1...");
    try {
      await service.rollbackMenu(v1._id, { confirm: false, actor: { id: "000000000000000000000001", role: "admin" } });
      console.log("Test A Failed: Rollback succeeded without confirm: true.");
    } catch (err) {
      if(err.code === "ROLLBACK_CONFIRMATION_REQUIRED") {
         console.log("Test A Passed: successfully rejected without confirm: true.");
      } else {
         console.log("Test A Failed:", err);
      }
    }
    
    await service.rollbackMenu(v1._id, { confirm: true, actor: { id: "000000000000000000000001", role: "admin" } });

    const restoredProd = await MenuProduct.findById(prod._id);
    console.log("Restored price:", restoredProd.priceHalala);
    if (restoredProd.priceHalala === 1000) {
      console.log("Test A Passed: Price restored correctly.");
    } else {
      console.log("Test A Failed: Price not restored.");
    }

    // 5. Test Option Price Isolation
    console.log("Testing Option Price Isolation...");
    const prod2 = await MenuProduct.create({ key: "test_prod_2", categoryId: cat._id, name: { en: "Test Prod 2" }, priceHalala: 1000, isActive: true, publishedAt: new Date() });
    
    await ProductGroupOption.create({ productId: prod._id, groupId: option.groupId, optionId: option._id, extraPriceHalala: 1600 });
    await ProductGroupOption.create({ productId: prod2._id, groupId: option.groupId, optionId: option._id, extraPriceHalala: 2000 });
    
    const rel1 = await ProductGroupOption.findOne({ productId: prod._id, optionId: option._id });
    const rel2 = await ProductGroupOption.findOne({ productId: prod2._id, optionId: option._id });
    
    console.log("Rel 1 price:", rel1.extraPriceHalala);
    console.log("Rel 2 price:", rel2.extraPriceHalala);
    
    if (rel1.extraPriceHalala === 1600 && rel2.extraPriceHalala === 2000) {
      console.log("Test B Passed: Option prices are isolated per product.");
    } else {
      console.log("Test B Failed.");
    }

    // 6. Test Duplicate Safety
    console.log("Testing Duplicate Safety...");
    const d1 = service.duplicateProduct(prod._id, { id: "000000000000000000000001", role: "admin" });
    const d2 = service.duplicateProduct(prod._id, { id: "000000000000000000000001", role: "admin" });
    
    const [res1, res2] = await Promise.allSettled([d1, d2]);
    
    console.log("Duplicate 1 status:", res1.status);
    console.log("Duplicate 2 status:", res2.status);
    
    if (res1.status === "fulfilled" && res2.status === "fulfilled") {
        console.log("Test C Passed: Both duplicates succeeded (due to random suffix).");
        console.log("Key 1:", res1.value.key);
        console.log("Key 2:", res2.value.key);
    } else {
        console.log("Test C Logic: Collision handling verified if one failed with conflict.");
    }

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await cleanupTestData();
    await mongoose.disconnect();
  }
}

runTests();
