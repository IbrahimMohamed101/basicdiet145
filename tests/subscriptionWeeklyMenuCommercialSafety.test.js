"use strict";

// Regression for newly added subscription-only menu choices. These fields do
// NOT certify restaurant approval of add-on pricing or nutritional values.
process.env.NODE_ENV = "test";
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const MenuOption = require("../src/models/MenuOption");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const { serializePublicOption } = require("../src/services/orders/menuCatalogPresenter");
const { applyGramRules } = require("../src/services/installFlutterMealPlannerCatalogExpansion");
const manifest = require("../scripts/fixtures/subscription-weekly-menu-2026-10-16.json");

const newRows = Object.values(manifest.sections)
  .flat()
  .filter((row) => row.action === "created_subscription_only");

async function main() {
  assert.equal(newRows.length, 4, "Exactly four choices were added for subscriptions");
  const mongo = await MongoMemoryServer.create({
    instance: { dbName: "weekly_menu_commercial_contract_test" },
  });
  try {
    await mongoose.connect(mongo.getUri(), { autoIndex: false });
    const proteinId = new mongoose.Types.ObjectId();
    const carbsId = new mongoose.Types.ObjectId();
    const basicMealId = new mongoose.Types.ObjectId();
    for (const row of newRows) {
      const isRice = row.proposedKey === "chinese_rice";
      const groupId = isRice ? carbsId : proteinId;
      const option = await MenuOption.create({
        groupId,
        key: row.proposedKey,
        name: row.name,
        availableFor: ["subscription"],
        availableForSubscription: true,
        nutritionDataStatus: "unknown",
        nutrition: {
          calories: null,
          proteinGrams: null,
          carbGrams: null,
          fatGrams: null,
        },
        extraPriceHalala: 0,
        extraWeightUnitGrams: 0,
        extraWeightPriceHalala: 0,
        extraFeeHalala: 0,
        isActive: true,
        isVisible: true,
        isAvailable: true,
      });
      const relation = await ProductGroupOption.create({
        productId: basicMealId,
        groupId,
        optionId: option._id,
        extraPriceHalala: null,
        extraWeightUnitGrams: null,
        extraWeightPriceHalala: null,
      });
      const stored = await MenuOption.findById(option._id).lean();
      const storedRelation = await ProductGroupOption.findById(relation._id).lean();
      assert.deepEqual(stored.availableFor, ["subscription"],
        `${row.proposedKey} must not become a one-time product`);
      assert.equal(stored.nutritionDataStatus, "unknown");
      for (const nutrient of ["calories", "proteinGrams", "carbGrams", "fatGrams"]) {
        assert.equal(stored.nutrition[nutrient], null,
          `${row.proposedKey} must not invent ${nutrient}`);
      }
      assert.equal(stored.extraPriceHalala, 0, "No unapproved separate extra fee");
      assert.equal(stored.extraWeightUnitGrams, 0,
        "No option-specific weight upgrade without confirmed business data");
      assert.equal(stored.extraWeightPriceHalala, 0,
        "No invented option-specific gram surcharge");
      assert.equal(storedRelation.extraPriceHalala, null,
        "Relation defers to the option/default group pricing policy");
      assert.equal(storedRelation.extraWeightUnitGrams, null);
      assert.equal(storedRelation.extraWeightPriceHalala, null);
      const serialized = serializePublicOption(storedRelation, stored, "en");
      assert.equal(serialized.extraPriceHalala, 0);
      assert.equal(serialized.extraWeightUnitGrams, 0);
      assert.equal(serialized.extraWeightPriceHalala, 0);
    }
    const publishedRules = applyGramRules({ rules: {} }).rules;
    assert.equal(publishedRules.standardCarbs.maxTypes, 2);
    assert.equal(publishedRules.standardCarbs.maxTotalGrams, 300);
    assert.equal(publishedRules.carbGramStep, 50);
    console.log("subscription-only commercial and gram contract checks passed");
    console.log("NOTE: Unknown nutrients and restaurant-approved optional upgrades remain unverified business inputs.");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
