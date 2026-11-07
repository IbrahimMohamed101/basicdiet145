"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const DashboardUser = require("../src/models/DashboardUser");
const PosCatalog = require("../src/models/PosCatalog");
const PosInvoice = require("../src/models/PosInvoice");
const PosRefund = require("../src/models/PosRefund");
const PosAudit = require("../src/models/PosAudit");
const PosLedger = require("../src/models/PosLedger");
const PosRefundBalance = require("../src/models/PosRefundBalance");
const PosOperation = require("../src/models/PosOperation");
const { abandonOperation } = require("../src/services/pos/operationService");
const { canonicalHash, normalizeSaleIntent } = require("../src/services/pos/financialIntent");
const { seedPosStagingCatalog, getCatalog, saveDraft, publishDraft } =
  require("../src/services/pos/catalogService");
const { pricePosCheckout } = require("../src/services/pos/financialQuoteService");
const { issueStagingInvoice, recordStagingRefund } =
  require("../src/services/pos/financialLedgerService");

const opts = { testOnly: true };
const saleRequest = (revision, overrides = {}) => ({
  revision, channel: "restaurant", serviceMode: "takeaway",
  items: [{ productId: "water", variantId: "bottle", quantity: 1, addons: [] }],
  tender: { method: "cash", receivedHalalas: 500 },
  ...overrides,
});
const key = n => "staging-test-idempotency-" + String(n).padStart(6, "0");

