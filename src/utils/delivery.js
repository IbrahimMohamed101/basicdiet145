function getEffectiveDeliveryDetails(subscription, day) {
  const address =
    (day && day.deliveryAddressOverride && Object.keys(day.deliveryAddressOverride).length > 0)
      ? day.deliveryAddressOverride
      : subscription.deliveryAddress || null;
  const deliveryWindow =
    (day && day.deliveryWindowOverride) ? day.deliveryWindowOverride : subscription.deliveryWindow || null;

  return { address, deliveryWindow };
}

module.exports = { getEffectiveDeliveryDetails };
