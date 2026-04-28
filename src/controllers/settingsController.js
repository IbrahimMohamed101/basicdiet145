const Setting = require("../models/Setting");

async function getSettings(_req, res) {
    const settings = await Setting.find().lean();
    const data = settings.reduce((acc, s) => {
        acc[s.key] = s.value;
        return acc;
    }, {});

    // Default values if not set
    data.cutoff_time = data.cutoff_time ?? "00:00";
    data.restaurant_open_time = data.restaurant_open_time ?? "00:00";
    data.restaurant_close_time = data.restaurant_close_time ?? "23:59";
    data.delivery_windows = data.delivery_windows ?? ["08:00-11:00", "12:00-15:00"];
    data.pickup_locations = data.pickup_locations ?? [];
    data.skip_allowance = data.skip_allowance ?? data.skipAllowance;
    data.skip_allowance = data.skip_allowance ?? 3;
    data.premium_price = data.premium_price ?? 20;
    data.subscription_delivery_fee_halala = data.subscription_delivery_fee_halala ?? 0;
    data.vat_percentage = data.vat_percentage ?? 0;
    data.one_time_meal_price = data.one_time_meal_price ?? 25;
    data.one_time_premium_price = data.one_time_premium_price ?? data.one_time_meal_price;
    data.one_time_delivery_fee = data.one_time_delivery_fee ?? 0;
    data.custom_salad_base_price = data.custom_salad_base_price ?? 0;
    data.custom_meal_base_price = data.custom_meal_base_price ?? 0;
    delete data.skipAllowance;

    return res.status(200).json({ status: true, data });
}

module.exports = { getSettings };
