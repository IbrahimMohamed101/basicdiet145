export type TimelineDayStatus =
  | "open"
  | "planned"
  | "locked"
  | "delivered"
  | "delivery_canceled"
  | "canceled_at_branch"
  | "no_show"
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
  commercialState?: "draft" | "payment_required" | "ready_to_confirm" | "confirmed";
  isFulfillable?: boolean;
  canBePrepared?: boolean;
  paymentRequirement?: {
    status: string;
    requiresPayment: boolean;
    pricingStatus: "not_required" | "priced" | "pending" | "failed";
    blockingReason: string | null;
    canCreatePayment: boolean;
    premiumSelectedCount: number;
    premiumPendingPaymentCount: number;
    pendingAmountHalala: number;
    amountHalala: number;
    currency: string;
  };
  calendar: TimelineCalendarMeta;
  meals: {
    selected: number;
    required: number;
    isSatisfied: boolean;
  };
  dailyMeals: TimelineDailyMeals;
  selectedMealIds?: string[];
  mealSlots?: Array<{
    slotIndex: number;
    slotKey: string;
    status: "empty" | "partial" | "complete";
    proteinId: string | null;
    carbId: string | null;
    isPremium: boolean;
    premiumSource: "none" | "balance" | "pending_payment" | "paid_extra" | "paid";
    premiumExtraFeeHalala: number;
  }>;
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
