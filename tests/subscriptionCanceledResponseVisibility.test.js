"use strict";

const assert = require("node:assert/strict");
const {
  hideCanceledSubscriptionsFromClientList,
} = require("../src/middleware/clientSubscriptionVisibility");

function main() {
  const payload = {
    status: true,
    data: [
      { id: "new", status: "active" },
      { id: "old", status: "canceled" },
      { id: "history", status: "expired" },
    ],
  };

  const filtered = hideCanceledSubscriptionsFromClientList(payload, {
    method: "GET",
    requestUrl: "/api/subscriptions?lang=ar",
  });

  assert.deepEqual(filtered.data, [
    { id: "new", status: "active" },
    { id: "history", status: "expired" },
  ]);
  assert.equal(payload.data.length, 3, "the original payload must not be mutated");

  const directCanceledRead = hideCanceledSubscriptionsFromClientList(payload, {
    method: "GET",
    requestUrl: "/api/subscriptions/old",
  });
  assert.equal(directCanceledRead, payload, "only the client list endpoint is filtered");

  const postResponse = hideCanceledSubscriptionsFromClientList(payload, {
    method: "POST",
    requestUrl: "/api/subscriptions",
  });
  assert.equal(postResponse, payload, "write responses must not be filtered");

  console.log("subscriptionCanceledResponseVisibility.test.js passed");
}

main();
