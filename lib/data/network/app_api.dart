import 'package:basic_diet/data/request/bulk_selections_request.dart';
import 'package:basic_diet/app/constants.dart';
import 'package:basic_diet/data/response/checkout_draft_response.dart';
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
import 'package:basic_diet/data/response/freeze_subscription_response.dart';
import 'package:basic_diet/data/request/freeze_subscription_request.dart';
import 'package:basic_diet/data/request/skip_days_request.dart';
import 'package:basic_diet/data/response/skip_days_response.dart';
import 'package:basic_diet/data/response/timeline_response.dart';
import 'package:basic_diet/data/response/categories_with_meals_response.dart';
import 'package:basic_diet/data/response/pickup_prepare_response.dart';
import 'package:basic_diet/data/response/pickup_status_response.dart';
import 'package:basic_diet/data/response/meal_planner_menu_response.dart';
import 'package:basic_diet/data/response/premium_payment_response.dart';
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

  @GET("/api/builder/premium-meals")
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

  @POST("/api/subscriptions/{id}/freeze")
  Future<FreezeSubscriptionResponse> freezeSubscription(
    @Path("id") String id,
    @Body() FreezeSubscriptionRequest request,
  );

  @POST("/api/subscriptions/{id}/days/skip")
  Future<SkipDaysResponse> skipDay(
    @Path("id") String id,
    @Body() SkipDayRequest request,
  );

  @POST("/api/subscriptions/{id}/skip-range")
  Future<SkipDaysResponse> skipDateRange(
    @Path("id") String id,
    @Body() SkipDateRangeRequest request,
  );

  @GET("/api/subscriptions/{id}/timeline")
  Future<TimelineResponse> getSubscriptionTimeline(@Path("id") String id);

  @GET("/api/categories-with-meals")
  Future<CategoriesWithMealsResponse> getCategoriesWithMeals();

  @GET("/api/subscriptions/checkout-drafts/{id}")
  Future<CheckoutDraftResponse> getCheckoutDraft(@Path("id") String id);

  @PUT("/api/subscriptions/{id}/days/selections/bulk")
  Future<BaseResponse> bulkSelections(
    @Path("id") String id,
    @Body() BulkSelectionsRequest request,
  );

  @POST("/api/subscriptions/{id}/days/{date}/pickup/prepare")
  Future<PickupPrepareResponse> preparePickup(
    @Path("id") String id,
    @Path("date") String date,
  );

  @GET("/api/subscriptions/{id}/days/{date}/pickup/status")
  Future<PickupStatusResponse> getPickupStatus(
    @Path("id") String id,
    @Path("date") String date,
  );

  @GET("/api/subscriptions/meal-planner-menu")
  Future<MealPlannerMenuResponse> getMealPlannerMenu();

  @POST("/api/subscriptions/{id}/days/{date}/premium-extra/payments")
  Future<PremiumPaymentResponse> createPremiumPayment(
    @Path("id") String subscriptionId,
    @Path("date") String date,
  );

  @POST("/api/subscriptions/{id}/days/{date}/premium-extra/payments/{paymentId}/verify")
  Future<PremiumPaymentVerificationResponse> verifyPremiumPayment(
    @Path("id") String subscriptionId,
    @Path("date") String date,
    @Path("paymentId") String paymentId,
  );
}
