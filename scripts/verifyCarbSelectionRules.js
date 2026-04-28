const mongoose = require("mongoose");
const { validateCarbSelections } = require("../src/utils/subscription/carbSelectionValidator");

console.log("Running Carb Selection Rules Verification...\n");

const CARB_MAP = new Map([
  ["5f8d04f3b54764421b7156c0", { _id: "5f8d04f3b54764421b7156c0", isActive: true }],
  ["5f8d04f3b54764421b7156c1", { _id: "5f8d04f3b54764421b7156c1", isActive: true }],
  ["5f8d04f3b54764421b7156c2", { _id: "5f8d04f3b54764421b7156c2", isActive: true }],
  ["5f8d04f3b54764421b7156c3", { _id: "5f8d04f3b54764421b7156c3", isActive: false }],
]);

const RULES = { maxTypes: 2, maxTotalGrams: 300, unit: "grams" };

let passed = 0;
let failed = 0;

function runTest(name, selections, expectedValid, expectedErrorCode = null) {
  const result = validateCarbSelections(selections, CARB_MAP, RULES);
  
  const isMatch = result.valid === expectedValid && (!expectedErrorCode || result.errorCode === expectedErrorCode);
  
  if (isMatch) {
    passed++;
    console.log(`✅ [PASS] ${name}`);
  } else {
    failed++;
    console.log(`❌ [FAIL] ${name}`);
    console.log(`   Expected valid=${expectedValid}, code=${expectedErrorCode}`);
    console.log(`   Got valid=${result.valid}, code=${result.errorCode}, msg=${result.errorMessage}`);
  }
}

console.log("--- Test Cases ---");

// 1. 1 carb with 300g → valid
runTest("1 carb 300g", [{ carbId: "5f8d04f3b54764421b7156c0", grams: 300 }], true);

// 2. 1 carb with 301g → invalid
runTest("1 carb 301g", [{ carbId: "5f8d04f3b54764421b7156c0", grams: 301 }], false, "CARB_GRAMS_EXCEEDED");

// 3. 2 carbs 100g + 200g → valid
runTest("2 carbs 100g + 200g", [
  { carbId: "5f8d04f3b54764421b7156c0", grams: 100 },
  { carbId: "5f8d04f3b54764421b7156c1", grams: 200 }
], true);

// 4. 2 carbs 150g + 150g → valid
runTest("2 carbs 150g + 150g", [
  { carbId: "5f8d04f3b54764421b7156c0", grams: 150 },
  { carbId: "5f8d04f3b54764421b7156c1", grams: 150 }
], true);

// 5. 2 carbs 200g + 200g → invalid
runTest("2 carbs 200g + 200g (total 400g)", [
  { carbId: "5f8d04f3b54764421b7156c0", grams: 200 },
  { carbId: "5f8d04f3b54764421b7156c1", grams: 200 }
], false, "CARB_GRAMS_EXCEEDED");

// 6. 3 carbs 100g each → invalid
runTest("3 carbs (max 2)", [
  { carbId: "5f8d04f3b54764421b7156c0", grams: 100 },
  { carbId: "5f8d04f3b54764421b7156c1", grams: 100 },
  { carbId: "5f8d04f3b54764421b7156c2", grams: 100 }
], false, "CARB_TYPES_EXCEEDED");

// 7. Duplicate same carb twice → invalid
runTest("Duplicate carbId", [
  { carbId: "5f8d04f3b54764421b7156c0", grams: 100 },
  { carbId: "5f8d04f3b54764421b7156c0", grams: 100 }
], false, "DUPLICATE_CARB_SELECTION");

// 8. Grams = 0 → invalid
runTest("Grams = 0", [{ carbId: "5f8d04f3b54764421b7156c0", grams: 0 }], false, "INVALID_CARB_GRAMS");

// 9. Grams negative → invalid
runTest("Grams negative", [{ carbId: "5f8d04f3b54764421b7156c0", grams: -50 }], false, "INVALID_CARB_GRAMS");

// 10. Unknown carbId → invalid
runTest("Unknown carbId", [{ carbId: "5f8d04f3b54764421b7156c9", grams: 100 }], false, "UNKNOWN_CARB_ID");

// 11. Inactive carbId → invalid
runTest("Inactive carbId", [{ carbId: "5f8d04f3b54764421b7156c3", grams: 100 }], false, "INACTIVE_CARB_ID");

// 12. Old single carbId payload testing behavior.
// We test how the validateCarbSelections handles undefined. It returns valid: true, selections: []
// Then the wrapper in planner creates [{carbId, 300}] if undefined and handles it. We can test wrapper output here or just the function directly.
runTest("Empty selections", undefined, true);

console.log("\n--- Results ---");
if (failed === 0) {
  console.log(`🎉 All ${passed} tests passed!`);
  process.exit(0);
} else {
  console.log(`⚠️ ${passed} passed, ${failed} failed.`);
  process.exit(1);
}
