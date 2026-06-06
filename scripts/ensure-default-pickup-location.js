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

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

async function ensureDefaultPickupLocation({ sync = isTruthy(process.env.BOOTSTRAP_SYNC) } = {}) {
  const defaultLocation = buildDefaultPickupLocation();
  const pickupLocationsSetting = await Setting.findOne({ key: "pickup_locations" }).lean();
  const existingLocations = Array.isArray(pickupLocationsSetting && pickupLocationsSetting.value)
    ? pickupLocationsSetting.value
    : [];
  const mainIndex = existingLocations.findIndex(isMainLocation);
  const nextLocations = sync
    ? existingLocations.map((location, index) => (
      index === mainIndex ? location : disableNonMainLocation(location)
    ))
    : [...existingLocations];

  if (mainIndex >= 0) {
    if (sync) {
      nextLocations[mainIndex] = {
        ...nextLocations[mainIndex],
        ...defaultLocation,
      };
    }
  } else {
    nextLocations.unshift(defaultLocation);
  }

  const pickupWindowsSetting = await Setting.findOne({ key: "pickup_windows" }).lean();
  const existingWindows = Array.isArray(pickupWindowsSetting && pickupWindowsSetting.value)
    ? pickupWindowsSetting.value
    : [];
  const nextWindows = existingWindows.filter((window) => pickupWindowValue(window));
  const hasDefaultPickupWindow = nextWindows.some((window) => pickupWindowValue(window) === DEFAULT_PICKUP_WINDOW);
  if (!hasDefaultPickupWindow) {
    nextWindows.push(DEFAULT_PICKUP_WINDOW);
  }

  const writes = [];
  if (sync || mainIndex < 0 || !pickupLocationsSetting) {
    writes.push(Setting.updateOne(
      { key: "pickup_locations" },
      {
        $set: {
          key: "pickup_locations",
          value: nextLocations,
          ...(sync || !pickupLocationsSetting ? { description: "Pickup locations including canonical main branch" } : {}),
        },
      },
      { upsert: true }
    ));
  }
  if (sync || !hasDefaultPickupWindow || !pickupWindowsSetting) {
    writes.push(Setting.updateOne(
      { key: "pickup_windows" },
      {
        $set: {
          key: "pickup_windows",
          value: nextWindows,
          ...(sync || !pickupWindowsSetting ? { description: "Pickup windows including canonical main branch window" } : {}),
        },
      },
      { upsert: true }
    ));
  }
  await Promise.all(writes);

  return {
    pickupLocationsCount: nextLocations.length,
    mode: sync ? "sync" : "create-missing-only",
    mainLocationUpdated: sync && mainIndex >= 0,
    mainLocationCreated: mainIndex < 0,
    otherObjectLocationsMarkedInactive: existingLocations.filter((location, index) => (
      sync && index !== mainIndex && location && typeof location === "object" && !Array.isArray(location)
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
