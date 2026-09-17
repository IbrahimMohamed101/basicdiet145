"use strict";

const Order = require("../models/Order");

let installed = false;

function getOrderItemTypePath() {
  const itemsPath = Order.schema.path("items");
  const itemSchema = itemsPath && itemsPath.schema;
  return itemSchema && itemSchema.path("itemType");
}

function installOneTimeOrderItemTypeCompatibility() {
  if (installed) return;

  const itemTypePath = getOrderItemTypePath();
  if (!itemTypePath) {
    throw new Error("Order.items.itemType schema path is unavailable");
  }

  const supportedTypes = ["carb"];
  for (const itemType of supportedTypes) {
    if (!itemTypePath.enumValues.includes(itemType)) {
      itemTypePath.enum(itemType);
    }
  }

  installed = true;
}

installOneTimeOrderItemTypeCompatibility();

module.exports = {
  getOrderItemTypePath,
  installOneTimeOrderItemTypeCompatibility,
};
