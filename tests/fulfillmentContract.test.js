require("dotenv").config();

const assert = require("assert");
const {
  buildFulfillmentReadFields,
} = require("../src/services/subscription/subscriptionFulfillmentSummaryService");

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

  console.log("fulfillmentContract.test.js passed");
}

run();
