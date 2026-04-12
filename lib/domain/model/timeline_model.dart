class TimelineDayModel {
  final String date;
  final String day;
  final String month;
  final int dayNumber;
  final String status;
  final int selectedMeals;
  final int requiredMeals;
  final List<String> selections;
  final List<String> premiumSelections;

  TimelineDayModel({
    required this.date,
    required this.day,
    required this.month,
    required this.dayNumber,
    required this.status,
    required this.selectedMeals,
    required this.requiredMeals,
    required this.selections,
    required this.premiumSelections,
  });
}

class TimelineDataModel {
  final String subscriptionId;
  final int dailyMealsRequired;
  final int premiumMealsRemaining;
  final List<TimelineDayModel> days;

  TimelineDataModel({
    required this.subscriptionId,
    required this.dailyMealsRequired,
    required this.premiumMealsRemaining,
    required this.days,
  });
}

class TimelineModel {
  final TimelineDataModel data;

  TimelineModel({required this.data});
}
