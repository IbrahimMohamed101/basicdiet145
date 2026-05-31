const DEFAULT_PICKUP_WINDOW = "18:00-20:00";

const DEFAULT_PICKUP_LOCATION = Object.freeze({
  id: "main",
  key: "main",
  code: "main",
  slug: "main",
  branchId: "main",
  pickupLocationId: "main",
  name: {
    ar: "الفرع الرئيسي",
    en: "Main Branch",
  },
  title: {
    ar: "الفرع الرئيسي",
    en: "Main Branch",
  },
  address: {
    ar: "H4GX+JF7، السلامة، جدة 23436، المملكة العربية السعودية",
    en: "H4GX+JF7, As Salamah, Jeddah 23436, Saudi Arabia",
    line1: {
      ar: "H4GX+JF7، السلامة، جدة 23436، المملكة العربية السعودية",
      en: "H4GX+JF7, As Salamah, Jeddah 23436, Saudi Arabia",
    },
  },
  isActive: true,
  active: true,
  enabled: true,
  isAvailable: true,
  available: true,
  pickupEnabled: true,
  isPickupEnabled: true,
  supportsPickup: true,
  pickupWindows: [DEFAULT_PICKUP_WINDOW],
  windows: [DEFAULT_PICKUP_WINDOW],
});

function buildDefaultPickupLocation() {
  return {
    ...DEFAULT_PICKUP_LOCATION,
    name: { ...DEFAULT_PICKUP_LOCATION.name },
    title: { ...DEFAULT_PICKUP_LOCATION.title },
    address: {
      ...DEFAULT_PICKUP_LOCATION.address,
      line1: { ...DEFAULT_PICKUP_LOCATION.address.line1 },
    },
    pickupWindows: [...DEFAULT_PICKUP_LOCATION.pickupWindows],
    windows: [...DEFAULT_PICKUP_LOCATION.windows],
  };
}

module.exports = {
  DEFAULT_PICKUP_LOCATION,
  DEFAULT_PICKUP_WINDOW,
  buildDefaultPickupLocation,
};
