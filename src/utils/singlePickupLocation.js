"use strict";

const { buildDefaultPickupLocation } = require("../constants/defaultPickupLocation");

const PICKUP_LOCATION_ID_FIELDS = [
  "_id",
  "id",
  "key",
  "code",
  "slug",
  "branchId",
  "pickupLocationId",
  "locationId",
];

function cleanString(value) {
  return String(value || "").trim();
}

function getPickupLocationId(location) {
  if (!location || typeof location !== "object" || Array.isArray(location)) return "";
  for (const field of PICKUP_LOCATION_ID_FIELDS) {
    const value = cleanString(location[field]);
    if (value) return value;
  }
  return "";
}

function isActivePickupLocation(location) {
  return Boolean(location)
    && typeof location === "object"
    && !Array.isArray(location)
    && location.isActive !== false
    && location.active !== false
    && location.enabled !== false
    && location.isEnabled !== false
    && location.isAvailable !== false
    && location.available !== false
    && location.pickupEnabled !== false
    && location.isPickupEnabled !== false
    && location.supportsPickup !== false
    && location.pickupAvailable !== false
    && location.availableForPickup !== false
    && location.acceptsPickup !== false;
}

function resolveSinglePickupLocation(locations) {
  const activeLocations = (Array.isArray(locations) ? locations : [])
    .filter(isActivePickupLocation);

  if (!activeLocations.length) {
    return buildDefaultPickupLocation();
  }

  return activeLocations.find((location) => location.isDefault === true)
    || activeLocations.find((location) => getPickupLocationId(location) === "main")
    || activeLocations[0];
}

function resolveSinglePickupLocations(locations) {
  return [resolveSinglePickupLocation(locations)];
}

module.exports = {
  getPickupLocationId,
  isActivePickupLocation,
  resolveSinglePickupLocation,
  resolveSinglePickupLocations,
};
