import 'package:basic_diet/data/response/addons_response.dart';
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
}
