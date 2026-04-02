import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/response/popular_packages_response.dart';
import 'package:basic_diet/domain/model/popular_packages_model.dart';

extension PopularPackagesResponseMapper on PopularPackagesResponse? {
  PopularPackagesModel toDomain() {
    return PopularPackagesModel(
      packages: this?.data?.map((package) => package.toDomain()).toList() ?? [],
    );
  }
}

extension PopularPackageResponseMapper on PopularPackageResponse? {
  PopularPackageModel toDomain() {
    return PopularPackageModel(
      id: this?.id ?? Constants.empty,
      planId: this?.planId ?? Constants.empty,
      name: this?.name ?? Constants.empty,
      daysCount: this?.daysCount ?? Constants.zero,
      mealsPerDay: this?.mealsPerDay ?? Constants.zero,
      grams: this?.grams ?? Constants.zero,
      oldPrice: this?.oldPrice ?? 0.0,
      newPrice: this?.newPrice ?? 0.0,
      moneySave: this?.moneySave ?? 0.0,
      currency: this?.currency ?? Constants.empty,
    );
  }
}
