require("dotenv").config();

const mongoose = require("mongoose");
const { connectDb } = require("../src/db");

async function main() {
  await connectDb();
  const indexes = await mongoose.connection.db.collection("payments").indexes();
  const relevantIndexes = indexes
    .filter((index) => index.name === "provider_1_providerInvoiceId_1" || index.name === "provider_1_providerPaymentId_1")
    .map((index) => ({
      name: index.name,
      unique: Boolean(index.unique),
      partialFilterExpression: index.partialFilterExpression || null,
    }));

  console.log(JSON.stringify({ ok: true, indexes: relevantIndexes }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
