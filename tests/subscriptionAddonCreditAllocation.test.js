const assert = require("assert");

const {
  reconcileAddonInclusions,
} = require("../src/services/subscription/subscriptionSelectionService");
const {
  buildDayCommercialState,
} = require("../src/services/subscription/subscriptionDayCommercialStateService");

function objectId(index) {
  return Number(index).toString(16).padStart(24, "0");
}

const JUICE_PLAN_ID = objectId(900);
const SNACK_PLAN_ID = objectId(901);
const JUICE_IDS = Array.from({ length: 24 }, (_, index) => objectId(100 + index));
const SNACK_IDS = Array.from({ length: 16 }, (_, index) => objectId(200 + index));

function resolveChoiceProductById(id) {
  const normalized = String(id);
  if (JUICE_IDS.includes(normalized)) {
    return Promise.resolve({
      addonCategory: "juice",
      product: {
        _id: normalized,
        name: { en: "Juice", ar: "عصير" },
        priceHalala: 1100,
        currency: "SAR",
      },
    });
  }
  if (SNACK_IDS.includes(normalized)) {
    return Promise.resolve({
      addonCategory: "snack",
      product: {
        _id: normalized,
        name: { en: "Snack", ar: "سناك" },
        priceHalala: 1300,
        currency: "SAR",
      },
    });
  }
  return Promise.resolve(null);
}

function entitlement({ category, planId, menuProductIds = [], includeCategory = true }) {
  return {
    addonId: planId,
    addonPlanId: planId,
    ...(includeCategory ? { category } : {}),
    menuProductIds,
  };
}

function balance({ category, planId, remainingQty, includedTotalQty, consumedQty = 0, reservedQty = 0 }) {
  return {
    _id: objectId(Number.parseInt(planId.slice(-4), 16) + 1000),
    addonId: planId,
    addonPlanId: planId,
    category,
    ...(remainingQty === undefined ? {} : { remainingQty }),
    ...(includedTotalQty === undefined ? {} : { includedTotalQty }),
    consumedQty,
    reservedQty,
  };
}

function subscription({ juice, snack, juiceMenuProductIds = JUICE_IDS.slice(0, 3), legacyJuiceEntitlement = false }) {
  const addonSubscriptions = [];
  const addonBalance = [];
  if (juice) {
    addonSubscriptions.push(entitlement({
      category: "juice",
      planId: JUICE_PLAN_ID,
      menuProductIds: juiceMenuProductIds,
      includeCategory: !legacyJuiceEntitlement,
    }));
    addonBalance.push(balance({ category: "juice", planId: JUICE_PLAN_ID, ...juice }));
  }
  if (snack) {
    addonSubscriptions.push(entitlement({ category: "snack", planId: SNACK_PLAN_ID, menuProductIds: SNACK_IDS.slice(0, 3) }));
    addonBalance.push(balance({ category: "snack", planId: SNACK_PLAN_ID, ...snack }));
  }
  return { status: "active", addonSubscriptions, addonBalance };
}

function allocationSummary(day, sub) {
  const state = buildDayCommercialState({
    status: "open",
    addonSelections: day.addonSelections,
  }, { subscription: sub });
  return {
    covered: day.addonSelections.filter((row) => row.source === "subscription").length,
    pending: day.addonSelections.filter((row) => row.source === "pending_payment").length,
    amountDue: state.paymentRequirement.amountHalala,
    sources: day.addonSelections.map((row) => `${row.category}:${row.source}:${row.priceHalala}`),
  };
}

async function allocate(sub, requestedIds, day = { addonSelections: [] }) {
  await reconcileAddonInclusions(sub, day, requestedIds, { resolveChoiceProductById });
  return { day, summary: allocationSummary(day, sub) };
}

