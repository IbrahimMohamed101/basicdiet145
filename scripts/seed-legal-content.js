#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const { connectDb } = require("../src/db");
const { seedDefaultSubscriptionTerms } = require("../src/services/appContentService");

async function main() {
  await connectDb();
  const overwrite = process.argv.includes("--overwrite");
  const result = await seedDefaultSubscriptionTerms({ overwrite });

  console.log(JSON.stringify({
    success: true,
    overwrite,
    created: result.created,
    data: result.data,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
