class CategoriesWithMealsModel {
  List<CategoryWithMealsModel> data;

  CategoriesWithMealsModel({required this.data});
}

class CategoryWithMealsModel {
  String id;
  String name;
  String slug;
  int sortOrder;
  List<MealItemModel> meals;

  CategoryWithMealsModel({
    required this.id,
    required this.name,
    required this.slug,
    required this.sortOrder,
    required this.meals,
  });
}

class MealItemModel {
  String id;
  String name;
  String description;
  String imageUrl;
  double price;
  int calories;
  int proteinGrams;
  int carbGrams;
  int fatGrams;
  bool availableForOrder;
  bool availableForSubscription;
  String type;
  int sortOrder;

  MealItemModel({
    required this.id,
    required this.name,
    required this.description,
    required this.imageUrl,
    required this.price,
    required this.calories,
    required this.proteinGrams,
    required this.carbGrams,
    required this.fatGrams,
    required this.availableForOrder,
    required this.availableForSubscription,
    required this.type,
    required this.sortOrder,
  });
}
