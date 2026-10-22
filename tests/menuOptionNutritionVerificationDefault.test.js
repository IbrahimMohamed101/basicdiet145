const assert = require("assert");
const mongoose = require("mongoose");
const MenuOption = require("../src/models/MenuOption");

// No database connection is required: schema defaults must not claim approval.
const groupId = new mongoose.Types.ObjectId();
const option = new MenuOption({
  groupId,
  key: "ranch",
  name: { ar: "رانش", en: "Ranch" },
});

assert.strictEqual(option.nutritionDataStatus, "unknown");
assert.strictEqual(option.nutrition.calories, 0, "legacy zero numeric defaults remain unchanged");
assert.strictEqual(option.nutrition.proteinGrams, 0);

// Explicitly reviewed content remains representable and is not downgraded.
const reviewed = new MenuOption({
  groupId,
  key: "verified-ranch",
  nutritionDataStatus: "verified",
  nutrition: { calories: 35, proteinGrams: 1, carbGrams: 2, fatGrams: 2 },
});
assert.strictEqual(reviewed.nutritionDataStatus, "verified");
assert.strictEqual(reviewed.nutrition.calories, 35);

console.log("menuOptionNutritionVerificationDefault: passed");
