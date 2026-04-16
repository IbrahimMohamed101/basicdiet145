import 'package:basic_diet/data/request/bulk_selections_request.dart';
import 'package:basic_diet/data/response/addons_response.dart';
import 'package:basic_diet/data/response/checkout_draft_response.dart';
import 'package:basic_diet/data/request/subscription_checkout_request.dart';
import 'package:basic_diet/data/request/subscription_quote_request.dart';
import 'package:basic_diet/data/response/auth_response.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';
import 'package:basic_diet/data/response/delivery_options_response.dart';
import 'package:basic_diet/data/response/plans_response.dart';
import 'package:basic_diet/data/response/popular_packages_response.dart';
import 'package:basic_diet/data/response/premium_meals_response.dart';
import 'package:basic_diet/data/response/subscription_checkout_response.dart';
import 'package:basic_diet/data/response/subscription_quote_response.dart';
import 'package:basic_diet/data/response/current_subscription_overview_response.dart';
import 'package:basic_diet/data/request/freeze_subscription_request.dart';
import 'package:basic_diet/data/response/freeze_subscription_response.dart';
import 'package:basic_diet/data/request/skip_days_request.dart';
import 'package:basic_diet/data/response/skip_days_response.dart';
import 'package:basic_diet/data/response/timeline_response.dart';
import 'package:basic_diet/data/response/categories_with_meals_response.dart';
import 'package:basic_diet/data/response/meal_planner_menu_response.dart';

import 'package:basic_diet/data/response/pickup_prepare_response.dart';
import 'package:basic_diet/data/response/pickup_status_response.dart';

abstract class RemoteDataSource {
  Future<BaseResponse> login(String phone);
  Future<AuthenticationResponse> verifyOtp(String phone, String otp);
  Future<BaseResponse> register(String fullName, String phone, String? email);
  Future<PlansResponse> getPlans();
  Future<PopularPackagesResponse> getPopularPackages();
  Future<PremiumMealsResponse> getPremiumMeals();
  Future<AddOnsResponse> getAddOns();
  Future<DeliveryOptionsResponse> getDeliveryOptions();
  Future<SubscriptionQuoteResponse> getSubscriptionQuote(
    SubscriptionQuoteRequest request,
  );
  Future<SubscriptionCheckoutResponse> checkoutSubscription(
    SubscriptionCheckoutRequest request,
  );
  Future<CurrentSubscriptionOverviewResponse> getCurrentSubscriptionOverview();
  Future<FreezeSubscriptionResponse> freezeSubscription(
    String id,
    FreezeSubscriptionRequest request,
  );
  Future<SkipDaysResponse> skipDay(
    String id,
    SkipDayRequest request,
  );
  Future<SkipDaysResponse> skipDateRange(
    String id,
    SkipDateRangeRequest request,
  );
  Future<TimelineResponse> getSubscriptionTimeline(String id);
  Future<CategoriesWithMealsResponse> getCategoriesWithMeals();
  Future<CheckoutDraftResponse> getCheckoutDraft(String id);
  Future<BaseResponse> bulkSelections(String id, BulkSelectionsRequest request);
  Future<PickupPrepareResponse> preparePickup(String id, String date);
  Future<PickupStatusResponse> getPickupStatus(String id, String date);
  Future<MealPlannerMenuResponse> getMealPlannerMenu();
}
