process.env.NODE_ENV = "test";

const assert = require("assert");
const mealBuilderConfigService = require("../src/services/subscription/mealBuilderConfigService");

const observed = {};
const originalUpdateDraft = mealBuilderConfigService.updateDraft;

mealBuilderConfigService.updateDraft = async (args = {}) => {
  observed.updateArgs = args;
  return {
    id: "draft-test",
    status: "draft",
    sections: args.sections || [],
  };
};

const installer = require("../src/services/installMealBuilderSourceKindCompatibility");

const PRODUCT_ID = "507f1f77bcf86cd799439011";
const CONTEXT_ID = "507f1f77bcf86cd799439012";
const GROUP_ID = "507f1f77bcf86cd799439013";
const OPTION_ID = "507f1f77bcf86cd799439014";

function directSection(sourceKind) {
  return {
    key: "direct_card",
    sectionType: "product_list",
    sourceKind,
    selectedProductIds: [PRODUCT_ID],
    selectedOptionIds: [],
    includeMode: "selected",
    selectionType: "full_meal_product",
  };
}

function optionSection(sourceKind) {
  return {
    key: "protein_card",
    sectionType: "option_group",
    sourceKind,
    productContextId: CONTEXT_ID,
    sourceGroupId: GROUP_ID,
    selectedProductIds: [],
    selectedOptionIds: [OPTION_ID],
    includeMode: "selected",
    selectionType: "standard_meal",
  };
}

async function testUpdateBoundaryNormalizesWholeMixedDraft() {
  const response = await mealBuilderConfigService.updateDraft({
    sections: [
      directSection("direct_product"),
      optionSection("option_family"),
    ],
  });

  assert.strictEqual(observed.updateArgs.sections[0].sourceKind, "product_list");
  assert.strictEqual(observed.updateArgs.sections[1].sourceKind, "visual_family");
  assert.strictEqual(response.sections[0].sourceKind, "product_list");
  assert.strictEqual(response.sections[1].sourceKind, "visual_family");
}

function testNestedAndResponseNormalization() {
  const args = installer.normalizeDraftArgs({
    sections: [{
      ...directSection(""),
      source: { kind: "menu_product" },
    }],
  });
  assert.strictEqual(args.sections[0].sourceKind, "product_list");

  const lifecycle = installer.normalizeLifecycle({
    draft: { sections: [directSection("full_meal_product")] },
    published: { sections: [optionSection("protein_family")] },
  });
  assert.strictEqual(lifecycle.draft.sections[0].sourceKind, "product_list");
  assert.strictEqual(lifecycle.published.sections[0].sourceKind, "visual_family");
}

async function run() {
  try {
    await testUpdateBoundaryNormalizesWholeMixedDraft();
    testNestedAndResponseNormalization();
    console.log("meal builder sourceKind write boundary checks passed");
  } finally {
    mealBuilderConfigService.updateDraft = originalUpdateDraft;
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
