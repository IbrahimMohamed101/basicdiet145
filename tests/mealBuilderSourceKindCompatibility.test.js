process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  canonicalSourceKind,
  normalizeMealBuilderDraftArgs,
  normalizeMealBuilderSectionArgs,
  normalizeMealBuilderSectionSourceKind,
} = require("../src/services/subscription/mealBuilderSourceKindCompatibility");

function testKnownAliasesNormalizeToStoredCanonicalKinds() {
  const cases = [
    ["option_group", "visual_family"],
    ["option_family", "visual_family"],
    ["visual_option_family", "visual_family"],
    ["protein_family", "visual_family"],
    ["carbs_family", "visual_family"],
    ["product_category", "product_list"],
    ["direct_product", "product_list"],
    ["direct_products", "product_list"],
    ["menu_product", "product_list"],
    ["menu_products", "product_list"],
    ["standalone_product", "product_list"],
    ["full_meal_product", "product_list"],
    ["premium_mixed", "premium_visual"],
    ["premium", "premium_visual"],
    ["premium_section", "premium_visual"],
    ["configurable", "configurable_product"],
    ["configurable_meal", "configurable_product"],
    ["product_option_group", "configurable_product"],
  ];

  for (const [input, expected] of cases) {
    assert.strictEqual(canonicalSourceKind(input), expected, input);
  }
}

function testCanonicalKindsRemainUnchanged() {
  for (const kind of [
    "",
    "visual_family",
    "configurable_product",
    "product_list",
    "premium_visual",
  ]) {
    assert.strictEqual(canonicalSourceKind(kind), kind);
  }
}

function testNestedAndTopLevelDashboardShapesNormalize() {
  const topLevel = normalizeMealBuilderSectionSourceKind({
    key: "chicken",
    sectionType: "option_group",
    sourceKind: "option_group",
  });
  assert.strictEqual(topLevel.sourceKind, "visual_family");

  const nested = normalizeMealBuilderSectionSourceKind({
    key: "carbs",
    sectionType: "option_group",
    source: { kind: "option_family", groupKey: "carbs" },
  });
  assert.strictEqual(nested.sourceKind, "visual_family");
  assert.deepStrictEqual(nested.source, {
    kind: "option_family",
    groupKey: "carbs",
  });

  const product = normalizeMealBuilderSectionSourceKind({
    key: "sandwiches",
    sectionType: "product_list",
    sourceKind: "direct_product",
  });
  assert.strictEqual(product.sourceKind, "product_list");
}

function testUnknownValuesStillFailClosedDownstream() {
  assert.strictEqual(canonicalSourceKind("custom_source"), "custom_source");
  const result = normalizeMealBuilderSectionSourceKind({
    sourceKind: "custom_source",
  });
  assert.strictEqual(result.sourceKind, "custom_source");
}

function testWholeDraftIsClonedAndEverySectionIsNormalized() {
  const args = {
    notes: "dashboard save",
    sections: [
      {
        key: "chicken",
        sectionType: "option_group",
        sourceKind: "option_group",
        selectedOptionIds: ["507f1f77bcf86cd799439011"],
      },
      {
        key: "sandwiches",
        sectionType: "product_list",
        sourceKind: "direct_product",
        selectedProductIds: ["507f1f77bcf86cd799439012"],
      },
      {
        key: "carbs",
        sectionType: "option_group",
        sourceKind: "visual_family",
        selectedOptionIds: ["507f1f77bcf86cd799439013"],
      },
    ],
  };

  const result = normalizeMealBuilderDraftArgs(args);

  assert.notStrictEqual(result, args);
  assert.notStrictEqual(result.sections, args.sections);
  assert.strictEqual(result.sections[0].sourceKind, "visual_family");
  assert.strictEqual(result.sections[1].sourceKind, "product_list");
  assert.strictEqual(result.sections[2].sourceKind, "visual_family");
  assert.strictEqual(args.sections[0].sourceKind, "option_group");
  assert.strictEqual(args.sections[1].sourceKind, "direct_product");
}

function testCardCreateAndPatchArgumentsNormalize() {
  const createArgs = normalizeMealBuilderSectionArgs({
    actor: { userId: "admin" },
    section: {
      key: "eggs",
      sectionType: "option_group",
      sourceKind: "option_group",
    },
  });
  assert.strictEqual(createArgs.section.sourceKind, "visual_family");

  const patchArgs = normalizeMealBuilderSectionArgs(
    {
      sectionKey: "sandwiches",
      patch: { sourceKind: "product_category" },
    },
    "patch"
  );
  assert.strictEqual(patchArgs.patch.sourceKind, "product_list");
}

function run() {
  testKnownAliasesNormalizeToStoredCanonicalKinds();
  testCanonicalKindsRemainUnchanged();
  testNestedAndTopLevelDashboardShapesNormalize();
  testUnknownValuesStillFailClosedDownstream();
  testWholeDraftIsClonedAndEverySectionIsNormalized();
  testCardCreateAndPatchArgumentsNormalize();
  console.log("meal builder sourceKind compatibility checks passed");
}

run();
require("./mealBuilderSourceKindWriteBoundary.test");
