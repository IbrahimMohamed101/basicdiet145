import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/auth_model.dart';
import 'package:basic_diet/domain/model/base__model.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/domain/model/popular_packages_model.dart';
import 'package:basic_diet/domain/model/premium_meals_model.dart';
import 'package:dartz/dartz.dart';

import 'package:basic_diet/domain/model/add_ons_model.dart';

abstract class Repository {
  Future<Either<Failure, BaseModel>> login(String phone);
  Future<Either<Failure, AuthenticationModel>> verifyOtp(
    String phone,
    String otp,
  );
  Future<Either<Failure, BaseModel>> register(
    String fullName,
    String phone,
    String? email,
  );
  Future<Either<Failure, PlansModel>> getPlans();
  Future<Either<Failure, PopularPackagesModel>> getPopularPackages();
  Future<Either<Failure, PremiumMealsModel>> getPremiumMeals();
  Future<Either<Failure, AddOnsModel>> getAddOns();
}
