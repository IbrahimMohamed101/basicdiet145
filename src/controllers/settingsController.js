const Setting = require("../models/Setting");
const { VAT_PERCENTAGE } = require("../config/vat");

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

function pickSetting(data, key, fallback = null) {
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
}

async function getAppConfig(_req, res) {
    const settings = await Setting.find({
        key: {
            $in: [
                "support_phone",
                "support_whatsapp",
                "support_email",
                "payment_provider",
                "pickup_locations",
                "delivery_windows",
                "vat_percentage",
                "restaurant_open_time",
                "restaurant_close_time",
                "cutoff_time",
            ],
        },
    }).lean();
    const data = settings.reduce((acc, s) => {
        acc[s.key] = s.value;
        return acc;
    }, {});

    return res.status(200).json({
        status: true,
        data: {
            support: {
                phone: pickSetting(data, "support_phone"),
                whatsapp: pickSetting(data, "support_whatsapp"),
                email: pickSetting(data, "support_email"),
            },
            features: {
                pickup: true,
                delivery: true,
                subscriptions: true,
                oneTimeOrders: true,
                mealPlanner: true,
            },
            payment: {
                provider: pickSetting(data, "payment_provider", "moyasar"),
                // VAT is system-owned (16%, inclusive). Never read from DB — always hardcoded.
                vatPercentage: VAT_PERCENTAGE,
                callbackMode: "backend_redirect_or_client_url",
            },
            fulfillment: {
                pickupLocations: Array.isArray(data.pickup_locations) ? data.pickup_locations : [],
                deliveryWindows: Array.isArray(data.delivery_windows) ? data.delivery_windows : [],
                restaurantOpenTime: pickSetting(data, "restaurant_open_time", "00:00"),
                restaurantCloseTime: pickSetting(data, "restaurant_close_time", "23:59"),
                cutoffTime: pickSetting(data, "cutoff_time", "00:00"),
            },
            app: {
                minVersion: null,
                latestVersion: null,
            },
        },
    });
}

module.exports = { getSettings, getAppConfig };
