const { formatInTimeZone, toDate } = require("date-fns-tz");
const { addDays } = require("date-fns");
const { env } = require("../config/env");

const KSA_TIMEZONE = env.timezone || "Asia/Riyadh";

function getCurrentKSA() {
    return toDate(new Date(), { timeZone: KSA_TIMEZONE });
}

function toKSADateString(date) {
    return formatInTimeZone(date, KSA_TIMEZONE, "yyyy-MM-dd");
}

function formatKSA(date, pattern = "yyyy-MM-dd HH:mm:ss") {
    return formatInTimeZone(date, KSA_TIMEZONE, pattern);
}

function getTodayKSADate() {
    return toKSADateString(getCurrentKSA());
}

function getTomorrowKSADate() {
    return toKSADateString(addDays(getCurrentKSA(), 1));
}

function isValidTimeString(timeStr) {
    return typeof timeStr === "string" && /^\d{2}:\d{2}$/.test(timeStr);
}

function toMinutes(timeStr) {
    const [hours, minutes] = String(timeStr || "").split(":").map(Number);
    return (hours * 60) + minutes;
}

function buildUtcDateFromKsaDateString(dateStr) {
    const [year, month, day] = String(dateStr || "").split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDateAsDateString(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function addDaysToKSADateString(dateStr, days) {
    const base = buildUtcDateFromKsaDateString(dateStr);
    if (Number.isNaN(base.getTime())) {
        return "";
    }
    base.setUTCDate(base.getUTCDate() + Number(days || 0));
    return formatUtcDateAsDateString(base);
}

function isBeforeCutoff(cutoffTimeStr) {
    // CR-10 FIX: Validate cutoff format before parsing
    if (!isValidTimeString(cutoffTimeStr)) {
        throw new Error("Invalid cutoff format. Expected HH:mm");
    }

    const nowTime = formatInTimeZone(new Date(), KSA_TIMEZONE, "HH:mm");
    return toMinutes(nowTime) < toMinutes(cutoffTimeStr);
}

function isCurrentTimeWithinWindow(openTimeStr, closeTimeStr) {
    if (!isValidTimeString(openTimeStr) || !isValidTimeString(closeTimeStr)) {
        throw new Error("Invalid time format. Expected HH:mm");
    }

    const openMinutes = toMinutes(openTimeStr);
    const closeMinutes = toMinutes(closeTimeStr);
    const nowTime = formatInTimeZone(new Date(), KSA_TIMEZONE, "HH:mm");
    const currentMinutes = toMinutes(nowTime);

    if (openMinutes === closeMinutes) {
        return true;
    }

    if (closeMinutes > openMinutes) {
        return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
    }

    return currentMinutes >= openMinutes || currentMinutes < closeMinutes;
}

function getCurrentBusinessDate(openTimeStr, closeTimeStr) {
    if (!isValidTimeString(openTimeStr) || !isValidTimeString(closeTimeStr)) {
        throw new Error("Invalid time format. Expected HH:mm");
    }

    const today = getTodayKSADate();
    const openMinutes = toMinutes(openTimeStr);
    const closeMinutes = toMinutes(closeTimeStr);
    const nowTime = formatInTimeZone(new Date(), KSA_TIMEZONE, "HH:mm");
    const currentMinutes = toMinutes(nowTime);

    if (openMinutes === closeMinutes) {
        return today;
    }

    if (closeMinutes < openMinutes && currentMinutes < closeMinutes) {
        return addDaysToKSADateString(today, -1);
    }

    return today;
}

function compareKSADateStrings(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

function isAfterKSADate(a, b) {
    return compareKSADateStrings(a, b) > 0;
}

function isBeforeKSADate(a, b) {
    return compareKSADateStrings(a, b) < 0;
}

function isOnOrAfterKSADate(a, b) {
    return compareKSADateStrings(a, b) >= 0;
}

function isValidKSADateString(dateStr) {
    // MEDIUM AUDIT FIX: Regex alone accepts impossible dates (e.g., 2026-02-31), so round-trip through a KSA (+03:00) date parse.
    if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return false;
    }
    const parsed = new Date(`${dateStr}T00:00:00+03:00`);
    if (Number.isNaN(parsed.getTime())) {
        return false;
    }
    return toKSADateString(parsed) === dateStr;
}

function isInSubscriptionRange(dateStr, endDate) {
    if (!endDate) return true;
    const endStr = toKSADateString(endDate);
    return compareKSADateStrings(dateStr, endStr) <= 0;
}

// CR-09 FIX: Add lower bound validation (date must be >= today)
function isOnOrAfterTodayKSADate(dateStr) {
    const today = getTodayKSADate();
    return compareKSADateStrings(dateStr, today) >= 0;
}

module.exports = {
    KSA_TIMEZONE,
    getCurrentKSA,
    formatKSA,
    getTodayKSADate,
    getTomorrowKSADate,
    isBeforeCutoff,
    isCurrentTimeWithinWindow,
    getCurrentBusinessDate,
    toMinutes,
    toKSADateString,
    compareKSADateStrings,
    isAfterKSADate,
    isBeforeKSADate,
    isOnOrAfterKSADate,
    isValidKSADateString,
    isInSubscriptionRange,
    isOnOrAfterTodayKSADate,
    addDaysToKSADateString,
    isValidTimeString,
};
