"use strict";

const assert = require("node:assert/strict");
const {
  planDaySettlement,
  verifySettlement,
} = require("../scripts/settle-stuck-delivered-days");

const SUB = "0000000000000000000000a1";
const DAY = "0000000000000000000000d1";
const BATCH = "0000000000000000000000b1";
const TODAY = "2026-11-22";

const subscription = (o = {}) => ({ _id: SUB, status: "active", deliveryMode: "delivery", ...o });
const day = (o = {}) => ({ _id: DAY, subscriptionId: SUB, date: "2026-11-17", status: "in_preparation", ...o });
const alloc = (state, o = {}) => ({
  subscriptionDayId: DAY, entitlementBatchId: BATCH, state, quantity: 1, ...o,
});
const reserved = (n) => Array.from({ length: n }, () => alloc("reserved"));
const plan = (o = {}) => planDaySettlement({
  subscription: subscription(), day: day(), allocations: reserved(2), today: TODAY, ...o,
});

// 1) in_preparation day with 2 reserved meals: path and expected count.
{
  const p = plan();
  assert.equal(p.expectedConsumed, 2);
  assert.deepEqual(p.statusPath, ["ready_for_delivery"]);
  assert.deepEqual(p.perBatchReserved, { [BATCH]: 2 });
}

// 2) open day needs the two-step path; ready day needs none.
assert.deepEqual(plan({ day: day({ status: "open" }) }).statusPath, ["in_preparation", "ready_for_delivery"]);
assert.deepEqual(plan({ day: day({ status: "ready_for_delivery" }) }).statusPath, []);

// 3) Refusals.
assert.throws(() => plan({ day: day({ status: "fulfilled" }) }), /already fulfilled/);
assert.throws(() => plan({ day: day({ status: "skipped" }) }), /cannot be settled/);
assert.throws(() => plan({ day: day({ date: TODAY }) }), /not in the past/);
assert.throws(() => plan({ day: day({ date: "2026-11-25" }) }), /not in the past/);
assert.throws(() => plan({ subscription: subscription({ status: "expired" }) }), /expected active/);
assert.throws(() => plan({ subscription: subscription({ deliveryMode: "pickup" }) }), /only delivery/);
assert.throws(() => plan({ day: day({ pickupRequested: true }) }), /only delivery/);
assert.throws(() => plan({ allocations: [] }), /no reserved meals/);
assert.throws(() => plan({ allocations: [alloc("consumed")] }), /no reserved meals/);
assert.throws(() => plan({ allocations: [...reserved(1), alloc("consumed")] }), /already has consumed/);
assert.throws(() => plan({ day: day({ subscriptionId: "0000000000000000000000ff" }) }), /another subscription/);

// 4) Allocations of other days are ignored; date-booked ones with no day link count.
{
  const other = { ...alloc("reserved"), subscriptionDayId: "0000000000000000000000d2", date: "2026-11-18" };
  assert.equal(plan({ allocations: [...reserved(1), other] }).expectedConsumed, 1);
  const byDate = { ...alloc("reserved"), subscriptionDayId: null, date: "2026-11-17" };
  const p = plan({ allocations: [byDate, { ...byDate }, { ...byDate }] });
  assert.equal(p.expectedConsumed, 3);
  assert.deepEqual(p.perBatchReserved, { [BATCH]: 3 });
}

// 5) Verification: the exact expected movement passes.
const before = () => ({
  dayStatus: "ready_for_delivery",
  allocations: { reserved: 2, consumed: 0, released: 0, forfeited: 0 },
  subscription: { totalMeals: 52, remainingMeals: 31, reservedMeals: 5, consumedMeals: 16 },
  batches: { [BATCH]: { remainingMeals: 31, reservedMeals: 5, consumedMeals: 16 } },
});
const good = () => ({
  dayStatus: "fulfilled",
  allocations: { reserved: 0, consumed: 2, released: 0, forfeited: 0 },
  subscription: { totalMeals: 52, remainingMeals: 31, reservedMeals: 3, consumedMeals: 18 },
  batches: { [BATCH]: { remainingMeals: 31, reservedMeals: 3, consumedMeals: 18 } },
});
const p = plan();
assert.deepEqual(verifySettlement({ plan: p, before: before(), after: good() }), []);

