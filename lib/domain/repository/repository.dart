import 'package:basic_diet/data/request/bulk_selections_request.dart';
import 'package:basic_diet/data/request/day_selection_request.dart';
import 'package:basic_diet/data/network/failure.dart';
import 'package:basic_diet/domain/model/checkout_draft_model.dart';
import 'package:basic_diet/domain/model/auth_model.dart';
import 'package:basic_diet/domain/model/base__model.dart';
import 'package:basic_diet/domain/model/delivery_options_model.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/domain/model/popular_packages_model.dart';
import 'package:basic_diet/domain/model/premium_meals_model.dart';
import 'package:basic_diet/domain/model/subscription_checkout_model.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';
import 'package:dartz/dartz.dart';

import 'package:basic_diet/domain/model/add_ons_model.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/domain/model/freeze_subscription_model.dart';
import 'package:basic_diet/data/request/skip_days_request.dart';
import 'package:basic_diet/data/response/skip_days_response.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/domain/model/categories_with_meals_model.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/domain/model/premium_payment_model.dart';
import 'package:basic_diet/domain/model/cancel_subscription_model.dart';

import 'package:basic_diet/domain/model/pickup_prepare_model.dart';
import 'package:basic_diet/domain/model/pickup_status_model.dart';

import '../model/bulk_selections_model.dart';

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
  Future<Either<Failure, DeliveryOptionsModel>> getDeliveryOptions();
  Future<Either<Failure, SubscriptionQuoteModel>> getSubscriptionQuote(
    SubscriptionQuoteRequestModel request,
  );
  Future<Either<Failure, SubscriptionCheckoutModel>> checkoutSubscription(
    SubscriptionCheckoutRequestModel request,
  );
  Future<Either<Failure, CurrentSubscriptionOverviewModel>>
  getCurrentSubscriptionOverview();
  Future<Either<Failure, FreezeSubscriptionModel>> freezeSubscription(
    String id,
    FreezeSubscriptionRequestModel request,
  );
  Future<Either<Failure, SkipDaysResponse>> skipDay(
    String id,
    SkipDayRequest request,
  );
  Future<Either<Failure, SkipDaysResponse>> skipDateRange(
    String id,
    SkipDateRangeRequest request,
  );
  Future<Either<Failure, TimelineModel>> getSubscriptionTimeline(String id);
  Future<Either<Failure, CategoriesWithMealsModel>> getCategoriesWithMeals();
  Future<Either<Failure, MealPlannerMenuModel>> getMealPlannerMenu();
  Future<Either<Failure, CheckoutDraftModel>> getCheckoutDraft(String id);
  Future<Either<Failure, BulkSelectionsModel>> bulkSelections(
    String id,
    BulkSelectionsRequest request,
  );
  Future<Either<Failure, ValidationResultModel>> validateDaySelection(
    String id,
    String date,
    DaySelectionRequest request,
  );
  Future<Either<Failure, SubscriptionDayModel>> saveDaySelection(
    String id,
    String date,
    DaySelectionRequest request,
  );
  Future<Either<Failure, SubscriptionDayModel>> getSubscriptionDay(
    String id,
    String date,
  );
  Future<Either<Failure, BaseModel>> confirmDaySelection(
    String id,
    String date,
  );
  Future<Either<Failure, PickupPrepareModel>> preparePickup(
    String id,
    String date,
  );
  Future<Either<Failure, PickupStatusModel>> getPickupStatus(
    String id,
    String date,
  );
  Future<Either<Failure, PremiumPaymentModel>> createPremiumPayment(
    String subscriptionId,
    String date,
  );
  Future<Either<Failure, PremiumPaymentVerificationModel>> verifyPremiumPayment(
    String subscriptionId,
    String date,
    String paymentId,
  );
  Future<Either<Failure, CancelSubscriptionModel>> cancelSubscription(
    String subscriptionId,
  );
}
