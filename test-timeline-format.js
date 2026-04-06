#!/usr/bin/env node
const { localizeTimelineReadPayload } = require("./src/utils/subscriptionReadLocalization");

// Sample timeline data from buildSubscriptionTimeline
const mockTimeline = {
  subscriptionId: "69d1fa3af921ed7dda9a0561",
  validity: {
    startDate: "2026-04-06",
    endDate: "2026-04-08",
    validityEndDate: "2026-04-08",
    compensationDays: 0,
    freezeCompensationDays: 0,
    skipCompensationDays: 0,
  },
  months: [],
  dailyMealsConfig: {
    required: 3,
    labels: {
      ar: "3 وجبات يوميا",
      en: "3 meals/day",
    },
    titleLabels: {
      ar: "الوجبات اليومية",
      en: "Daily Meals",
    },
  },
  days: [
    {
      date: "2026-04-06",
      status: "locked",
      source: "base",
      locked: true,
      isExtension: false,
      calendar: {
        year: 2026,
        dayOfMonth: 6,
        weekday: {
          index: 1,
          key: "monday",
          labels: { ar: "الاثنين", en: "Monday" },
          shortLabels: { ar: "ن", en: "Mon" },
        },
        month: {
          number: 4,
          key: "april",
          labels: { ar: "أبريل", en: "April" },
          shortLabels: { ar: "أبريل", en: "Apr" },
        },
        monthYearLabels: {
          ar: "أبريل 2026",
          en: "April 2026",
        },
        fullDateLabels: {
          ar: "الاثنين، ٦ أبريل ٢٠٢٦",
          en: "Monday, April 6, 2026",
        },
      },
      meals: {
        selected: 3,
        required: 3,
        isSatisfied: true,
      },
      dailyMeals: {
        selected: 3,
        required: 3,
        remaining: 0,
        isComplete: true,
        titleLabels: {
          ar: "الوجبات اليومية",
          en: "Daily Meals",
        },
        requiredLabels: {
          ar: "3 وجبات يوميا",
          en: "3 meals/day",
        },
        summaryLabels: {
          ar: "3 من 3 مختارة",
          en: "3 of 3 selected",
        },
      },
    },
    {
      date: "2026-04-07",
      status: "frozen",
      source: "base",
      locked: false,
      isExtension: false,
      calendar: {
        year: 2026,
        dayOfMonth: 7,
        weekday: {
          index: 2,
          key: "tuesday",
          labels: { ar: "الثلاثاء", en: "Tuesday" },
          shortLabels: { ar: "ث", en: "Tue" },
        },
        month: {
          number: 4,
          key: "april",
          labels: { ar: "أبريل", en: "April" },
          shortLabels: { ar: "أبريل", en: "Apr" },
        },
        monthYearLabels: {
          ar: "أبريل 2026",
          en: "April 2026",
        },
        fullDateLabels: {
          ar: "الثلاثاء، ٧ أبريل ٢٠٢٦",
          en: "Tuesday, April 7, 2026",
        },
      },
      meals: {
        selected: 0,
        required: 3,
        isSatisfied: false,
      },
      dailyMeals: {
        selected: 0,
        required: 3,
        remaining: 3,
        isComplete: false,
        titleLabels: {
          ar: "الوجبات اليومية",
          en: "Daily Meals",
        },
        requiredLabels: {
          ar: "3 وجبات يوميا",
          en: "3 meals/day",
        },
        summaryLabels: {
          ar: "0 من 3 مختارة",
          en: "0 of 3 selected",
        },
      },
    },
    {
      date: "2026-04-08",
      status: "frozen",
      source: "base",
      locked: false,
      isExtension: false,
      calendar: {
        year: 2026,
        dayOfMonth: 8,
        weekday: {
          index: 3,
          key: "wednesday",
          labels: { ar: "الأربعاء", en: "Wednesday" },
          shortLabels: { ar: "ر", en: "Wed" },
        },
        month: {
          number: 4,
          key: "april",
          labels: { ar: "أبريل", en: "April" },
          shortLabels: { ar: "أبريل", en: "Apr" },
        },
        monthYearLabels: {
          ar: "أبريل 2026",
          en: "April 2026",
        },
        fullDateLabels: {
          ar: "الأربعاء، ٨ أبريل ٢٠٢٦",
          en: "Wednesday, April 8, 2026",
        },
      },
      meals: {
        selected: 0,
        required: 3,
        isSatisfied: false,
      },
      dailyMeals: {
        selected: 0,
        required: 3,
        remaining: 3,
        isComplete: false,
        titleLabels: {
          ar: "الوجبات اليومية",
          en: "Daily Meals",
        },
        requiredLabels: {
          ar: "3 وجبات يوميا",
          en: "3 meals/day",
        },
        summaryLabels: {
          ar: "0 من 3 مختارة",
          en: "0 of 3 selected",
        },
      },
    },
  ],
};

// Test with English
const resultEn = localizeTimelineReadPayload(mockTimeline, "en");
console.log("=== English Result ===");
console.log(JSON.stringify(resultEn, null, 2));

// Test with Arabic
const resultAr = localizeTimelineReadPayload(mockTimeline, "ar");
console.log("\n=== Arabic Result ===");
console.log(JSON.stringify(resultAr, null, 2));

// Verify structure
console.log("\n=== Structure Validation ===");
console.log("Has subscriptionId:", !!resultEn.subscriptionId);
console.log("Has dailyMealsRequired:", !!("dailyMealsRequired" in resultEn));
console.log("Has days array:", Array.isArray(resultEn.days));
if (resultEn.days.length > 0) {
  const firstDay = resultEn.days[0];
  console.log("\nFirst day structure:");
  console.log("  - date:", firstDay.date);
  console.log("  - day:", firstDay.day);
  console.log("  - month:", firstDay.month);
  console.log("  - dayNumber:", firstDay.dayNumber);
  console.log("  - status:", firstDay.status);
  console.log("  - selectedMeals:", firstDay.selectedMeals);
  console.log("  - requiredMeals:", firstDay.requiredMeals);
}

console.log("\n✅ Format transformation successful!");
