export type TimelineDayStatus =
  | "open"
  | "planned"
  | "locked"
  | "delivered"
  | "delivery_canceled"
  | "frozen"
  | "skipped"
  | "extension";

export type TimelineDaySource = "base" | "freeze_compensation" | "skip_compensation";

export type TimelineLocalizedText = {
  ar: string;
  en: string;
};

export type TimelineCalendarMeta = {
  year: number;
  dayOfMonth: number;
  weekday: {
    index: number;
    key: string;
    labels: TimelineLocalizedText;
    shortLabels: TimelineLocalizedText;
  };
  month: {
    number: number;
    key: string;
    labels: TimelineLocalizedText;
    shortLabels: TimelineLocalizedText;
  };
  monthYearLabels: TimelineLocalizedText;
  fullDateLabels: TimelineLocalizedText;
};

export type TimelineDailyMeals = {
  selected: number;
  required: number;
  remaining: number;
  isComplete: boolean;
  titleLabels: TimelineLocalizedText;
  requiredLabels: TimelineLocalizedText;
  summaryLabels: TimelineLocalizedText;
};

export type TimelineDay = {
  date: string;
  status: TimelineDayStatus;
  source: TimelineDaySource;
  locked: boolean;
  isExtension: boolean;
  calendar: TimelineCalendarMeta;
  meals: {
    selected: number;
    required: number;
    isSatisfied: boolean;
  };
  dailyMeals: TimelineDailyMeals;
};

export type SubscriptionTimeline = {
  subscriptionId: string;
  validity: {
    startDate: string;
    endDate: string;
    validityEndDate: string;
    compensationDays: number;
    freezeCompensationDays?: number;
    skipCompensationDays?: number;
  };
  months: Array<{
    key: string;
    year: number;
    month: {
      number: number;
      key: string;
      labels: TimelineLocalizedText;
      shortLabels: TimelineLocalizedText;
    };
    monthYearLabels: TimelineLocalizedText;
    dayCount: number;
  }>;
  dailyMealsConfig: {
    required: number;
    labels: TimelineLocalizedText;
    titleLabels: TimelineLocalizedText;
  };
  days: TimelineDay[];
};
