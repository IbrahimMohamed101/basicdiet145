import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/response/auth_response.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';
import 'package:basic_diet/data/response/plans_response.dart';
import 'package:basic_diet/data/response/popular_packages_response.dart';
import 'package:basic_diet/data/response/premium_meals_response.dart';
import 'package:retrofit/retrofit.dart';
import 'package:dio/dio.dart';
part 'app_api.g.dart';

@RestApi(baseUrl: Constants.baseUrl)
abstract class AppServiceClient {
  factory AppServiceClient(Dio dio, {String? baseUrl}) = _AppServiceClient;

  @POST("/api/app/login")
  Future<BaseResponse> login(@Field("phoneE164") String phone);

  @POST("/api/auth/otp/verify")
  Future<AuthenticationResponse> verifyOtp(
    @Field("phoneE164") String phone,
    @Field("otp") String otp,
  );

  @POST("/api/app/register")
  Future<BaseResponse> register(
    @Field("fullName") String fullName,
    @Field("phoneE164") String phone,
    @Field("email") String? email,
  );

  @GET("/api/plans")
  Future<PlansResponse> getPlans();

  @GET("/api/popular_packages")
  Future<PopularPackagesResponse> getPopularPackages();

  @GET("/api/premium-meals")
  Future<PremiumMealsResponse> getPremiumMeals();
}
