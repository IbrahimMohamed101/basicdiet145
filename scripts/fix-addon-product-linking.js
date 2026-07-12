require("dotenv").config();
const mongoose = require("mongoose");
const MenuProduct = require("../src/models/MenuProduct");
const Addon = require("../src/models/Addon");

async function run() {
  console.log("Connecting to database...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to:", mongoose.connection.name);

  // 1. Update availableFor for all juices
  console.log("Updating juices availableFor...");
  const juiceResult = await MenuProduct.updateMany(
    { itemType: "juice" },
    { $addToSet: { availableFor: "subscription" } }
  );
  console.log(`Updated ${juiceResult.modifiedCount} juices.`);

  // 2. Update availableFor for all desserts/snacks
  console.log("Updating desserts availableFor...");
  const dessertResult = await MenuProduct.updateMany(
    { itemType: "dessert" },
    { $addToSet: { availableFor: "subscription" } }
  );
  console.log(`Updated ${dessertResult.modifiedCount} desserts.`);

  // 3. Fetch the updated lists of products
  const juices = await MenuProduct.find({ itemType: "juice", isActive: true }).lean();
  const snacks = await MenuProduct.find({ itemType: "dessert", isActive: true }).lean();
  const salads = await MenuProduct.find({
    key: { $in: ["greek_salad", "fruit_salad_addon", "vegetable_salad"] },
    isActive: true
  }).lean();

  const juiceIds = juices.map(j => j._id);
  const snackIds = snacks.map(s => s._id);
  const saladIds = salads.map(s => s._id);

  console.log(`Found ${juiceIds.length} active juices.`);
  console.log(`Found ${snackIds.length} active snacks.`);
  console.log(`Found ${saladIds.length} active salads.`);

  // 4. Update the Addon plans
  console.log("Updating Juice Subscription Addon Plan...");
  const juiceAddon = await Addon.findOneAndUpdate(
    { kind: "plan", category: "juice" },
    { $set: { menuProductIds: juiceIds } },
    { new: true }
  );
  if (juiceAddon) {
    console.log(`Juice Subscription updated. Connected products count: ${juiceAddon.menuProductIds.length}`);
  } else {
    console.log("Juice Subscription addon plan not found in database.");
  }

  console.log("Updating Snack Subscription Addon Plan...");
  const snackAddon = await Addon.findOneAndUpdate(
    { kind: "plan", category: "snack" },
    { $set: { menuProductIds: snackIds } },
    { new: true }
  );
  if (snackAddon) {
    console.log(`Snack Subscription updated. Connected products count: ${snackAddon.menuProductIds.length}`);
  } else {
    console.log("Snack Subscription addon plan not found in database.");
  }

  console.log("Updating Small Salad Subscription Addon Plan...");
  const saladAddon = await Addon.findOneAndUpdate(
    { kind: "plan", category: "small_salad" },
    { $set: { menuProductIds: saladIds } },
    { new: true }
  );
  if (saladAddon) {
    console.log(`Small Salad Subscription updated. Connected products count: ${saladAddon.menuProductIds.length}`);
  } else {
    console.log("Small Salad Subscription addon plan not found in database.");
  }

  console.log("Migration complete!");
  process.exit(0);
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
