require("dotenv").config();
const mongoose = require("mongoose");
const Subscription = require("./src/models/Subscription");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const sub = await Subscription.findOne({ "addonBalance.0": { $exists: true } }).lean();
  console.log(JSON.stringify(sub ? sub.addonSubscriptions : null, null, 2));
  process.exit(0);
}
run().catch(console.error);
