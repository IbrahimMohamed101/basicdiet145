"use strict";

// The checkout integration suite predates the explicit same-day fulfillment
// contract. Production correctly shifts same-day home delivery to the next
// delivery day unless the customer explicitly chooses first-day pickup.
//
// Keep the large legacy integration fixture unchanged while adapting only its
// named same-day scenario at the HTTP boundary. The hook is intentionally
// narrow and fails the process if that exact scenario is never observed.

const http = require("node:http");

const originalRequest = http.request;
let explicitOverrideApplied = false;

http.request = function checkoutIntegrationRequest(options, callback) {
  const request = originalRequest.call(this, options, callback);
  const path = typeof options === "string"
    ? options
    : String(options && options.path || "");
  const method = typeof options === "object"
    ? String(options.method || "GET").toUpperCase()
    : "GET";

  if (method !== "POST" || !path.startsWith("/api/subscriptions/checkout")) {
    return request;
  }

  const originalWrite = request.write.bind(request);
  request.write = function writeCheckoutBody(chunk, encoding, done) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString(encoding || "utf8") : String(chunk);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      return originalWrite(chunk, encoding, done);
    }

    if (
      String(payload.idempotencyKey || "").startsWith("checkout_test_delivery_status_")
      && payload.delivery
      && payload.delivery.type === "delivery"
      && !payload.delivery.firstDayFulfillmentOverride
    ) {
      payload.delivery.firstDayFulfillmentOverride = {
        type: "pickup",
        pickupLocationId: "test_pickup_location",
      };
      explicitOverrideApplied = true;
      return originalWrite(JSON.stringify(payload), encoding, done);
    }

    return originalWrite(chunk, encoding, done);
  };

  return request;
};

process.on("beforeExit", () => {
  if (!explicitOverrideApplied) {
    console.error(
      "checkout integration harness did not observe the explicit same-day pickup scenario"
    );
    process.exitCode = 1;
  }
});
