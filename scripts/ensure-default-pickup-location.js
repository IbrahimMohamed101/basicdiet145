#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const { connectDb } = require("../src/db");
const Setting = require("../src/models/Setting");
const {
  DEFAULT_PICKUP_WINDOW,
  buildDefaultPickupLocation,
} = require("../src/constants/defaultPickupLocation");

const PICKUP_LOCATION_ID_FIELDS = ["id", "key", "code", "slug", "branchId", "pickupLocationId"];

function cleanString(value) {
  return String(value || "").trim();
}

function isMainLocation(location) {
  if (!location || typeof location !== "object" || Array.isArray(location)) return false;
  return PICKUP_LOCATION_ID_FIELDS.some((field) => cleanString(location[field]) === "main");
}

function disableNonMainLocation(location) {
  if (!location || typeof location !== "object" || Array.isArray(location)) return location;
  return {
    ...location,
    isActive: false,
    active: false,
    enabled: false,
    isAvailable: false,
    available: false,
    pickupEnabled: false,
    isPickupEnabled: false,
    supportsPickup: false,
  };
}

function pickupWindowValue(window) {
  if (typeof window === "string") return cleanString(window);
  if (!window || typeof window !== "object" || Array.isArray(window)) return "";
  return cleanString(window.value || window.key || window.window || window.label);
}

async function ensureDefaultPickupLocation() {
  const defaultLocation = buildDefaultPickupLocation();
  const pickupLocationsSetting = await Setting.findOne({ key: "pickup_locations" }).lean();
  const existingLocations = Array.isArray(pickupLocationsSetting && pickupLocationsSetting.value)
    ? pickupLocationsSetting.value
    : [];
  const mainIndex = existingLocations.findIndex(isMainLocation);
  const nextLocations = existingLocations.map((location, index) => (
    index === mainIndex ? location : disableNonMainLocation(location)
  ));

  if (mainIndex >= 0) {
    nextLocations[mainIndex] = {
      ...nextLocations[mainIndex],
      ...defaultLocation,
    };
  } else {
    nextLocations.unshift(defaultLocation);
  }

  const pickupWindowsSetting = await Setting.findOne({ key: "pickup_windows" }).lean();
  const existingWindows = Array.isArray(pickupWindowsSetting && pickupWindowsSetting.value)
    ? pickupWindowsSetting.value
    : [];
  const nextWindows = existingWindows.filter((window) => pickupWindowValue(window));
  if (!nextWindows.some((window) => pickupWindowValue(window) === DEFAULT_PICKUP_WINDOW)) {
    nextWindows.push(DEFAULT_PICKUP_WINDOW);
  }

  await Promise.all([
    Setting.updateOne(
      { key: "pickup_locations" },
      {
        $set: {
          key: "pickup_locations",
          value: nextLocations,
          description: "Pickup locations including canonical main branch",
        },
      },
      { upsert: true }
    ),
    Setting.updateOne(
      { key: "pickup_windows" },
      {
        $set: {
          key: "pickup_windows",
          value: nextWindows,
          description: "Pickup windows including canonical main branch window",
        },
      },
      { upsert: true }
    ),
  ]);

  return {
    pickupLocationsCount: nextLocations.length,
    mainLocationUpdated: mainIndex >= 0,
    mainLocationCreated: mainIndex < 0,
    otherObjectLocationsMarkedInactive: existingLocations.filter((location, index) => (
      index !== mainIndex && location && typeof location === "object" && !Array.isArray(location)
    )).length,
    pickupWindows: nextWindows,
  };
}

async function main() {
  await connectDb();
  const result = await ensureDefaultPickupLocation();
  console.log(JSON.stringify({
    success: true,
    ...result,
  }, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}

module.exports = {
  ensureDefaultPickupLocation,
};
