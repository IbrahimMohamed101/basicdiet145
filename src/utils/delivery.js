const { pickLang } = require("./i18n");
const { resolvePickupLocationSelection } = require("./subscription/subscriptionCatalog");

function getEffectiveDeliveryDetails(subscription, day) {
  const address =
    (day && day.deliveryAddressOverride && Object.keys(day.deliveryAddressOverride).length > 0)
      ? day.deliveryAddressOverride
      : subscription.deliveryAddress || null;
  const deliveryWindow =
    (day && day.deliveryWindowOverride) ? day.deliveryWindowOverride : subscription.deliveryWindow || null;

  return { address, deliveryWindow };
}

function buildLockedOperationalSnapshotDetails(subscription, day, { pickupLocations = [] } = {}) {
  const { address, deliveryWindow } = getEffectiveDeliveryDetails(subscription, day);
  const isPickup = subscription && subscription.deliveryMode === "pickup";

  if (!isPickup) {
    return {
      address,
      deliveryWindow,
      pickupLocationId: null,
      pickupLocationName: "",
      pickupAddress: null,
    };
  }

  const pickupLocationId = subscription && subscription.pickupLocationId
    ? String(subscription.pickupLocationId)
    : "";
  const resolvedPickupLocation = pickupLocationId
    ? resolvePickupLocationSelection(Array.isArray(pickupLocations) ? pickupLocations : [], pickupLocationId, "ar", [])
    : null;
  const pickupAddress = resolvedPickupLocation && resolvedPickupLocation.address
    ? resolvedPickupLocation.address
    : address || null;
  const pickupLocationName = resolvedPickupLocation && resolvedPickupLocation.name
    ? String(resolvedPickupLocation.name)
    : (
      pickLang(pickupAddress && pickupAddress.line1 ? pickupAddress.line1 : "", "ar")
      || pickLang(pickupAddress && pickupAddress.line1 ? pickupAddress.line1 : "", "en")
      || pickupLocationId
    );

  return {
    address,
    deliveryWindow,
    pickupLocationId: pickupLocationId || null,
    pickupLocationName,
    pickupAddress,
  };
}

module.exports = { getEffectiveDeliveryDetails, buildLockedOperationalSnapshotDetails };
