"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { ORDER_STATUSES } = require("../src/utils/orderState");

function userPayload(index, overrides = {}) {
  return {
    phone: `+96655010${String(index).padStart(4, "0")}`,
    name: `Index Test User ${index}`,
    ...overrides,
  };
}

function orderPayload(userId, suffix, overrides = {}) {
  return {
    userId,
    fulfillmentMethod: "pickup",
    fulfillmentDate: "2026-08-20",
    orderNumber: `IDX-${suffix}`,
    ...overrides,
  };
}

function paymentPayload(index, overrides = {}) {
  return {
    provider: "manual",
    type: "subscription_activation",
    amount: 10000 + index,
    currency: "SAR",
    ...overrides,
  };
}

async function assertDuplicate(write, label) {
  await assert.rejects(
    write,
    (err) => Boolean(err && err.code === 11000),
    `${label} must fail with Mongo duplicate-key error`
  );
}

async function run() {
  const mongo = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongo.getUri(), {
      dbName: `partial_index_semantics_${Date.now()}`,
      autoIndex: true,
    });

    const User = require("../src/models/User");
    const Order = require("../src/models/Order");
    const Payment = require("../src/models/Payment");

    await User.syncIndexes();
    await Order.syncIndexes();
    await Payment.syncIndexes();

    const userA = await User.create(userPayload(1));
    const userB = await User.create(userPayload(2));

    // Missing and empty optional values must remain outside partial indexes.
    await User.create(userPayload(3, { email: "" }));
    await User.create(userPayload(4, { email: "" }));

    await User.create(userPayload(5, { email: "index@example.com" }));
    await assertDuplicate(
      User.create(userPayload(6, { email: "INDEX@example.com" })),
      "normalized non-empty email"
    );

    await User.create(userPayload(7, { phoneE164: "+966500001111" }));
    await assertDuplicate(
      User.create(userPayload(8, { phoneE164: "+966500001111" })),
      "non-empty phoneE164"
    );

    // Empty idempotency fields may appear on many orders.
    await Order.create(orderPayload(userA._id, "EMPTY-1", {
      idempotencyKey: "",
      requestHash: "",
    }));
    await Order.create(orderPayload(userA._id, "EMPTY-2", {
      idempotencyKey: "",
      requestHash: "",
    }));

    await Order.create(orderPayload(userA._id, "IDEMP-1", {
      idempotencyKey: "same-order-key",
    }));
    await assertDuplicate(
      Order.create(orderPayload(userA._id, "IDEMP-2", {
        idempotencyKey: "same-order-key",
      })),
      "same-user non-empty order idempotency key"
    );
    await Order.create(orderPayload(userB._id, "IDEMP-OTHER-USER", {
      idempotencyKey: "same-order-key",
    }));

    await Order.create(orderPayload(userA._id, "HASH-1", {
      requestHash: "same-pending-request",
      status: ORDER_STATUSES.PENDING_PAYMENT,
    }));
    await assertDuplicate(
      Order.create(orderPayload(userA._id, "HASH-2", {
        requestHash: "same-pending-request",
        status: ORDER_STATUSES.PENDING_PAYMENT,
      })),
      "same-user pending request hash"
    );
    await Order.create(orderPayload(userA._id, "HASH-CONFIRMED", {
      requestHash: "same-pending-request",
      status: ORDER_STATUSES.CONFIRMED,
      paymentStatus: "paid",
    }));

    await Payment.create(paymentPayload(1));
    await Payment.create(paymentPayload(2));
    await Payment.create(paymentPayload(3, {
      operationIdempotencyKey: "same-payment-operation",
    }));
    await assertDuplicate(
      Payment.create(paymentPayload(4, {
        operationIdempotencyKey: "same-payment-operation",
      })),
      "non-empty payment operation idempotency key"
    );

    console.log("mongoose partial unique index semantic tests passed");
  } finally {
    await mongoose.disconnect().catch(() => {});
    await mongo.stop().catch(() => {});
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
