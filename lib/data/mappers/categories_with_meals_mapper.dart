import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/app/extensions.dart';
import 'package:basic_diet/data/response/categories_with_meals_response.dart';
import 'package:basic_diet/domain/model/categories_with_meals_model.dart';

extension MealItemResponseMapper on MealItemResponse? {
  MealItemModel toDomain() {
    return MealItemModel(
      id: this?.id.orEmpty() ?? Constants.empty,
      name: this?.name.orEmpty() ?? Constants.empty,
      description: this?.description.orEmpty() ?? Constants.empty,
      imageUrl: this?.imageUrl.orEmpty() ?? Constants.empty,
      price: this?.price.orZero() ?? Constants.decimalZero,
      calories: this?.calories.orZero() ?? Constants.zero,
      proteinGrams: this?.proteinGrams.orZero() ?? Constants.zero,
      carbGrams: this?.carbGrams.orZero() ?? Constants.zero,
      fatGrams: this?.fatGrams.orZero() ?? Constants.zero,
      availableForOrder: this?.availableForOrder.orFalse() ?? Constants.falseValue,
      availableForSubscription: this?.availableForSubscription.orFalse() ?? Constants.falseValue,
      type: this?.type.orEmpty() ?? Constants.empty,
      sortOrder: this?.sortOrder.orZero() ?? Constants.zero,
    );
  }
}

extension CategoryWithMealsResponseMapper on CategoryWithMealsResponse? {
  CategoryWithMealsModel toDomain() {
    return CategoryWithMealsModel(
      id: this?.id.orEmpty() ?? Constants.empty,
      name: this?.name.orEmpty() ?? Constants.empty,
      slug: this?.slug.orEmpty() ?? Constants.empty,
      sortOrder: this?.sortOrder.orZero() ?? Constants.zero,
      meals: (this?.meals?.map((e) => e.toDomain()).toList()) ?? [],
    );
  }
}

extension CategoriesWithMealsResponseMapper on CategoriesWithMealsResponse? {
  CategoriesWithMealsModel toDomain() {
    return CategoriesWithMealsModel(
      data: (this?.data?.map((e) => e.toDomain()).toList()) ?? [],
    );
  }
}
