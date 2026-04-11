const { formatInTimeZone, toDate } = require("date-fns-tz");
const { addDays } = require("date-fns");

const KSA_TIMEZONE = "Asia/Riyadh";

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
    if (!/^\d{2}:\d{2}$/.test(cutoffTimeStr)) {
        throw new Error("Invalid cutoff format. Expected HH:mm");
    }
    
    const now = getCurrentKSA();
    const [hours, minutes] = cutoffTimeStr.split(":").map(Number);
    const todayStr = toKSADateString(now);
    const cutoff = toDate(`${todayStr} ${cutoffTimeStr}:00`, { timeZone: KSA_TIMEZONE });

    return now < cutoff;
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
    toKSADateString,
    compareKSADateStrings,
    isAfterKSADate,
    isBeforeKSADate,
    isOnOrAfterKSADate,
    isValidKSADateString,
    isInSubscriptionRange,
    isOnOrAfterTodayKSADate,
    addDaysToKSADateString,
};
