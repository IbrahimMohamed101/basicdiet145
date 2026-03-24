import 'package:basic_diet/data/network/app_api.dart';
import 'package:basic_diet/data/response/auth_response.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';
import 'package:basic_diet/data/response/plans_response.dart';
import 'package:basic_diet/data/response/popular_packages_response.dart';
import 'package:basic_diet/data/response/premium_meals_response.dart';
import 'remote_data_source.dart';

class RemoteDataSourceImpl implements RemoteDataSource {
  final AppServiceClient _appServiceClient;

  RemoteDataSourceImpl(this._appServiceClient);

  @override
  Future<BaseResponse> login(String phone) async {
    return await _appServiceClient.login(phone);
  }

  @override
  Future<AuthenticationResponse> verifyOtp(String phone, String otp) async {
    return _appServiceClient.verifyOtp(phone, otp);
  }

  @override
  Future<BaseResponse> register(
    String fullName,
    String phone,
    String? email,
  ) async {
    return await _appServiceClient.register(fullName, phone, email);
  }

  @override
  Future<PlansResponse> getPlans() {
    return _appServiceClient.getPlans();
  }

  @override
  Future<PopularPackagesResponse> getPopularPackages() {
    return _appServiceClient.getPopularPackages();
  }

  @override
  Future<PremiumMealsResponse> getPremiumMeals() {
    return _appServiceClient.getPremiumMeals();
  }
}
