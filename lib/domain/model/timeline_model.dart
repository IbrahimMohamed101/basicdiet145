class TimelineDayModel {
  final String date;
  final String day;
  final String month;
  final int dayNumber;
  final String status;
  final int selectedMeals;
  final int requiredMeals;

  TimelineDayModel({
    required this.date,
    required this.day,
    required this.month,
    required this.dayNumber,
    required this.status,
    required this.selectedMeals,
    required this.requiredMeals,
  });
}

class TimelineDataModel {
  final String subscriptionId;
  final int dailyMealsRequired;
  final List<TimelineDayModel> days;

  TimelineDataModel({
    required this.subscriptionId,
    required this.dailyMealsRequired,
    required this.days,
  });
}

class TimelineModel {
  final TimelineDataModel data;

  TimelineModel({required this.data});
}
