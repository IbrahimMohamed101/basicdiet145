const mongoose = require("mongoose");
const { ensurePaymentIndexes } = require("./services/paymentIndexService");

async function connectDb() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MongoDB connection string (set MONGO_URI or MONGODB_URI)");
  }

  const connection = await mongoose.connect(uri);
  await ensurePaymentIndexes();
  return connection;
}

module.exports = { connectDb };
