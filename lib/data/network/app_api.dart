import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/request/subscription_checkout_request.dart';
import 'package:basic_diet/data/request/subscription_quote_request.dart';
import 'package:basic_diet/data/response/auth_response.dart';
import 'package:basic_diet/data/response/delivery_options_response.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';
import 'package:basic_diet/data/response/plans_response.dart';
import 'package:basic_diet/data/response/popular_packages_response.dart';
import 'package:basic_diet/data/response/premium_meals_response.dart';
import 'package:basic_diet/data/response/addons_response.dart';
import 'package:basic_diet/data/response/subscription_checkout_response.dart';
import 'package:basic_diet/data/response/subscription_quote_response.dart';
import 'package:basic_diet/data/response/current_subscription_overview_response.dart';
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

  @GET("/api/addons")
  Future<AddOnsResponse> getAddOns();

  @GET("/api/subscriptions/delivery-options")
  Future<DeliveryOptionsResponse> getDeliveryOptions();

  @POST("/api/subscriptions/quote")
  Future<SubscriptionQuoteResponse> getSubscriptionQuote(
    @Body() SubscriptionQuoteRequest request,
  );

  @POST("/api/subscriptions/checkout")
  Future<SubscriptionCheckoutResponse> checkoutSubscription(
    @Body() SubscriptionCheckoutRequest request,
  );

  @GET("/api/subscriptions/current/overview")
  Future<CurrentSubscriptionOverviewResponse> getCurrentSubscriptionOverview();
}