async function run() {
  // Scenario 1: exact balance boundary.
  let sub = subscription({ juice: { remainingQty: 7, includedTotalQty: 7 } });
  let result = await allocate(sub, JUICE_IDS.slice(0, 7));
  assert.deepStrictEqual(result.summary, {
    covered: 7,
    pending: 0,
    amountDue: 0,
    sources: Array(7).fill("juice:subscription:0"),
  });

  // Scenario 2: one item beyond the balance.
  result = await allocate(sub, JUICE_IDS.slice(0, 8));
  assert.strictEqual(result.summary.covered, 7);
  assert.strictEqual(result.summary.pending, 1);
  assert.strictEqual(result.summary.amountDue, 1100);

  // Scenario 3: production regression — a three-product catalog snapshot must
  // not cap a customer who has twenty category credits.
  sub = subscription({ juice: { remainingQty: 20, includedTotalQty: 20 } });
  result = await allocate(sub, JUICE_IDS.slice(0, 8));
  assert.strictEqual(result.summary.covered, 8);
  assert.strictEqual(result.summary.pending, 0);
  assert.strictEqual(result.summary.amountDue, 0);

  // Scenario 4: the same invariant applies to snacks.
  sub = subscription({ snack: { remainingQty: 15, includedTotalQty: 15 } });
  result = await allocate(sub, SNACK_IDS.slice(0, 10));
  assert.strictEqual(result.summary.covered, 10);
  assert.strictEqual(result.summary.pending, 0);
  assert.strictEqual(result.summary.amountDue, 0);

  // Scenario 5: exhausted balance charges the complete request.
  sub = subscription({ juice: { remainingQty: 0, includedTotalQty: 20, consumedQty: 20 } });
  result = await allocate(sub, JUICE_IDS.slice(0, 3));
  assert.strictEqual(result.summary.covered, 0);
  assert.strictEqual(result.summary.pending, 3);
  assert.strictEqual(result.summary.amountDue, 3300);

  // Scenario 6: partial balance charges only the uncovered quantity.
  sub = subscription({ juice: { remainingQty: 2, includedTotalQty: 5, consumedQty: 3 } });
  result = await allocate(sub, JUICE_IDS.slice(0, 5));
  assert.strictEqual(result.summary.covered, 2);
  assert.strictEqual(result.summary.pending, 3);
  assert.strictEqual(result.summary.amountDue, 3300);

  // Scenario 7: validation is a pure simulation; repeating it does not mutate
  // the subscription or progressively reduce the result.
  sub = subscription({ juice: { remainingQty: 7, includedTotalQty: 7 } });
  const before = JSON.stringify(sub);
  const first = await allocate(sub, JUICE_IDS.slice(0, 8));
  const second = await allocate(sub, JUICE_IDS.slice(0, 8));
  assert.deepStrictEqual(second.summary, first.summary);
  assert.strictEqual(JSON.stringify(sub), before);

  // Scenario 8: categories use independent simulated balances.
  sub = subscription({
    juice: { remainingQty: 8, includedTotalQty: 8 },
    snack: { remainingQty: 6, includedTotalQty: 6 },
  });
  result = await allocate(sub, JUICE_IDS.slice(0, 7).concat(SNACK_IDS.slice(0, 5)));
  assert.strictEqual(result.summary.covered, 12);
  assert.strictEqual(result.summary.pending, 0);
  assert.strictEqual(result.summary.amountDue, 0);

  // Scenario 9: remainingQty already represents genuinely available persisted
  // credits. consumed/reserved metadata must not be subtracted a second time.
  sub = subscription({ juice: { remainingQty: 5, includedTotalQty: 10, consumedQty: 3, reservedQty: 2 } });
  result = await allocate(sub, JUICE_IDS.slice(0, 6));
  assert.strictEqual(result.summary.covered, 5);
  assert.strictEqual(result.summary.pending, 1);
  assert.strictEqual(result.summary.amountDue, 1100);

  // Replacing an already-saved day makes that day's consumed credits available
  // to the simulation exactly once, so editing is deterministic.
  sub = subscription({ juice: { remainingQty: 2, includedTotalQty: 10, consumedQty: 8 } });
  const existingDay = {
    addonSelections: JUICE_IDS.slice(0, 3).map((addonId) => ({
      addonId,
      category: "juice",
      source: "subscription",
      priceHalala: 0,
    })),
  };
  result = await allocate(sub, JUICE_IDS.slice(0, 5), existingDay);
  assert.strictEqual(result.summary.covered, 5);
  assert.strictEqual(result.summary.pending, 0);
  assert.strictEqual(result.summary.amountDue, 0);

  // Scenario 10: malformed legacy balance rows fail closed instead of guessing
  // a daily quantity or silently defaulting to three credits.
  sub = subscription({ juice: { includedTotalQty: 20, consumedQty: 17 } });
  result = await allocate(sub, JUICE_IDS.slice(0, 4));
  assert.strictEqual(result.summary.covered, 0);
  assert.strictEqual(result.summary.pending, 4);
  assert.strictEqual(result.summary.amountDue, 4400);

  // Legacy entitlements without category retain their explicit-product fallback.
  sub = subscription({
    juice: { remainingQty: 2, includedTotalQty: 2 },
    juiceMenuProductIds: [JUICE_IDS[0]],
    legacyJuiceEntitlement: true,
  });
  result = await allocate(sub, [JUICE_IDS[0], JUICE_IDS[1]]);
  assert.strictEqual(result.summary.covered, 1);
  assert.strictEqual(result.summary.pending, 1);

  console.log("subscription add-on credit allocation tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
