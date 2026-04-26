const Setting = require("../models/Setting");
const dateUtils = require("../utils/date");

async function getRestaurantHours() {
  const [openSetting, closeSetting] = await Promise.all([
    Setting.findOne({ key: "restaurant_open_time" }).lean(),
    Setting.findOne({ key: "restaurant_close_time" }).lean(),
  ]);

  const openTime = openSetting && openSetting.value ? String(openSetting.value) : "00:00";
  const closeTime = closeSetting && closeSetting.value ? String(closeSetting.value) : "23:59";

  return {
    openTime,
    closeTime,
    isOpenNow: dateUtils.isCurrentTimeWithinWindow(openTime, closeTime),
    businessDate: dateUtils.getCurrentBusinessDate(openTime, closeTime),
    businessTomorrow: dateUtils.addDaysToKSADateString(
      dateUtils.getCurrentBusinessDate(openTime, closeTime),
      1
    ),
  };
}

async function getRestaurantBusinessDate() {
  const restaurantHours = await getRestaurantHours();
  return restaurantHours.businessDate;
}

async function getRestaurantBusinessTomorrow() {
  const restaurantHours = await getRestaurantHours();
  return restaurantHours.businessTomorrow;
}

module.exports = {
  getRestaurantHours,
  getRestaurantBusinessDate,
  getRestaurantBusinessTomorrow,
};
