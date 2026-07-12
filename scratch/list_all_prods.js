require("dotenv").config();
const mongoose = require("mongoose");
const MenuProduct = require("../src/models/MenuProduct");
const MenuCategory = require("../src/models/MenuCategory");

async function run() {
  console.log("Connecting to:", process.env.MONGO_URI);
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected!");

  const categories = await MenuCategory.find().lean();
  console.log("=== CATEGORIES ===");
  for (const c of categories) {
    console.log(`Category: ${c.key} | ID: ${c._id} | Name: ${JSON.stringify(c.name)}`);
  }

  const allProds = await MenuProduct.find().lean();
  console.log("\n=== ALL PRODUCTS ===");
  for (const p of allProds) {
    console.log(`Product: ${p.key} | ID: ${p._id} | CategoryId: ${p.categoryId} | availableFor: ${JSON.stringify(p.availableFor)} | isActive: ${p.isActive}`);
  }

  process.exit(0);
}

run().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
