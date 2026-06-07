require("dotenv").config();

const assert = require("assert");
const {
  buildFulfillmentReadFields,
  repairLegacyPickupSubscriptionReadView,
} = require("../src/services/subscription/subscriptionFulfillmentSummaryService");
const { buildDefaultPickupLocation } = require("../src/constants/defaultPickupLocation");
const { buildLockedOperationalSnapshotDetails } = require("../src/utils/delivery");
const {
  resolveDeliveryCatalog,
  resolvePickupLocationSelection,
} = require("../src/utils/subscription/subscriptionCatalog");

const pickupLocations = [
  {
    id: "riyadh_north",
    name: { ar: "فرع الرياض الشمالي", en: "Riyadh North Branch" },
    address: {
      line1: { ar: "طريق الملك فهد", en: "King Fahd Road" },
      district: { ar: "العقيق", en: "Al Aqiq" },
      city: "Riyadh",
      lat: 24.755,
      lng: 46.63,
    },
    phone: "+966500000000",
    workingHours: { ar: "من 9 صباحًا إلى 11 مساءً", en: "9 AM to 11 PM" },
    mapUrl: "https://maps.example/riyadh-north",
  },
];

function assertNoRawCodes(value, label) {
  const text = JSON.stringify(value || {});
  for (const code of ["DAY_LOCKED_BEFORE_DELIVERY", "DELIVERY_TIME_UNAVAILABLE", "PLANNER_UNCONFIRMED"]) {
    assert(!text.includes(code), `${label}: leaked raw code ${code}`);
  }
}

function pickupSubscription(overrides = {}) {
  return {
    _id: "sub_pickup",
    deliveryMode: "pickup",
    pickupLocationId: "riyadh_north",
    deliverySlot: { type: "pickup", window: "", slotId: "pickup_slot_1" },
    ...overrides,
  };
}

function deliverySubscription(overrides = {}) {
  return {
    _id: "sub_delivery",
    deliveryMode: "delivery",
    deliveryAddress: {
      label: "Home",
      line1: "Building 12",
      district: "Al Olaya",
      city: "Riyadh",
    },
    deliveryWindow: "16:00-22:00",
    deliverySlot: { type: "delivery", window: "16:00-22:00", slotId: "delivery_slot_1" },
    deliveryZoneName: "North Riyadh",
    ...overrides,
  };
}

