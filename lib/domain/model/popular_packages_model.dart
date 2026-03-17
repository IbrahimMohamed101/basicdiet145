class PopularPackagesModel {
  List<PopularPackageModel> packages;

  PopularPackagesModel({required this.packages});
}

class PopularPackageModel {
  String id;
  String planId;
  String name;
  int daysCount;
  int mealsPerDay;
  int grams;
  double oldPrice;
  double newPrice;
  double moneySave;
  String currency;

  PopularPackageModel({
    required this.id,
    required this.planId,
    required this.name,
    required this.daysCount,
    required this.mealsPerDay,
    required this.grams,
    required this.oldPrice,
    required this.newPrice,
    required this.moneySave,
    required this.currency,
  });
}