// 6) Verification: every wrong outcome is caught (this is what triggers rollback).
{
  const a = good(); a.subscription.remainingMeals = 29; a.batches[BATCH].remainingMeals = 29; // double debit
  const problems = verifySettlement({ plan: p, before: before(), after: a });
  assert.ok(problems.some((x) => /subscription remainingMeals changed/.test(x)));
  assert.ok(problems.some((x) => /batch .* remainingMeals changed/.test(x)));
}
{
  const a = good(); a.allocations = { reserved: 2, consumed: 0, released: 0, forfeited: 0 }; // nothing moved
  assert.ok(verifySettlement({ plan: p, before: before(), after: a }).some((x) => /still reserved/.test(x)));
}
{
  const a = good(); a.allocations.consumed = 1; a.allocations.released = 1; // released instead of consumed
  assert.ok(verifySettlement({ plan: p, before: before(), after: a }).some((x) => /consumed allocations/.test(x)));
}
{
  const a = good(); a.dayStatus = "ready_for_delivery";
  assert.ok(verifySettlement({ plan: p, before: before(), after: a }).some((x) => /expected fulfilled/.test(x)));
}
{
  const a = good(); a.batches[BATCH].consumedMeals = 17; // batch consumed by 1 instead of 2
  assert.ok(verifySettlement({ plan: p, before: before(), after: a }).some((x) => /consumedMeals/.test(x)));
}
{
  const a = good(); a.batches[BATCH].reservedMeals = 4;
  assert.ok(verifySettlement({ plan: p, before: before(), after: a }).some((x) => /reservedMeals/.test(x)));
}
{
  const a = good(); delete a.batches[BATCH];
  assert.ok(verifySettlement({ plan: p, before: before(), after: a }).some((x) => /missing from snapshot/.test(x)));
}

// 7) Two batches: each must move by its own reserved count.
{
  const B2 = "0000000000000000000000b2";
  const allocs = [alloc("reserved"), alloc("reserved", { entitlementBatchId: B2 })];
  const p2 = plan({ allocations: allocs });
  assert.deepEqual(p2.perBatchReserved, { [BATCH]: 1, [B2]: 1 });
  const b = before(); b.allocations.reserved = 2;
  b.batches = { [BATCH]: { remainingMeals: 5, reservedMeals: 1, consumedMeals: 0 }, [B2]: { remainingMeals: 9, reservedMeals: 1, consumedMeals: 3 } };
  const a = good();
  a.batches = { [BATCH]: { remainingMeals: 5, reservedMeals: 0, consumedMeals: 1 }, [B2]: { remainingMeals: 9, reservedMeals: 0, consumedMeals: 4 } };
  assert.deepEqual(verifySettlement({ plan: p2, before: b, after: a }), []);
}

// 8) Legacy embedded ledger (subscription.baseMealAllocations).
{
  const legacy = (state, o = {}) => ({ allocationKey: `k-${Math.random()}`, dayId: DAY, date: "2026-11-17", state, ...o });
  const sub = subscription({ baseMealAllocations: [legacy("reserved"), legacy("reserved"), legacy("reserved")] });
  const p3 = planDaySettlement({ subscription: sub, day: day({ status: "open" }), allocations: [], today: TODAY });
  assert.equal(p3.expectedConsumed, 3);
  assert.equal(p3.legacyReserved, 3);
  assert.deepEqual(p3.perBatchReserved, {});

  // booked on the date but not linked to the day: transition would skip it -> refuse
  const unlinked = subscription({ baseMealAllocations: [legacy("reserved", { dayId: null })] });
  assert.throws(() => planDaySettlement({ subscription: unlinked, day: day(), allocations: [], today: TODAY }), /not linked/);
  // linked through the day's projected keys is fine
  const keyed = subscription({ baseMealAllocations: [legacy("reserved", { dayId: null, allocationKey: "K1" })] });
  assert.equal(planDaySettlement({ subscription: keyed, day: day({ baseAllocationKeys: ["K1"] }), allocations: [], today: TODAY }).legacyReserved, 1);
  // other days ignored
  const otherDay = subscription({ baseMealAllocations: [legacy("reserved", { dayId: "0000000000000000000000d9", date: "2026-11-20" })] });
  assert.throws(() => planDaySettlement({ subscription: otherDay, day: day(), allocations: [], today: TODAY }), /no reserved meals/);

  const b = { dayStatus: "ready_for_delivery", allocations: { reserved: 3, consumed: 0, released: 0, forfeited: 0 },
    subscription: { totalMeals: 52, remainingMeals: 31, reservedMeals: 5, consumedMeals: 16 }, batches: {} };
  const a = { dayStatus: "fulfilled", allocations: { reserved: 0, consumed: 3, released: 0, forfeited: 0 },
    subscription: { totalMeals: 52, remainingMeals: 31, reservedMeals: 2, consumedMeals: 19 }, batches: {} };
  assert.deepEqual(verifySettlement({ plan: p3, before: b, after: a }), []);
  const bad = { ...a, subscription: { ...a.subscription, reservedMeals: 3, consumedMeals: 18 } };
  const problems = verifySettlement({ plan: p3, before: b, after: bad });
  assert.ok(problems.some((x) => /subscription reservedMeals/.test(x)));
  assert.ok(problems.some((x) => /subscription consumedMeals/.test(x)));
}

console.log("settleStuckDeliveredDays tests passed");
