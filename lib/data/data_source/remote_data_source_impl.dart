import 'package:basic_diet/data/request/bulk_selections_request.dart';
import 'package:basic_diet/data/request/day_selection_request.dart';
import 'package:basic_diet/data/network/app_api.dart';
import 'package:basic_diet/data/response/checkout_draft_response.dart';
import 'package:basic_diet/data/data_source/remote_data_source.dart';
import 'package:basic_diet/data/request/subscription_checkout_request.dart';
import 'package:basic_diet/data/request/subscription_quote_request.dart';
import 'package:basic_diet/data/response/addons_response.dart';
import 'package:basic_diet/data/response/auth_response.dart';
import 'package:basic_diet/data/response/base_response/base_response.dart';
import 'package:basic_diet/data/response/categories_with_meals_response.dart';
import 'package:basic_diet/data/response/validation_response.dart';
import 'package:basic_diet/data/response/subscription_day_response.dart';
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
import 'package:basic_diet/data/response/meal_planner_menu_response.dart';
import 'package:basic_diet/data/response/premium_payment_response.dart';

import 'package:basic_diet/data/response/pickup_prepare_response.dart';
import 'package:basic_diet/data/response/pickup_status_response.dart';
import 'package:basic_diet/data/response/cancel_subscription_response.dart';
import 'package:basic_diet/data/request/cancel_subscription_request.dart';

import '../response/bulk_selections_response.dart';

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

  @override
  Future<AddOnsResponse> getAddOns() {
    return _appServiceClient.getAddOns();
  }

  @override
  Future<DeliveryOptionsResponse> getDeliveryOptions() {
    return _appServiceClient.getDeliveryOptions();
  }

  @override
  Future<SubscriptionQuoteResponse> getSubscriptionQuote(
    SubscriptionQuoteRequest request,
  ) {
    return _appServiceClient.getSubscriptionQuote(request);
  }

  @override
  Future<SubscriptionCheckoutResponse> checkoutSubscription(
    SubscriptionCheckoutRequest request,
  ) {
    return _appServiceClient.checkoutSubscription(request);
  }

  @override
  Future<CurrentSubscriptionOverviewResponse> getCurrentSubscriptionOverview() {
    return _appServiceClient.getCurrentSubscriptionOverview();
  }

  @override
  Future<FreezeSubscriptionResponse> freezeSubscription(
    String id,
    FreezeSubscriptionRequest request,
  ) {
    return _appServiceClient.freezeSubscription(id, request);
  }

  @override
  Future<SkipDaysResponse> skipDay(String id, SkipDayRequest request) {
    return _appServiceClient.skipDay(id, request);
  }

  @override
  Future<SkipDaysResponse> skipDateRange(
    String id,
    SkipDateRangeRequest request,
  ) {
    return _appServiceClient.skipDateRange(id, request);
  }

  @override
  Future<TimelineResponse> getSubscriptionTimeline(String id) {
    return _appServiceClient.getSubscriptionTimeline(id);
  }

  @override
  Future<CategoriesWithMealsResponse> getCategoriesWithMeals() {
    return _appServiceClient.getCategoriesWithMeals();
  }

  @override
  Future<CheckoutDraftResponse> getCheckoutDraft(String id) {
    return _appServiceClient.getCheckoutDraft(id);
  }

  @override
  Future<BulkSelectionsResponse> bulkSelections(String id, BulkSelectionsRequest request) {
    return _appServiceClient.bulkSelections(id, request);
  }

  @override
  Future<ValidationResponse> validateDaySelection(String id, String date, DaySelectionRequest request) {
    return _appServiceClient.validateDaySelection(id, date, request);
  }

  @override
  Future<SubscriptionDayResponse> saveDaySelection(String id, String date, DaySelectionRequest request) {
    return _appServiceClient.saveDaySelection(id, date, request);
  }

  @override
  Future<SubscriptionDayResponse> getSubscriptionDay(String id, String date) {
    return _appServiceClient.getSubscriptionDay(id, date);
  }

  @override
  Future<BaseResponse> confirmDaySelection(String id, String date) {
    return _appServiceClient.confirmDaySelection(id, date);
  }

  @override
  Future<PickupPrepareResponse> preparePickup(String id, String date) {
    return _appServiceClient.preparePickup(id, date);
  }

  @override
  Future<PickupStatusResponse> getPickupStatus(String id, String date) {
    return _appServiceClient.getPickupStatus(id, date);
  }

  @override
  Future<MealPlannerMenuResponse> getMealPlannerMenu() {
    return _appServiceClient.getMealPlannerMenu();
  }

  @override
  Future<PremiumPaymentResponse> createPremiumPayment(String subscriptionId, String date) {
    return _appServiceClient.createPremiumPayment(subscriptionId, date);
  }

  @override
  Future<PremiumPaymentVerificationResponse> verifyPremiumPayment(String subscriptionId, String date, String paymentId) {
    return _appServiceClient.verifyPremiumPayment(subscriptionId, date, paymentId);
  }

  @override
  Future<CancelSubscriptionResponse> cancelSubscription(String id, CancelSubscriptionRequest request) {
    return _appServiceClient.cancelSubscription(id, request);
  }
}
