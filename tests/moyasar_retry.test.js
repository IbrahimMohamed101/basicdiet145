const assert = require("node:assert");
const { EventEmitter } = require("events");
const https = require("https");

const originalRequest = https.request;
const originalSecret = process.env.MOYASAR_SECRET_KEY;
const originalAttempts = process.env.MOYASAR_GET_RETRY_ATTEMPTS;

function installHttpsMock(responses) {
  const calls = [];
  https.request = (options, callback) => {
    calls.push(options);
    const response = responses.shift();
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.write = () => {};
    req.destroy = (err) => {
      process.nextTick(() => req.emit("error", err));
    };
    req.end = () => {
      process.nextTick(() => {
        if (response.error) {
          req.emit("error", response.error);
          return;
        }
        const res = new EventEmitter();
        res.statusCode = response.statusCode;
        callback(res);
        if (response.body !== undefined) res.emit("data", JSON.stringify(response.body));
        res.emit("end");
      });
    };
    return req;
  };
  return calls;
}

async function run() {
  process.env.MOYASAR_SECRET_KEY = "test_secret";
  process.env.MOYASAR_GET_RETRY_ATTEMPTS = "2";

  const { createInvoice, getInvoice } = require("../src/services/moyasarService");

  let calls = installHttpsMock([
    { statusCode: 502, body: { message: "Bad gateway" } },
    { statusCode: 200, body: { invoices: [{ id: "inv_1", status: "paid" }] } },
  ]);
  const invoice = await getInvoice("inv_1");
  assert.strictEqual(invoice.id, "inv_1");
  assert.strictEqual(calls.length, 2, "getInvoice should retry transient 502 then succeed");
  assert.ok(calls.every((call) => call.method === "GET"), "getInvoice retry should only use GET");

  calls = installHttpsMock([
    { statusCode: 404, body: { message: "Not found" } },
  ]);
  await assert.rejects(
    () => getInvoice("missing_invoice"),
    (err) => err.status === 404
  );
  assert.strictEqual(calls.length, 1, "getInvoice should not retry 404");

  calls = installHttpsMock([
    { statusCode: 502, body: { message: "Bad gateway" } },
    { statusCode: 200, body: { id: "inv_created", url: "https://pay.test" } },
  ]);
  await assert.rejects(
    () => createInvoice({
      amount: 1000,
      description: "test",
      callbackUrl: "https://example.test/webhook",
      successUrl: "https://example.test/success",
      backUrl: "https://example.test/back",
      metadata: { test: true },
    }),
    (err) => err.status === 502
  );
  assert.strictEqual(calls.length, 1, "createInvoice POST should not retry automatically");
  assert.strictEqual(calls[0].method, "POST");

  console.log("✅ Moyasar GET retry tests passed");
}

run()
  .catch((err) => {
    console.error("❌ Moyasar GET retry tests failed");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    https.request = originalRequest;
    if (originalSecret === undefined) delete process.env.MOYASAR_SECRET_KEY;
    else process.env.MOYASAR_SECRET_KEY = originalSecret;
    if (originalAttempts === undefined) delete process.env.MOYASAR_GET_RETRY_ATTEMPTS;
    else process.env.MOYASAR_GET_RETRY_ATTEMPTS = originalAttempts;
  });
