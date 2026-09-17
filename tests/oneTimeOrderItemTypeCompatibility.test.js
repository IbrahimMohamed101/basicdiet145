"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

require("../src/services/installOneTimeOrderItemTypeCompatibility");

const Order = require("../src/models/Order");
const source = require("../scripts/bootstrap/fixtures/menu-workbook-source");

function importedProductItemType(categoryKey) {
  if (categoryKey === "sandwiches") return "sandwich";
  if (categoryKey === "carbs") return "carb";
  if (["desserts", "ice_cream"].includes(categoryKey)) return "dessert";
  if (categoryKey === "juices") return "juice";
  if (categoryKey === "drinks") return "drink";
  return "product";
}

async function main() {
  const itemTypePath = Order.schema.path("items").schema.path("itemType");
  const persistedTypes = new Set(itemTypePath.enumValues);
  const workbookRuntimeTypes = new Set(
    source.products
      .filter((row) => row.status !== "Needs Builder Setup")
      .filter((row) => Array.isArray(row.availableFor) && row.availableFor.includes("one_time"))
      .map((row) => importedProductItemType(row.categoryKey))
  );

  for (const itemType of workbookRuntimeTypes) {
    assert(
      persistedTypes.has(itemType),
      `Order schema must persist workbook one-time itemType ${itemType}`
    );
  }

  assert(persistedTypes.has("carb"), "Order schema must accept carb products");

  const order = new Order({
    orderNumber: "ORD-CARB-TEST",
    userId: new mongoose.Types.ObjectId(),
    status: "pending_payment",
    paymentStatus: "initiated",
    fulfillmentMethod: "pickup",
    fulfillmentDate: "2026-07-23",
    items: [{
      itemType: "carb",
      catalogRef: {
        model: "MenuProduct",
        id: new mongoose.Types.ObjectId(),
      },
      productId: new mongoose.Types.ObjectId(),
      name: { ar: "رز أبيض", en: "White Rice" },
      qty: 1,
      unitPriceHalala: 700,
      lineTotalHalala: 700,
      currency: "SAR",
    }],
    pricing: {
      subtotalHalala: 700,
      deliveryFeeHalala: 0,
      discountHalala: 0,
      totalHalala: 700,
      vatPercentage: 15,
      vatHalala: 91,
      vatIncluded: true,
      currency: "SAR",
    },
    pickup: {
      branchId: "main",
      pickupWindow: "09:00-12:00",
    },
    idempotencyKey: "one-time-carb-order-test",
    requestHash: "one-time-carb-order-test-hash",
  });

  await order.validate();
  assert.strictEqual(order.items[0].itemType, "carb");

  console.log("oneTimeOrderItemTypeCompatibility.test.js passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
