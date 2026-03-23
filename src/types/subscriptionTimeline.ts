export type TimelineDayStatus =
  | "planned"
  | "locked"
  | "delivered"
  | "frozen"
  | "skipped"
  | "extension";

export type TimelineDaySource = "base" | "freeze_compensation";

export type TimelineDay = {
  date: string;
  status: TimelineDayStatus;
  source: TimelineDaySource;
  locked: boolean;
  isExtension: boolean;
};

export type SubscriptionTimeline = {
  subscriptionId: string;
  validity: {
    startDate: string;
    endDate: string;
    validityEndDate: string;
    compensationDays: number;
  };
  days: TimelineDay[];
};
