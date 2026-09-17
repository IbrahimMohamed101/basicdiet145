process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const {
  createIndependentEmptyDraft,
  isLegacySeedDependencyError,
} = require("../src/services/installIndependentMealBuilderAuthoring");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`independent_meal_builder_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function run() {
  await connect();
  try {
    assert.strictEqual(
      isLegacySeedDependencyError({ code: "MEAL_BUILDER_DEFAULT_SEED_INCOMPLETE" }),
      true
    );
    assert.strictEqual(isLegacySeedDependencyError({ code: "OTHER" }), false);

    const created = await createIndependentEmptyDraft({
      notes: "clean catalog authoring",
    });

    assert.strictEqual(created.status, "draft");
    assert.deepStrictEqual(created.sections, []);
    assert.strictEqual(created.isCurrent, true);
    assert.strictEqual(created.bootstrapKey, "independent_dashboard_authoring_v1");

    const reused = await createIndependentEmptyDraft({ notes: "ignored" });
    assert.strictEqual(reused.id, created.id);
    assert.strictEqual(await MealBuilderConfig.countDocuments({ status: "draft", isCurrent: true }), 1);

    console.log("dashboard Meal Builder independent authoring passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
