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

function isOnOrAfterKSADate(a, b) {
    return compareKSADateStrings(a, b) >= 0;
}

function isValidKSADateString(dateStr) {
    return typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
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
    isOnOrAfterKSADate,
    isValidKSADateString,
    isInSubscriptionRange,
    isOnOrAfterTodayKSADate,
};
