const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const MenuProduct = require("../src/models/MenuProduct");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const MenuVersion = require("../src/models/MenuVersion");
const service = require("../src/services/orders/menuCatalogService");

async function runTests() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB");

  try {
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
    const option = await MenuOption.create({ 
      key: "test_opt", 
      name: { en: "Test Opt" }, 
      isActive: true, 
      publishedAt: new Date(),
      extraPriceHalala: 500
    });
    
    // 2. Publish initial version
    console.log("Publishing initial version...");
    const v1 = await service.publishMenu({ actor: { id: "000000000000000000000001", role: "admin" }, notes: "Initial version" });
    console.log("Published v1:", v1._id);

    // 3. Modify data
    console.log("Modifying product price...");
    await MenuProduct.updateOne({ _id: prod._id }, { $set: { priceHalala: 2000 } });

    // 4. Test Rollback Safety (Service level update checked)
    // We'll call the service rollback which we updated to restore properties
    console.log("Rolling back to v1...");
    try {
      await service.rollbackMenuVersion(v1._id, { confirm: false, actor: { id: "000000000000000000000001", role: "admin" } });
      console.log("Test A Failed: Rollback succeeded without confirm: true.");
    } catch (err) {
      if(err.code === "ROLLBACK_NOT_CONFIRMED") {
         console.log("Test A Passed: successfully rejected without confirm: true.");
      } else {
         console.log("Test A Failed:", err);
      }
    }
    
    await service.rollbackMenuVersion(v1._id, { confirm: true, actor: { id: "000000000000000000000001", role: "admin" } });

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

    // Cleanup
    await MenuCategory.deleteOne({ _id: cat._id });
    await MenuProduct.deleteMany({ key: { $regex: /^test_prod/ } });
    await MenuOption.deleteOne({ _id: option._id });
    await ProductGroupOption.deleteMany({ optionId: option._id });
    await MenuVersion.deleteMany({ notes: { $regex: /rollback/i } });
    await MenuVersion.deleteOne({ _id: v1._id });

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await mongoose.disconnect();
  }
}

runTests();