test("F replica: real Mongo transactions and idempotent sale/refund lifecycle", async (t) => {
  const uri = process.env.MONGO_URI_TEST;
  if (process.env.NODE_ENV !== "test" || !uri
    || !uri.includes("127.0.0.1") || !uri.includes("_ci_test")) {
    throw new Error("Only an explicit isolated local replica-set CI database is permitted.");
  }
  await mongoose.connect(uri, { autoIndex: true, serverSelectionTimeoutMS: 8000 });
  try {
    await mongoose.connection.dropDatabase();
    await PosCatalog.createIndexes();
    await seedPosStagingCatalog();
    const owner = await DashboardUser.create({
      email: "cashier-1@pos-staging.invalid", passwordHash: "test-hash-not-a-real-credential",
      role: "cashier", name: "كاشير تجريبي 1", isActive: true,
    });
    const other = await DashboardUser.create({
      email: "cashier-2@pos-staging.invalid", passwordHash: "test-hash-not-a-real-credential",
      role: "cashier", name: "كاشير تجريبي 2", isActive: true,
    });
    const actor = { dashboardUserId: String(owner._id), dashboardUserRole: "cashier" };
    const actor2 = { dashboardUserId: String(other._id), dashboardUserRole: "cashier" };
    const revision = (await getCatalog()).publishedRevision;
    const first = saleRequest(revision, { finalPayableHalalas: 1, vatHalalas: 0,
      items: [{ productId: "water", variantId: "bottle", quantity: 1, addons: [],
        unitPriceHalalas: 1, priceHalalas: -30 }] });
    const created = await issueStagingInvoice(actor, first, key(1), opts);
    assert.equal(created.replayed, false);
    assert.equal(created.invoice.number, "STG-000001");
    assert.equal(created.invoice.note, "فاتورة تجريبية — غير ضريبية");
    assert.equal(created.invoice.totals.grossHalalas, 300);
    assert.equal(created.invoice.actor.name, "كاشير تجريبي 1");
    assert.equal(created.invoice.actor.email, "cashier-1@pos-staging.invalid");
    assert.equal(created.invoice.tender.changeHalalas, 200);
    assert.equal((await PosLedger.findOne({ invoiceId: created.invoice._id }).lean()).type,
      "restaurant_cash");

    // Network response loss after commit: a second request gets the exact
    // original invoice instead of writing another cash ledger entry.
    const replay = await issueStagingInvoice(actor, first, key(1), opts);
    assert.equal(replay.replayed, true);
    assert.equal(String(replay.invoice._id), String(created.invoice._id));
    await assert.rejects(
      issueStagingInvoice(actor, saleRequest(revision, {
        tender: { method: "network" },
      }), key(1), opts), err => err.status === 409);
    assert.equal(await PosInvoice.countDocuments({ idempotencyKey: key(1) }), 1);

    // Two identical simultaneous confirmations must produce exactly one sale.
    const [a, b] = await Promise.all([
      issueStagingInvoice(actor, first, key(2), opts),
      issueStagingInvoice(actor, first, key(2), opts),
    ]);
    assert.equal(String(a.invoice._id), String(b.invoice._id));
    assert.equal(await PosInvoice.countDocuments({ idempotencyKey: key(2) }), 1);

    // Cashier race: distinct keys cannot create duplicate sequence numbers,
    // and a failed transaction must not consume a number.
    await assert.rejects(issueStagingInvoice(actor, saleRequest(revision, {
      tender: { method: "cash", receivedHalalas: 10 },
    }), key(3), opts), /المبلغ النقدي/);
    // Pending is unique per employee; distinct concurrent keys MUST use
    // different employees (a second key from the same employee is rejected).
    const concurrentActors = await Promise.all(Array.from({ length: 4 }, async (_, i) => {
      const user = await DashboardUser.create({
        email: "parallel-cashier-" + i + "@pos-staging.invalid",
        passwordHash: "test-hash-not-a-real-credential",
        role: "cashier", name: "parallel cashier " + i, isActive: true,
      });
      return { dashboardUserId: String(user._id), dashboardUserRole: "cashier" };
    }));
    const concurrent = await Promise.all(concurrentActors.map((staff, i) =>
      issueStagingInvoice(staff, saleRequest(revision, { tender: { method: "network" } }),
        key(10 + i), opts)));
    assert.equal(concurrent.length, 4);
    const numbers = (await PosInvoice.find({}).sort({ sequence: 1 }).lean())
      .map(invoice => invoice.sequence);
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6]);
    assert.equal(new Set(numbers).size, 6);
    assert.equal((await PosLedger.findOne({ invoiceId: concurrent[0].invoice._id }).lean()).type,
      "restaurant_network");

    // Publish a new catalog between price review and final sale. Stale
    // revision is rejected, not silently repriced into a second invoice.
    const beforePublish = await getCatalog();
    const draft = structuredClone(beforePublish.published);
    draft.products.find(item => item.id === "water").variants[0].prices.restaurant = 450;
    const saved = await saveDraft(beforePublish.revision, draft, created.invoice.actor);
    await publishDraft(saved.revision, created.invoice.actor);
    await assert.rejects(issueStagingInvoice(actor, first, key(20), opts),
      err => err.status === 409 && err.code === "POS_CATALOG_CONFLICT");
    assert.equal(await PosInvoice.countDocuments({}), 6);

    // App payments are receivables only, never restaurant cash.
    const newRev = (await getCatalog()).publishedRevision;
    const app = await issueStagingInvoice(actor, {
      revision: newRev, channel: "keeta", appPaymentStatus: "paid",
      externalOrderNumber: "SYNTHETIC-123",
      items: [{ productId: "water", variantId: "bottle", quantity: 1, addons: [] }],
      tender: { method: "cash", receivedHalalas: 999999 },
    }, key(21), opts);
    assert.equal((await PosLedger.findOne({ invoiceId: app.invoice._id }).lean()).type,
      "app_receivable");
    assert.equal(app.invoice.tender.method, "app_receivable");
    assert.equal(app.invoice.tender.reportedStatus, "paid");

    // Quantity 3 refund in three parts: last document takes exact balance.
    const pricedThree = await issueStagingInvoice(actor, saleRequest(newRev, {
      items: [{ productId: "water", variantId: "bottle", quantity: 3, addons: [] }],
      tender: { method: "cash", receivedHalalas: 2000 },
    }), key(22), opts);
    const line = pricedThree.invoice.lines[0];
    const rr = n => ({
      invoiceId: String(pricedThree.invoice._id),
      reason: "إرجاع صنف بناءً على طلب العميل",
      method: "cash", lines: [{ lineId: line.id, quantity: 1 }],
    });
    const returns = [];
    for (let i = 0; i < 3; i++) returns.push(
      await recordStagingRefund(actor, rr(i), key(30 + i), opts)
    );
    assert.equal(returns[0].refund.number, "STG-R-000001");
    assert.equal((await PosRefundBalance.findById(
      pricedThree.invoice._id.toString() + ":" + line.id).lean()).refundedQuantity, 3);
    assert.equal(returns.reduce((sum, r) => sum + r.refund.totals.grossHalalas, 0),
      line.grossHalalas);
    assert.equal(returns.reduce((sum, r) => sum + r.refund.totals.vatHalalas, 0),
      line.vatHalalas);
    const refundReplay = await recordStagingRefund(actor, rr(0), key(30), opts);
    assert.equal(refundReplay.replayed, true);
    assert.equal(String(refundReplay.refund._id), String(returns[0].refund._id));
    await assert.rejects(recordStagingRefund(actor, rr(4), key(34), opts), err => err.status === 409);

    // Two simultaneous full refunds against the same remaining quantity:
    // the second must reject rather than over-refund.
    const forRace = await issueStagingInvoice(actor, saleRequest(newRev, {
      tender: { method: "network" },
    }), key(40), opts);
    const amount = { invoiceId: String(forRace.invoice._id),
      reason: "إلغاء تجريبي بسبب خطأ",
      method: "network", lines: [{ lineId: forRace.invoice.lines[0].id, quantity: 1 }] };
    const race = await Promise.allSettled([
      recordStagingRefund(actor, amount, key(41), opts),
      recordStagingRefund(actor2, amount, key(42), opts),
    ]);
    assert.equal(race.filter(x => x.status === "fulfilled").length, 1);
    assert.equal(race.filter(x => x.status === "rejected").length, 1);
    assert.equal((await PosRefundBalance.findById(
      forRace.invoice._id.toString() + ":" + forRace.invoice.lines[0].id).lean()).refundedQuantity, 1);
    assert.equal(await PosRefund.countDocuments({ invoiceId: forRace.invoice._id }), 1);
    assert.ok((await PosAudit.countDocuments({ event: "POS_SALE_ISSUED" })) >= 8);

    // A final issued invoice remains unmodified after returns.
    const persisted = await PosInvoice.findById(pricedThree.invoice._id).lean();
    assert.equal(persisted.totals.grossHalalas, pricedThree.invoice.totals.grossHalalas);
    assert.equal(persisted.lines[0].quantity, 3);

    // Every permanently rejected operation is closed; a new key succeeds.
    const rejected = await PosOperation.findById(key(20)).lean();
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.errorCode, "POS_CATALOG_CONFLICT");
    const afterReject = await issueStagingInvoice(actor, saleRequest(newRev, {
      tender: { method: "network" },
    }), key(50), opts);
    assert.ok(afterReject.invoice.number);

    // Abandon before an HTTP POST arrives creates a durable tombstone.
    const ownerActor = { id: String(owner._id), role: "cashier" };
    const beforeCount = await PosInvoice.countDocuments({});
    const late = key(51);
    const closed = await abandonOperation(late, ownerActor, "sale");
    assert.equal(closed.status, "abandoned");
    await assert.rejects(issueStagingInvoice(actor, saleRequest(newRev), late, opts),
      err => err.code === "POS_OPERATION_CLOSED");
    assert.equal(await PosInvoice.countDocuments({}), beforeCount);

    // A pending sale for this cashier blocks only NEW keys, until resolved.
    const pendingKey = key(52);
    await PosOperation.create({
      _id: pendingKey, kind: "sale", operatorId: String(owner._id),
      payloadHash: canonicalHash(normalizeSaleIntent(saleRequest(newRev))),
      status: "pending",
    });
    await assert.rejects(issueStagingInvoice(actor, saleRequest(newRev), key(53), opts),
      err => err.code === "POS_OPERATION_PENDING");
    assert.equal((await PosOperation.findById(pendingKey)).status, "pending");
    assert.equal((await abandonOperation(pendingKey, ownerActor, "sale")).status, "abandoned");

    // Commit / abandon race on one document: exactly one terminal outcome.
    const raceKey = key(54);
    const [saleRace, abandonRace] = await Promise.allSettled([
      issueStagingInvoice(actor, saleRequest(newRev), raceKey, opts),
      abandonOperation(raceKey, ownerActor, "sale"),
    ]);
    const raceState = await PosOperation.findById(raceKey).lean();
    assert.ok(["committed", "abandoned"].includes(raceState.status));
    if (raceState.status === "committed") {
      assert.equal(saleRace.status, "fulfilled");
      const final = await abandonOperation(raceKey, ownerActor, "sale");
      assert.equal(final.status, "committed");
      assert.equal(String(final.resultId), String(saleRace.value.invoice._id));
    } else {
      assert.equal(saleRace.status, "rejected");
      assert.equal(await PosInvoice.countDocuments({ idempotencyKey: raceKey }), 0);
    }
    assert.equal(abandonRace.status, "fulfilled");

    // 20 retries of the identical key must produce a single invoice.
    const concurrentKey = key(55);
    const twentySame = await Promise.allSettled(Array.from({ length: 20 },
      () => issueStagingInvoice(actor, saleRequest(newRev), concurrentKey, opts)));
    assert.ok(twentySame.some(entry => entry.status === "fulfilled"));
    assert.equal(await PosInvoice.countDocuments({ idempotencyKey: concurrentKey }), 1);

    // 20 separate employees / keys. Sequential numbers with no gaps even
    // with simultaneous database transactions.
    const parallelStaff = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
      const user = await DashboardUser.create({
        email: "load-cashier-" + i + "@pos-staging.invalid",
        passwordHash: "test-hash-not-a-real-credential",
        role: "cashier", name: "cashier-load-" + i, isActive: true,
      });
      return { dashboardUserId: String(user._id), dashboardUserRole: "cashier" };
    }));
    const load = await Promise.all(parallelStaff.map((staff, i) =>
      issueStagingInvoice(staff, saleRequest(newRev, {
        tender: { method: "network" },
      }), key(100 + i), opts)));
    assert.equal(load.length, 20);
    const allSequences = (await PosInvoice.find({}).sort({ sequence: 1 }).lean())
      .map(row => row.sequence);
    assert.deepEqual(allSequences,
      Array.from({ length: allSequences.length }, (_, i) => i + 1));
    assert.equal(new Set(allSequences).size, allSequences.length);

    // Refund ambiguity and race use the same operation fence.
    const refundCase = await issueStagingInvoice(actor, saleRequest(newRev, {
      items: [{ productId: "water", variantId: "bottle", quantity: 2, addons: [] }],
    }), key(130), opts);
    const refundBody = { invoiceId: String(refundCase.invoice._id),
      reason: "تجربة رد جزئي آمن", method: "cash",
      lines: [{ lineId: refundCase.invoice.lines[0].id, quantity: 1 }] };
    const refundPending = key(131);
    await PosOperation.create({
      _id: refundPending, kind: "refund", operatorId: String(owner._id),
      payloadHash: canonicalHash(refundBody), status: "pending",
    });
    await assert.rejects(recordStagingRefund(actor, refundBody, key(132), opts),
      err => err.code === "POS_OPERATION_PENDING");
    assert.equal((await abandonOperation(refundPending, ownerActor, "refund")).status,
      "abandoned");
    await assert.rejects(recordStagingRefund(actor, refundBody, refundPending, opts),
      err => err.code === "POS_OPERATION_CLOSED");

    const refundKey = key(133);
    const refundRace = await Promise.allSettled([
      recordStagingRefund(actor, refundBody, refundKey, opts),
      abandonOperation(refundKey, ownerActor, "refund"),
    ]);
    const refundFinal = await PosOperation.findById(refundKey).lean();
    assert.ok(["committed", "abandoned"].includes(refundFinal.status));
    if (refundFinal.status === "abandoned") {
      assert.equal(await PosRefund.countDocuments({ idempotencyKey: refundKey }), 0);
    } else {
      assert.equal(await PosRefund.countDocuments({ idempotencyKey: refundKey }), 1);
    }
    assert.equal(refundRace[1].status, "fulfilled");
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
