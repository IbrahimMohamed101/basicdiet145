process.env.NODE_ENV = "test";

const assert = require("assert");

const { MEAL_SELECTION_TYPES } = require("../src/config/mealPlannerContract");
const mealBuilderConfigService = require("../src/services/subscription/mealBuilderConfigService");
const canonicalPlannerService = require("../src/services/subscription/canonicalMealSlotPlannerService");
const {
  compatibleMembershipSelectionTypes,
  suppressCascadingMinimumErrors,
} = require("../src/services/installPremiumMealBaseBuilderInheritance");

function membershipScope({ products = [], groups = [], options = [] } = {}) {
  return {
    products: new Set(products),
    groups: new Set(groups),
    options: new Set(options),
  };
}

function run() {
  const productId = "product_1";
  const proteinGroupId = "group_proteins";
  const baseSideGroupId = "group_dynamic_side";
  const premiumOptionId = "option_premium";
  const baseSideOptionId = "option_dynamic_side";

  const membership = {
    bySelectionType: new Map([
      [
        MEAL_SELECTION_TYPES.STANDARD_MEAL,
        membershipScope({
          products: [productId],
          groups: [`${productId}:${baseSideGroupId}`],
          options: [`${productId}:${baseSideGroupId}:${baseSideOptionId}`],
        }),
      ],
      [
        MEAL_SELECTION_TYPES.PREMIUM_MEAL,
        membershipScope({
          products: [productId],
          groups: [`${productId}:${proteinGroupId}`],
          options: [`${productId}:${proteinGroupId}:${premiumOptionId}`],
        }),
      ],
    ]),
  };

  assert.deepStrictEqual(
    compatibleMembershipSelectionTypes(MEAL_SELECTION_TYPES.PREMIUM_MEAL),
    [MEAL_SELECTION_TYPES.PREMIUM_MEAL, MEAL_SELECTION_TYPES.STANDARD_MEAL]
  );
  assert.deepStrictEqual(
    compatibleMembershipSelectionTypes(MEAL_SELECTION_TYPES.STANDARD_MEAL),
    [MEAL_SELECTION_TYPES.STANDARD_MEAL]
  );

  // Premium source remains controlled by the Premium section.
  assert.strictEqual(
    mealBuilderConfigService.isOptionIncluded(
      membership,
      MEAL_SELECTION_TYPES.PREMIUM_MEAL,
      productId,
      proteinGroupId,
      premiumOptionId
    ),
    true
  );

  // Any administrator-authored base group is inherited by Premium without
  // depending on a fixed group key such as "carbs".
  assert.strictEqual(
    mealBuilderConfigService.isGroupIncluded(
      membership,
      MEAL_SELECTION_TYPES.PREMIUM_MEAL,
      productId,
      baseSideGroupId
    ),
    true
  );
  assert.strictEqual(
    mealBuilderConfigService.isOptionIncluded(
      membership,
      MEAL_SELECTION_TYPES.PREMIUM_MEAL,
      productId,
      baseSideGroupId,
      baseSideOptionId
    ),
    true
  );

  // Inheritance is one-way: Standard meals never inherit Premium-only sources.
  assert.strictEqual(
    mealBuilderConfigService.isOptionIncluded(
      membership,
      MEAL_SELECTION_TYPES.STANDARD_MEAL,
      productId,
      proteinGroupId,
      premiumOptionId
    ),
    false
  );

  // Unknown groups/options remain rejected.
  assert.strictEqual(
    mealBuilderConfigService.isGroupIncluded(
      membership,
      MEAL_SELECTION_TYPES.PREMIUM_MEAL,
      productId,
      "unknown_group"
    ),
    false
  );
  assert.strictEqual(
    mealBuilderConfigService.isOptionIncluded(
      membership,
      MEAL_SELECTION_TYPES.PREMIUM_MEAL,
      productId,
      baseSideGroupId,
      "unknown_option"
    ),
    false
  );

  assert.strictEqual(
    canonicalPlannerService.validateCanonicalMealSlots.__premiumMealBaseBuilderInheritance,
    true
  );

  const result = suppressCascadingMinimumErrors({
    valid: false,
    errorCode: "PLANNER_BUILDER_GROUP_NOT_INCLUDED",
    errorMessage: "Group is not included",
    slotErrors: [
      {
        slotIndex: 3,
        groupId: baseSideGroupId,
        code: "PLANNER_BUILDER_GROUP_NOT_INCLUDED",
        message: "Group is not included",
      },
      {
        slotIndex: 3,
        groupId: baseSideGroupId,
        code: "PLANNER_MIN_SELECTION_NOT_MET",
        message: "Group requires at least one selection",
      },
      {
        slotIndex: 3,
        groupId: "another_group",
        code: "PLANNER_MIN_SELECTION_NOT_MET",
        message: "Another group is genuinely missing",
      },
    ],
    debug: {
      slots: [
        {
          slotIndex: 3,
          expectedGroups: [
            { groupId: baseSideGroupId, groupKey: "dynamic_side" },
            { groupId: "another_group", groupKey: "another" },
          ],
          productConfiguration: { groups: [] },
          missingGroups: ["dynamic_side", "another"],
          groupValidation: [
            { groupId: baseSideGroupId, groupKey: "dynamic_side", status: "FAIL" },
            { groupId: "another_group", groupKey: "another", status: "FAIL" },
          ],
        },
      ],
    },
  });

  assert.deepStrictEqual(
    result.slotErrors.map((error) => `${error.groupId}:${error.code}`),
    [
      `${baseSideGroupId}:PLANNER_BUILDER_GROUP_NOT_INCLUDED`,
      "another_group:PLANNER_MIN_SELECTION_NOT_MET",
    ]
  );
  assert.deepStrictEqual(result.debug.slots[0].missingGroups, ["another"]);
  assert.strictEqual(result.debug.slots[0].groupValidation[0].status, "BLOCKED");
  assert.strictEqual(result.debug.slots[0].productConfiguration.groups.length, 2);

  console.log("premium Meal Builder base-group inheritance passed");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
