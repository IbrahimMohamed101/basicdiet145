const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  normalizeOneTimeAddonCategoryKey,
  normalizeOneTimeAddonSelections,
  recomputeOneTimeAddonPlanningState,
  resolveEffectiveOneTimeAddonPlanning,
  assertNoPendingOneTimeAddonPayment,
} = require("../src/services/oneTimeAddonPlanningService");

function objectId() {
  return new mongoose.Types.ObjectId();
}

test("normalizeOneTimeAddonSelections enforces one item per deterministic category", () => {
  const addonOneId = objectId();
  const addonTwoId = objectId();

  const selections = normalizeOneTimeAddonSelections({
    requestedAddonIds: [addonOneId, addonTwoId],
    addonDocs: [
      { _id: addonOneId, isActive: true, type: "one_time", category: "starter", name: { ar: "شوربة", en: "Soup" } },
      { _id: addonTwoId, isActive: true, type: "one_time", category: "", name: { ar: "سلطة", en: "Salad" } },
    ],
    lang: "en",
  });

  assert.equal(selections.length, 2);
  assert.equal(selections[0].category, "starter");
  assert.equal(selections[1].category, String(addonTwoId));
  assert.equal(selections[0].name, "Soup");
  assert.equal(selections[1].name, "Salad");
});

test("normalizeOneTimeAddonSelections rejects duplicate one-time addon categories", () => {
  const addonOneId = objectId();
  const addonTwoId = objectId();
  assert.throws(
    () => normalizeOneTimeAddonSelections({
      requestedAddonIds: [addonOneId, addonTwoId],
      addonDocs: [
        { _id: addonOneId, isActive: true, type: "one_time", category: "starter", name: { ar: "أ", en: "A" } },
        { _id: addonTwoId, isActive: true, type: "one_time", category: "starter", name: { ar: "ب", en: "B" } },
      ],
      lang: "ar",
    }),
    (err) => err && err.code === "ONE_TIME_ADDON_CATEGORY_CONFLICT"
  );
});

test("recomputeOneTimeAddonPlanningState fully replaces final selections and derived pending fields", () => {
  const day = {
    oneTimeAddonSelections: [{ addonId: objectId(), name: "Old", category: "old" }],
    oneTimeAddonPendingCount: 9,
    oneTimeAddonPaymentStatus: "paid",
  };
  const addonId = objectId();

  recomputeOneTimeAddonPlanningState({
    day,
    selections: [{ addonId, name: "Soup", category: "starter" }],
  });

  assert.deepEqual(day.oneTimeAddonSelections, [{ addonId, name: "Soup", category: "starter" }]);
  assert.equal(day.oneTimeAddonPendingCount, 1);
  assert.equal(day.oneTimeAddonPaymentStatus, "pending");

  recomputeOneTimeAddonPlanningState({
    day,
    selections: [],
  });

  assert.deepEqual(day.oneTimeAddonSelections, []);
  assert.equal(day.oneTimeAddonPendingCount, 0);
  assert.equal(day.oneTimeAddonPaymentStatus, undefined);
});

test("resolveEffectiveOneTimeAddonPlanning prefers preserved snapshots", () => {
  const snapshotSelection = [{ addonId: objectId(), name: "Soup", category: "starter" }];
  const effective = resolveEffectiveOneTimeAddonPlanning({
    day: {
      oneTimeAddonSelections: [{ addonId: objectId(), name: "Changed", category: "dessert" }],
      oneTimeAddonPendingCount: 1,
      oneTimeAddonPaymentStatus: "pending",
      lockedSnapshot: {
        oneTimeAddonSelections: snapshotSelection,
        oneTimeAddonPendingCount: 1,
        oneTimeAddonPaymentStatus: "pending",
      },
    },
  });

  assert.equal(effective.oneTimeAddonSelections, snapshotSelection);
  assert.equal(effective.oneTimeAddonPendingCount, 1);
});

test("assertNoPendingOneTimeAddonPayment blocks confirmation until paid", () => {
  assert.throws(
    () => assertNoPendingOneTimeAddonPayment({
      day: {
        oneTimeAddonSelections: [{ addonId: objectId(), name: "Soup", category: "starter" }],
        oneTimeAddonPendingCount: 1,
        oneTimeAddonPaymentStatus: "pending",
      },
    }),
    (err) => err && err.code === "ONE_TIME_ADDON_PAYMENT_REQUIRED"
  );
});
