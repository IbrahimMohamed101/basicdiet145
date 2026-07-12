require("dotenv").config();
const mongoose = require("mongoose");
const MenuProduct = require("../src/models/MenuProduct");
const Addon = require("../src/models/Addon");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  console.log("=== ADDON PLANS ===");
  const addons = await Addon.find({ kind: "plan" }).lean();
  for (const addon of addons) {
    console.log(`Plan: ${addon.name.en} (${addon.category})`);
    console.log(`menuProductIds:`, addon.menuProductIds);
    // Find products linked to this addon plan
    const products = await MenuProduct.find({ _id: { $in: addon.menuProductIds } }).lean();
    console.log(`Products in DB for this plan:`, products.map(p => `${p.key} (availableFor: ${JSON.stringify(p.availableFor)}, isActive: ${p.isActive})`));
    console.log("------------------------");
  }

  console.log("\n=== ALL SUBSCRIPTION PRODUCTS IN DB ===");
  const subscriptionProds = await MenuProduct.find({ availableFor: { $in: ["subscription"] } }).lean();
  for (const p of subscriptionProds) {
    console.log(`Product: ${p.key} | CategoryId: ${p.categoryId} | availableFor: ${JSON.stringify(p.availableFor)} | isActive: ${p.isActive}`);
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
