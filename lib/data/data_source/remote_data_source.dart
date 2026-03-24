import 'package:basic_diet/data/response/auth_response.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';
import 'package:basic_diet/data/response/plans_response.dart';
import 'package:basic_diet/data/response/popular_packages_response.dart';
import 'package:basic_diet/data/response/premium_meals_response.dart';

abstract class RemoteDataSource {
  Future<BaseResponse> login(String phone);
  Future<AuthenticationResponse> verifyOtp(String phone, String otp);
  Future<BaseResponse> register(String fullName, String phone, String? email);
  Future<PlansResponse> getPlans();
  Future<PopularPackagesResponse> getPopularPackages();
  Future<PremiumMealsResponse> getPremiumMeals();
}
