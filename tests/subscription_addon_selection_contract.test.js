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
    status: "active",
    addonBalance: [{ _id: "507f191e810c19729de87009", addonId: IDS.addonPlan, category: "juice", remainingQty: 5 }],
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

  // ─── Regression tests: INVALID_ADDON_SELECTION bug fix ───────────────────────
  // Scenario: subscription has a juice entitlement with a non-empty menuProductIds
  // allowlist (Juice A only).  Juice B is a valid active item in category juice
  // but NOT in that allowlist.  Before the fix this threw INVALID_ADDON_SELECTION;
  // after the fix it must be accepted as pending_payment.

  const JUICE_A_ID = "507f191e810c19729de87010"; // in allowlist
  const JUICE_B_ID = "507f191e810c19729de87011"; // NOT in allowlist (Berry Blast scenario)
  const JUICE_PLAN_ID = "507f191e810c19729de87012";

  const restrictedResolveChoiceProductById = async (id) => {
    if (String(id) === JUICE_A_ID) {
      return choice({ id, category: "juice", name: "Juice A", priceHalala: 1000 });
    }
    if (String(id) === JUICE_B_ID) {
      return choice({ id, category: "juice", name: "Berry Blast", priceHalala: 1100 });
    }
    return null;
  };

  const subscriptionWithRestrictedPlan = {
    addonSubscriptions: [
      {
        addonId: JUICE_PLAN_ID,
        addonPlanId: JUICE_PLAN_ID,
        category: "juice",
        name: "Juice Plan A Only",
        maxPerDay: 1,
        menuProductIds: [JUICE_A_ID], // only Juice A is in the allowlist
      },
    ],
  };

  // Test A: valid item without a balance bucket → pending_payment (NOT rejected)
  const testADay = { addonSelections: [] };
  await reconcileAddonInclusions(
    subscriptionWithRestrictedPlan,
    testADay,
    [JUICE_B_ID],
    { resolveChoiceProductById: restrictedResolveChoiceProductById }
  );
  assert.strictEqual(testADay.addonSelections.length, 1,
    "Test A: Berry Blast must appear in addonSelections");
  assert.strictEqual(String(testADay.addonSelections[0].addonId), JUICE_B_ID,
    "Test A: addonId must match Juice B");
  assert.strictEqual(testADay.addonSelections[0].source, "pending_payment",
    "Test A: missing balance → source must be pending_payment, not INVALID_ADDON_SELECTION");
  assert.strictEqual(testADay.addonSelections[0].priceHalala, 1100,
    "Test A: pending_payment price must equal the item's priceHalala");

  // Test B: item inside menuProductIds with legacy balance → subscription coverage
  const subscriptionWithBalance = {
    status: "active",
    addonBalance: [{ _id: "507f191e810c19729de87019", addonPlanId: JUICE_PLAN_ID, category: "juice", remainingQty: 5 }],
    addonSubscriptions: [
      {
        addonId: JUICE_PLAN_ID,
        addonPlanId: JUICE_PLAN_ID,
        category: "juice",
        name: "Juice Plan A Only",
        maxPerDay: 1,
        menuProductIds: [JUICE_A_ID],
      },
    ],
  };

  const testBDay = { addonSelections: [] };
  await reconcileAddonInclusions(
    subscriptionWithBalance,
    testBDay,
    [JUICE_A_ID],
    { resolveChoiceProductById: restrictedResolveChoiceProductById }
  );
  assert.strictEqual(testBDay.addonSelections.length, 1,
    "Test B: Juice A must appear in addonSelections");
  assert.strictEqual(testBDay.addonSelections[0].source, "subscription",
    "Test B: Juice A is in menuProductIds and has balance → source must be subscription");
  assert.strictEqual(testBDay.addonSelections[0].priceHalala, 0,
    "Test B: subscription-covered item must have priceHalala 0");

  // Test C: invalid item (not in catalog) still rejects with INVALID_ONE_TIME_ADDON_SELECTION
  await assertRejectsWithCode(
    () => reconcileAddonInclusions(
      subscriptionWithRestrictedPlan,
      { addonSelections: [] },
      ["507f191e810c19729de87099"], // unknown ID — resolves to null
      { resolveChoiceProductById: restrictedResolveChoiceProductById }
    ),
    "INVALID_ONE_TIME_ADDON_SELECTION"
  );

  // ─── Regression tests: "Rule of 3" production bug fix ─────────────────────
  // Root cause: reconcileAddonInclusions was using menuProductIds as a hard
  // balance-deduction gate. Any juice product whose ID was NOT in the plan's
  // menuProductIds was forced to pending_payment even when balance remained.
  //
  // Fix: menuProductIds is a catalog display hint only. Any item matching the
  // entitlement category may consume subscription balance up to remainingQty.

  const JUICE_IDS = {
    orange:  "507f191e810c19729de87020",
    apple:   "507f191e810c19729de87021",
    mango:   "507f191e810c19729de87022",
    berry:   "507f191e810c19729de87023",  // NOT in menuProductIds in old code
    berryP:  "507f191e810c19729de87024",  // NOT in menuProductIds in old code
    green:   "507f191e810c19729de87025",  // NOT in menuProductIds in old code
    beet:    "507f191e810c19729de87026",  // NOT in menuProductIds in old code
    PLAN_ID: "507f191e810c19729de87027",
  };

  const SALAD_IDS = {
    s1: "507f191e810c19729de87030",
    s2: "507f191e810c19729de87031",
    s3: "507f191e810c19729de87032",
    s4: "507f191e810c19729de87033",
    s5: "507f191e810c19729de87034",
    PLAN_ID: "507f191e810c19729de87035",
  };

  // Resolves all 7 juice IDs and 5 salad IDs
  const resolveProductionChoiceById = async (id) => {
    const str = String(id);
    if ([JUICE_IDS.orange, JUICE_IDS.apple, JUICE_IDS.mango,
         JUICE_IDS.berry, JUICE_IDS.berryP, JUICE_IDS.green, JUICE_IDS.beet].includes(str)) {
      return choice({ id, category: "juice", name: `Juice ${str.slice(-4)}`, priceHalala: 1100 });
    }
    if ([SALAD_IDS.s1, SALAD_IDS.s2, SALAD_IDS.s3, SALAD_IDS.s4, SALAD_IDS.s5].includes(str)) {
      return choice({ id, category: "small_salad", name: `Salad ${str.slice(-4)}`, priceHalala: 1200 });
    }
    return null;
  };

  // Production-replica subscription: juice plan with menuProductIds restricted to 3 IDs,
  // but addonBalance has remainingQty = 7 (as seen in the live repro).
  const productionReplicaSub = {
    status: "active",
    addonBalance: [
      {
        _id: "507f191e810c19729de87040",
        addonPlanId: JUICE_IDS.PLAN_ID,
        category: "juice",
        remainingQty: 7,
        consumedQty: 0,
      },
      {
        _id: "507f191e810c19729de87041",
        addonPlanId: SALAD_IDS.PLAN_ID,
        category: "small_salad",
        remainingQty: 5,
        consumedQty: 0,
      },
    ],
    addonSubscriptions: [
      {
        addonId: JUICE_IDS.PLAN_ID,
        addonPlanId: JUICE_IDS.PLAN_ID,
        category: "juice",
        name: "Juice Subscription",
        maxPerDay: 7,
        // menuProductIds restricted to 3 — was incorrectly blocking the other 4
        menuProductIds: [JUICE_IDS.orange, JUICE_IDS.apple, JUICE_IDS.mango],
      },
      {
        addonId: SALAD_IDS.PLAN_ID,
        addonPlanId: SALAD_IDS.PLAN_ID,
        category: "small_salad",
        name: "Small Salad Subscription",
        maxPerDay: 5,
        menuProductIds: [], // empty — was always working correctly
      },
    ],
  };

  // Test D — Production repro: 7 juice items, balance=7, menuProductIds=[3 IDs]
  // Expected: all 7 products use the category balance; menuProductIds is not a credit cap.
  const testDDay = { addonSelections: [] };
  await reconcileAddonInclusions(
    productionReplicaSub,
    testDDay,
    [
      JUICE_IDS.orange, JUICE_IDS.apple, JUICE_IDS.mango,
      JUICE_IDS.berry, JUICE_IDS.berryP, JUICE_IDS.green, JUICE_IDS.beet,
    ],
    { resolveChoiceProductById: resolveProductionChoiceById }
  );
  assert.strictEqual(testDDay.addonSelections.length, 7,
    "Test D: all 7 juice selections must be present");
  assert.strictEqual(
    testDDay.addonSelections.filter((s) => s.source === "subscription").length, 7,
    "Test D: all 7 juices must be source=subscription"
  );
  assert.strictEqual(
    testDDay.addonSelections.filter((s) => s.source === "pending_payment").length, 0,
    "Test D: no juice may be pending while category balance remains"
  );
  testDDay.addonSelections.forEach((sel) => {
    assert.strictEqual(sel.priceHalala, 0, `Test D: ${String(sel.addonId)} must have priceHalala=0`);
  });

  // Test E — Partial balance: 7 juice items, balance=5 → 5 subscription + 2 pending_payment
  const partialSub = {
    status: "active",
    addonBalance: [
      {
        _id: "507f191e810c19729de87050",
        addonPlanId: JUICE_IDS.PLAN_ID,
        category: "juice",
        remainingQty: 5,
        consumedQty: 2,
      },
    ],
    addonSubscriptions: [
      {
        addonId: JUICE_IDS.PLAN_ID,
        addonPlanId: JUICE_IDS.PLAN_ID,
        category: "juice",
        name: "Juice Subscription",
        maxPerDay: 7,
        menuProductIds: [JUICE_IDS.orange, JUICE_IDS.apple, JUICE_IDS.mango], // still restricted
      },
    ],
  };
  const testEDay = { addonSelections: [] };
  await reconcileAddonInclusions(
    partialSub,
    testEDay,
    [
      JUICE_IDS.orange, JUICE_IDS.apple, JUICE_IDS.mango,
      JUICE_IDS.berry, JUICE_IDS.berryP, JUICE_IDS.green, JUICE_IDS.beet,
    ],
    { resolveChoiceProductById: resolveProductionChoiceById }
  );
  assert.strictEqual(testEDay.addonSelections.length, 7,
    "Test E: all 7 juice selections must be present");
  assert.strictEqual(
    testEDay.addonSelections.filter((s) => s.source === "subscription").length, 5,
    "Test E: exactly 5 juices must be subscription-covered"
  );
  assert.strictEqual(
    testEDay.addonSelections.filter((s) => s.source === "pending_payment").length, 2,
    "Test E: exactly 2 juices must be pending_payment"
  );
  testEDay.addonSelections
    .filter((s) => s.source === "pending_payment")
    .forEach((sel) => {
      assert.strictEqual(sel.priceHalala, 1100,
        "Test E: overage juices must use item priceHalala");
    });

  // Test F — small_salad 5 items, balance=5, empty menuProductIds → all 5 subscription
  // (Confirms existing working behavior is preserved after the fix)
  const testFDay = { addonSelections: [] };
  await reconcileAddonInclusions(
    productionReplicaSub,
    testFDay,
    [SALAD_IDS.s1, SALAD_IDS.s2, SALAD_IDS.s3, SALAD_IDS.s4, SALAD_IDS.s5],
    { resolveChoiceProductById: resolveProductionChoiceById }
  );
  assert.strictEqual(testFDay.addonSelections.length, 5,
    "Test F: all 5 salad selections must be present");
  assert.strictEqual(
    testFDay.addonSelections.filter((s) => s.source === "subscription").length, 5,
    "Test F: all 5 small_salads must be subscription-covered (empty menuProductIds)"
  );
  assert.strictEqual(
    testFDay.addonSelections.filter((s) => s.source === "pending_payment").length, 0,
    "Test F: zero small_salads must be pending_payment"
  );

  // Test G — Mixed juice + salad in one payload: each category's balance is independent
  const testGDay = { addonSelections: [] };
  await reconcileAddonInclusions(
    productionReplicaSub,
    testGDay,
    [
      JUICE_IDS.orange, JUICE_IDS.berry, JUICE_IDS.berryP, // 3 juices (balance=7)
      SALAD_IDS.s1, SALAD_IDS.s2,                          // 2 salads (balance=5)
    ],
    { resolveChoiceProductById: resolveProductionChoiceById }
  );
  assert.strictEqual(testGDay.addonSelections.length, 5,
    "Test G: 5 total selections");
  assert.strictEqual(
    testGDay.addonSelections.filter((s) => s.category === "juice" && s.source === "subscription").length, 3,
    "Test G: all 3 juice items are subscription-covered"
  );
  assert.strictEqual(
    testGDay.addonSelections.filter((s) => s.category === "small_salad" && s.source === "subscription").length, 2,
    "Test G: 2 salad items are subscription"
  );
}

run()
  .then(() => {
    console.log("subscription_addon_selection_contract tests passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
