const Setting = require("../models/Setting");
const { VAT_PERCENTAGE } = require("../config/vat");

function localizedPair(value, fallback = "") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const ar = String(value.ar || value.en || value.value || fallback || "").trim();
        const en = String(value.en || value.ar || value.value || fallback || "").trim();
        return { ar, en };
    }
    const text = String(value || fallback || "").trim();
    return { ar: text, en: text };
}

function normalizePickupLocation(loc, index) {
    if (!loc || typeof loc !== "object" || Array.isArray(loc)) return null;
    const id = String(loc.id || loc.key || loc.code || loc.slug || loc.branchId || loc.pickupLocationId || loc.locationId || `branch_${index + 1}`).trim();
    const name = localizedPair(loc.name || loc.title || loc.label || loc.branchName, id);
    const rawAddress = loc.address || loc.location || loc.formattedAddress || loc.addressLine || loc.addressLine1 || loc.street || "";
    const addressText = rawAddress && typeof rawAddress === "object" && !Array.isArray(rawAddress)
        ? rawAddress.line1 || rawAddress.street || rawAddress.en || rawAddress.ar || [rawAddress.district, rawAddress.city].filter(Boolean).join(", ")
        : rawAddress;
    const address = localizedPair(rawAddress, addressText || id);
    const latitude = loc.latitude !== undefined ? loc.latitude : loc.lat !== undefined ? loc.lat : rawAddress && rawAddress.lat;
    const longitude = loc.longitude !== undefined ? loc.longitude : loc.lng !== undefined ? loc.lng : rawAddress && rawAddress.lng;
    const isActive = loc.isActive === undefined ? loc.active !== false && loc.enabled !== false : Boolean(loc.isActive);
    const pickupWindows = Array.isArray(loc.pickupWindows)
        ? loc.pickupWindows.map((item) => String(item).trim()).filter(Boolean)
        : Array.isArray(loc.windows)
            ? loc.windows.map((item) => String(item).trim()).filter(Boolean)
            : loc.pickupWindow
                ? [String(loc.pickupWindow).trim()]
                : ["18:00-20:00"];

    const rawWorkingHours = loc.workingHours || loc.hours || null;
    const workingHours = rawWorkingHours && typeof rawWorkingHours === "object" && !Array.isArray(rawWorkingHours)
        ? [rawWorkingHours.open, rawWorkingHours.close].filter(Boolean).join("-") || null
        : rawWorkingHours
            ? String(rawWorkingHours).trim()
            : null;

    return {
        id,
        key: id,
        code: id,
        slug: id,
        branchId: id,
        pickupLocationId: id,
        name,
        title: name,
        address: {
            ar: address.ar,
            en: address.en,
            line1: { ar: address.ar, en: address.en },
            lat: latitude === undefined || latitude === null || latitude === "" ? null : Number(latitude),
            lng: longitude === undefined || longitude === null || longitude === "" ? null : Number(longitude),
        },
        nameAr: name.ar,
        nameEn: name.en,
        addressAr: address.ar,
        addressEn: address.en,
        isActive,
        active: isActive,
        enabled: isActive,
        isAvailable: isActive,
        available: isActive,
        pickupEnabled: isActive,
        isPickupEnabled: isActive,
        supportsPickup: isActive,
        phone: loc.phone ? String(loc.phone).trim() : null,
        isDefault: Boolean(loc.isDefault),
        workingHours,
        hours: workingHours,
        pickupWindows,
        windows: pickupWindows,
        latitude: latitude === undefined || latitude === null || latitude === "" ? null : Number(latitude),
        longitude: longitude === undefined || longitude === null || longitude === "" ? null : Number(longitude),
    };
}

function normalizePickupLocations(value) {
    return (Array.isArray(value) ? value : [])
        .map(normalizePickupLocation)
        .filter(Boolean);
}

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
    data.pickup_locations = normalizePickupLocations(data.pickup_locations);
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
                pickupLocations: normalizePickupLocations(data.pickup_locations),
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
