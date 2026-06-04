const assert = require("assert");

const {
  reconcileAddonInclusions,
} = require("../src/services/subscription/subscriptionSelectionService");
const {
  buildAddonEntitlementsReadModel,
} = require("../src/services/subscription/subscriptionAddonEntitlementReadService");
const {
  buildDayCommercialState,
} = require("../src/services/subscription/subscriptionDayCommercialStateService");

const IDS = {
  juiceMenuProduct: "507f191e810c19729de87001",
  snackMenuProduct: "507f191e810c19729de87002",
  addonPlan: "507f191e810c19729de87003",
};

function choice({ id, category, name = "Choice", priceHalala = 1100 }) {
  return {
    addonCategory: category,
    category: { key: category === "juice" ? "juices" : "desserts" },
    product: {
      _id: id,
      name: { en: name, ar: name },
      priceHalala,
      currency: "SAR",
    },
  };
}

async function assertRejectsWithCode(fn, code) {
  try {
    await fn();
  } catch (err) {
    assert.strictEqual(err.code, code);
    return err;
  }
  throw new Error(`Expected ${code} rejection`);
}

async function run() {
  const resolveChoiceProductById = async (id) => {
    if (String(id) === IDS.juiceMenuProduct) {
      return choice({ id, category: "juice", name: "Berry Blast", priceHalala: 1100 });
    }
    if (String(id) === IDS.snackMenuProduct) {
      return choice({ id, category: "snack", name: "Dark Brownies", priceHalala: 1300 });
    }
    return null;
  };

  const subscription = {
    addonSubscriptions: [
      {
        addonId: IDS.addonPlan,
        category: "juice",
        name: "Daily Juice",
        maxPerDay: 1,
      },
    ],
  };

  const day = { addonSelections: [] };
  // Test 1: Entitled juice is accepted — source=subscription, priceHalala=0
  await reconcileAddonInclusions(subscription, day, [IDS.juiceMenuProduct], { resolveChoiceProductById });
  assert.strictEqual(day.addonSelections.length, 1);
  assert.strictEqual(String(day.addonSelections[0].addonId), IDS.juiceMenuProduct);
  assert.strictEqual(day.addonSelections[0].category, "juice");
  assert.strictEqual(day.addonSelections[0].source, "subscription");
  assert.strictEqual(day.addonSelections[0].priceHalala, 0);

  // Test 2: Non-entitled snack is ACCEPTED (not rejected) — source=pending_payment, priceHalala=snack price
  const snackDay = { addonSelections: [] };
  await reconcileAddonInclusions(subscription, snackDay, [IDS.snackMenuProduct], { resolveChoiceProductById });
  assert.strictEqual(snackDay.addonSelections.length, 1);
  assert.strictEqual(String(snackDay.addonSelections[0].addonId), IDS.snackMenuProduct);
  assert.strictEqual(snackDay.addonSelections[0].category, "snack");
  assert.strictEqual(snackDay.addonSelections[0].source, "pending_payment",
    "Non-entitled daily add-on must use pending_payment source");
  assert.strictEqual(snackDay.addonSelections[0].priceHalala, 1300,
    "Non-entitled daily add-on must use current MenuProduct price");

  // Test 3: Mixed entitled juice + non-entitled snack in one payload
  const mixedDay = { addonSelections: [] };
  await reconcileAddonInclusions(
    subscription,
    mixedDay,
    [IDS.juiceMenuProduct, IDS.snackMenuProduct],
    { resolveChoiceProductById }
  );
  assert.strictEqual(mixedDay.addonSelections.length, 2);
  const juiceSel = mixedDay.addonSelections.find((s) => s.category === "juice");
  const snackSel = mixedDay.addonSelections.find((s) => s.category === "snack");
  assert.strictEqual(juiceSel.source, "subscription", "Entitled juice must use subscription source");
  assert.strictEqual(juiceSel.priceHalala, 0, "Entitled juice must be free");
  assert.strictEqual(snackSel.source, "pending_payment", "Non-entitled snack must use pending_payment source");
  assert.strictEqual(snackSel.priceHalala, 1300, "Non-entitled snack must use MenuProduct price");

  // Test 4: Addon plan ID in addonsOneTime is rejected
  await assertRejectsWithCode(
    () => reconcileAddonInclusions(subscription, { addonSelections: [] }, [IDS.addonPlan], { resolveChoiceProductById }),
    "INVALID_ONE_TIME_ADDON_SELECTION"
  );

  // Test 5: Clear selection works
  const clearDay = { addonSelections: [{ addonId: IDS.juiceMenuProduct, category: "juice", source: "subscription" }] };
  await reconcileAddonInclusions(subscription, clearDay, [], { resolveChoiceProductById });
  assert.deepStrictEqual(clearDay.addonSelections, []);

  // Test 6: Read model reflects entitled juice as selected
  const pendingReadModel = buildAddonEntitlementsReadModel(subscription.addonSubscriptions, []);
  assert.strictEqual(pendingReadModel.juice.subscribed, true);
  assert.strictEqual(pendingReadModel.juice.selectedItem, null);
  assert.strictEqual(pendingReadModel.juice.status, "pending_selection");
  assert.strictEqual(pendingReadModel.snack.status, "not_subscribed");

  const selectedReadModel = buildAddonEntitlementsReadModel(subscription.addonSubscriptions, day.addonSelections);
  assert.strictEqual(selectedReadModel.juice.status, "selected");
  assert.strictEqual(selectedReadModel.juice.selectedItem.menuProductId, IDS.juiceMenuProduct);
  assert.strictEqual(selectedReadModel.juice.selectedItem.priceHalala, 0);

  // Test 7: Commercial state — premium beef_steak (2000) + entitled juice (free) = premium pending only
  const entitledOnlyState = buildDayCommercialState({
    status: "open",
    plannerState: "draft",
    mealSlots: [
      {
        slotIndex: 1,
        slotKey: "slot_1",
        status: "complete",
        selectionType: "premium_meal",
        proteinId: "507f191e810c19729de87004",
        isPremium: true,
        premiumKey: "beef_steak",
        premiumSource: "pending_payment",
        premiumExtraFeeHalala: 2000,
        carbs: [{ carbId: "507f191e810c19729de87005", grams: 150 }],
      },
    ],
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      partialSlotCount: 0,
      premiumSlotCount: 1,
      premiumCoveredByBalanceCount: 0,
      premiumPendingPaymentCount: 1,
      premiumPaidExtraCount: 0,
      premiumTotalHalala: 2000,
      isDraftValid: true,
    },
    addonSelections: day.addonSelections, // entitled juice from Test 1
  });
  assert.strictEqual(entitledOnlyState.paymentRequirement.requiresPayment, true);
  assert.strictEqual(entitledOnlyState.paymentRequirement.premiumPendingPaymentCount, 1);
  assert.strictEqual(entitledOnlyState.paymentRequirement.addonSelectedCount, 1);
  assert.strictEqual(entitledOnlyState.paymentRequirement.addonPendingPaymentCount, 0,
    "Entitled juice must not contribute to addonPendingPaymentCount");
  assert.strictEqual(entitledOnlyState.paymentRequirement.pendingAmountHalala, 2000,
    "Only premium fee; entitled juice adds nothing");
  assert.strictEqual(entitledOnlyState.paymentRequirement.amountHalala, 2000);

  // Test 8: Commercial state — premium beef_steak (2000) + entitled juice (0) + non-entitled snack (1300)
  const mixedState = buildDayCommercialState({
    status: "open",
    plannerState: "draft",
    mealSlots: [
      {
        slotIndex: 1,
        slotKey: "slot_1",
        status: "complete",
        selectionType: "premium_meal",
        proteinId: "507f191e810c19729de87004",
        isPremium: true,
        premiumKey: "beef_steak",
        premiumSource: "pending_payment",
        premiumExtraFeeHalala: 2000,
        carbs: [{ carbId: "507f191e810c19729de87005", grams: 150 }],
      },
    ],
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      partialSlotCount: 0,
      premiumSlotCount: 1,
      premiumCoveredByBalanceCount: 0,
      premiumPendingPaymentCount: 1,
      premiumPaidExtraCount: 0,
      premiumTotalHalala: 2000,
      isDraftValid: true,
    },
    addonSelections: mixedDay.addonSelections, // entitled juice + non-entitled snack from Test 3
  });
  assert.strictEqual(mixedState.paymentRequirement.requiresPayment, true);
  assert.strictEqual(mixedState.paymentRequirement.addonSelectedCount, 2,
    "Both juice and snack are selected");
  assert.strictEqual(mixedState.paymentRequirement.addonPendingPaymentCount, 1,
    "Only snack is pending payment");
  assert.strictEqual(mixedState.paymentRequirement.premiumPendingPaymentCount, 1,
    "beef_steak premium is pending payment");
  const expectedTotal = 2000 + 1300;
  assert.strictEqual(mixedState.paymentRequirement.pendingAmountHalala, expectedTotal,
    `Total must be premiumFee(2000) + snackPrice(1300) = ${expectedTotal}`);
  assert.strictEqual(mixedState.paymentRequirement.amountHalala, expectedTotal);
}

run()
  .then(() => {
    console.log("subscription_addon_selection_contract tests passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