function run() {
  const pickupOverview = buildFulfillmentReadFields({
    subscription: pickupSubscription(),
    pickupLocations,
    lang: "ar",
    fulfillmentState: { planningReady: true, fulfillmentReady: true, isFulfillable: true },
  });
  assert.strictEqual(pickupOverview.deliveryMode, "pickup");
  assert(pickupOverview.pickupLocation, "pickup summary should resolve location");
  assert.strictEqual(pickupOverview.pickupLocation.name, "فرع الرياض الشمالي");
  assert.strictEqual(pickupOverview.pickupLocation.address.includes("طريق الملك فهد"), true);
  assert.strictEqual(pickupOverview.deliveryAddress, null, "pickup must not fake pickupLocation from deliveryAddress");
  assert(pickupOverview.fulfillmentSummary.message, "pickup summary should include friendly message");
  assertNoRawCodes(pickupOverview.fulfillmentSummary, "pickup overview");

  const missingPickup = buildFulfillmentReadFields({
    subscription: pickupSubscription({ pickupLocationId: "missing_branch" }),
    pickupLocations,
    lang: "ar",
  });
  assert.strictEqual(missingPickup.pickupLocation, null);
  assert.strictEqual(missingPickup.fulfillmentSummary.lockedMessage, "تفاصيل الفرع غير متاحة حاليًا");
  assertNoRawCodes(missingPickup.fulfillmentSummary, "missing pickup");

  const deliveryOverview = buildFulfillmentReadFields({
    subscription: deliverySubscription(),
    lang: "ar",
    fulfillmentState: { planningReady: true, fulfillmentReady: true, isFulfillable: true },
  });
  assert.strictEqual(deliveryOverview.deliveryMode, "delivery");
  assert(deliveryOverview.deliveryAddress, "delivery summary should include address");
  assert(deliveryOverview.deliveryAddress.formatted.includes("Building 12"));
  assert.strictEqual(deliveryOverview.deliveryWindow.label, "4 م - 10 م");
  assert(deliveryOverview.fulfillmentSummary.message, "delivery summary should include friendly message");
  assertNoRawCodes(deliveryOverview.fulfillmentSummary, "delivery overview");

  const timelineDay = buildFulfillmentReadFields({
    subscription: deliverySubscription(),
    day: {
      date: "2026-04-30",
      status: "out_for_delivery",
      deliveryWindowOverride: "13:00-16:00",
      deliveryAddressOverride: {
        line1: "Office Tower",
        district: "KAFD",
        city: "Riyadh",
      },
    },
    lang: "en",
    fulfillmentState: { planningReady: true, fulfillmentReady: true, isFulfillable: true },
    statusLabel: "On the way",
  });
  assert.strictEqual(timelineDay.deliveryWindow.label, "1 PM - 4 PM");
  assert(timelineDay.deliveryAddress.formatted.includes("Office Tower"));
  assert.strictEqual(timelineDay.fulfillmentSummary.statusLabel, "On the way");
  assert.strictEqual(timelineDay.fulfillmentSummary.message, "Your order is on the way");
  assertNoRawCodes(timelineDay.fulfillmentSummary, "timeline day");

  const missingDeliveryAddress = buildFulfillmentReadFields({
    subscription: deliverySubscription({ deliveryAddress: null }),
    lang: "ar",
  });
  assert.strictEqual(missingDeliveryAddress.deliveryAddress, null);
  assert.strictEqual(missingDeliveryAddress.fulfillmentSummary.lockedMessage, "عنوان التوصيل غير متاح حاليًا");

  const missingDeliveryWindow = buildFulfillmentReadFields({
    subscription: deliverySubscription({ deliveryWindow: "", deliverySlot: { type: "delivery", window: "", slotId: "" } }),
    lang: "ar",
  });
  assert.strictEqual(missingDeliveryWindow.deliveryWindow, null);
  assert.strictEqual(missingDeliveryWindow.fulfillmentSummary.lockedMessage, "موعد التوصيل غير محدد بعد");

  const defaultLocation = buildDefaultPickupLocation();
  const defaultCatalog = resolveDeliveryCatalog({
    lang: "en",
    windows: [],
    pickupLocations: [defaultLocation],
  });
  assert.strictEqual(defaultCatalog.pickupLocations[0].name, "Main Branch");
  assert.strictEqual(defaultCatalog.pickupLocations[0].address.line1, "H4GX+JF7, As Salamah, Jeddah 23436, Saudi Arabia");

  const legacyDefaultLocation = {
    ...defaultLocation,
    address: {
      ar: "عنوان الفرع القديم",
      en: "Legacy branch address",
    },
  };
  const resolvedLegacyLocation = resolvePickupLocationSelection([legacyDefaultLocation], "main", "en", []);
  assert.strictEqual(resolvedLegacyLocation.name, "Main Branch");
  assert.strictEqual(resolvedLegacyLocation.address.line1, "Legacy branch address");
  assert(!JSON.stringify(resolvedLegacyLocation).includes("[object Object]"));

  const scalarAddressLocation = resolvePickupLocationSelection([{
    id: "scalar_address",
    name: "Scalar Address Branch",
    address: "Scalar address",
  }], "scalar_address", "en", []);
  assert.strictEqual(scalarAddressLocation.address.line1, "Scalar address");

  const legacySubscription = {
    _id: "legacy_pickup_subscription",
    deliveryMode: "pickup",
    pickupLocationId: "main",
    deliveryAddress: { line1: "[object Object]" },
    contractHash: "immutable_hash",
    contractSnapshot: {
      delivery: {
        pickupLocationId: "main",
        address: { line1: "[object Object]" },
      },
    },
  };
  const repairedSubscription = repairLegacyPickupSubscriptionReadView(
    legacySubscription,
    [legacyDefaultLocation],
    "en"
  );
  assert.strictEqual(repairedSubscription.deliveryAddress.line1, "Legacy branch address");
  assert.strictEqual(repairedSubscription.contractSnapshot.delivery.address.line1, "Legacy branch address");
  assert.strictEqual(repairedSubscription.contractHash, "immutable_hash");
  assert.strictEqual(legacySubscription.deliveryAddress.line1, "[object Object]");
  assert.strictEqual(legacySubscription.contractSnapshot.delivery.address.line1, "[object Object]");

  const lockedSnapshotDetails = buildLockedOperationalSnapshotDetails({
    deliveryMode: "pickup",
    pickupLocationId: "main",
    deliveryAddress: { line1: "[object Object]" },
  }, null, {
    pickupLocations: [legacyDefaultLocation],
  });
  assert.strictEqual(lockedSnapshotDetails.pickupLocationName, "الفرع الرئيسي");
  assert.strictEqual(lockedSnapshotDetails.pickupAddress.line1, "عنوان الفرع القديم");

  console.log("fulfillmentContract.test.js passed");
}

run();
