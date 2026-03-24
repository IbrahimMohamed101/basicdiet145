class PremiumMealsModel {
  List<PremiumMealModel> meals;

  PremiumMealsModel({required this.meals});
}

class PremiumMealModel {
  String id;
  String name;
  String description;
  String imageUrl;
  String currency;
  int extraFeeHalala;
  double extraFeeSar;
  int priceHalala;
  double priceSar;
  String priceLabel;
  PremiumMealUiModel ui;

  PremiumMealModel({
    required this.id,
    required this.name,
    required this.description,
    required this.imageUrl,
    required this.currency,
    required this.extraFeeHalala,
    required this.extraFeeSar,
    required this.priceHalala,
    required this.priceSar,
    required this.priceLabel,
    required this.ui,
  });
}

class PremiumMealUiModel {
  String title;
  String subtitle;
  String ctaLabel;
  String selectionStyle;

  PremiumMealUiModel({
    required this.title,
    required this.subtitle,
    required this.ctaLabel,
    required this.selectionStyle,
  });
}
