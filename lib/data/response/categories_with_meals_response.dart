import 'package:json_annotation/json_annotation.dart';

part 'categories_with_meals_response.g.dart';

@JsonSerializable()
class CategoriesWithMealsResponse {
  @JsonKey(name: "status")
  dynamic status;
  @JsonKey(name: "data")
  List<CategoryWithMealsResponse>? data;

  CategoriesWithMealsResponse({this.status, this.data});

  factory CategoriesWithMealsResponse.fromJson(Map<String, dynamic> json) =>
      _$CategoriesWithMealsResponseFromJson(json);
  Map<String, dynamic> toJson() => _$CategoriesWithMealsResponseToJson(this);
}

@JsonSerializable()
class CategoryWithMealsResponse {
  @JsonKey(name: "id")
  String? id;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "slug")
  String? slug;
  @JsonKey(name: "sortOrder")
  int? sortOrder;
  @JsonKey(name: "meals")
  List<MealItemResponse>? meals;

  CategoryWithMealsResponse({
    this.id,
    this.name,
    this.slug,
    this.sortOrder,
    this.meals,
  });

  factory CategoryWithMealsResponse.fromJson(Map<String, dynamic> json) =>
      _$CategoryWithMealsResponseFromJson(json);
  Map<String, dynamic> toJson() => _$CategoryWithMealsResponseToJson(this);
}

@JsonSerializable()
class MealItemResponse {
  @JsonKey(name: "id")
  String? id;
  @JsonKey(name: "name")
  String? name;
  @JsonKey(name: "description")
  String? description;
  @JsonKey(name: "imageUrl")
  String? imageUrl;
  @JsonKey(name: "price")
  double? price;
  @JsonKey(name: "calories")
  int? calories;
  @JsonKey(name: "proteinGrams")
  int? proteinGrams;
  @JsonKey(name: "carbGrams")
  int? carbGrams;
  @JsonKey(name: "fatGrams")
  int? fatGrams;
  @JsonKey(name: "availableForOrder")
  bool? availableForOrder;
  @JsonKey(name: "availableForSubscription")
  bool? availableForSubscription;
  @JsonKey(name: "type")
  String? type;
  @JsonKey(name: "sortOrder")
  int? sortOrder;

  MealItemResponse({
    this.id,
    this.name,
    this.description,
    this.imageUrl,
    this.price,
    this.calories,
    this.proteinGrams,
    this.carbGrams,
    this.fatGrams,
    this.availableForOrder,
    this.availableForSubscription,
    this.type,
    this.sortOrder,
  });

  factory MealItemResponse.fromJson(Map<String, dynamic> json) =>
      _$MealItemResponseFromJson(json);
  Map<String, dynamic> toJson() => _$MealItemResponseToJson(this);
}
