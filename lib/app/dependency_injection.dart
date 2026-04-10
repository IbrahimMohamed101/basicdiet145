import 'package:basic_diet/data/data_source/remote_data_source.dart';
import 'package:basic_diet/data/data_source/remote_data_source_impl.dart';
import 'package:basic_diet/data/network/app_api.dart';
import 'package:basic_diet/data/network/dio_factory.dart';
import 'package:basic_diet/data/repository/repository.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/login_usecase.dart';
import 'package:basic_diet/domain/usecase/verify_otp_usecase.dart';
import 'package:basic_diet/domain/usecase/checkout_subscription_usecase.dart';
import 'package:basic_diet/domain/usecase/get_plans_usecase.dart';
import 'package:basic_diet/domain/usecase/get_delivery_options_usecase.dart';
import 'package:basic_diet/domain/usecase/get_subscription_quote_usecase.dart';
import 'package:basic_diet/presentation/login/login_bloc.dart';
import 'package:basic_diet/presentation/verify/verify_bloc.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_bloc.dart';
import 'package:basic_diet/domain/usecase/register_usecase.dart';
import 'package:basic_diet/domain/usecase/get_popular_packages_usecase.dart';
import 'package:basic_diet/domain/usecase/get_premium_meals_usecase.dart';
import 'package:basic_diet/presentation/register/register_bloc.dart';
import 'package:basic_diet/presentation/main/home/bloc/home_bloc.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_bloc.dart';
import 'package:basic_diet/domain/usecase/get_addons_usecase.dart';
import 'package:basic_diet/presentation/main/home/add-ons/bloc/add_ons_bloc.dart';
import 'package:basic_diet/presentation/main/home/delivery/bloc/delivery_options_bloc.dart';
import 'package:dio/dio.dart';
import 'package:basic_diet/app/app_pref.dart';
import 'package:basic_diet/domain/usecase/get_current_subscription_overview_usecase.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_bloc.dart';
import 'package:basic_diet/domain/usecase/freeze_subscription_usecase.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/freeze/freeze_subscription_bloc.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/skip/skip_days_bloc.dart';
import 'package:basic_diet/domain/usecase/skip_day_usecase.dart';
import 'package:basic_diet/domain/usecase/skip_date_range_usecase.dart';
import 'package:basic_diet/domain/usecase/get_timeline_usecase.dart';
import 'package:basic_diet/domain/usecase/get_categories_with_meals_usecase.dart';
import 'package:basic_diet/presentation/plans/timeline/bloc/timeline_bloc.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:get_it/get_it.dart';

final instance = GetIt.instance; // Singleton instance of GetIt
Future<void> initAppModule() async {
  instance.registerLazySingleton<AppPreferences>(
    // () => AppPreferences(instance<FlutterSecureStorage>()),
    () => AppPreferences(),
  );

  instance.registerLazySingleton<DioFactory>(
    () => DioFactory(instance<AppPreferences>()),
  );

  Dio dio = await instance<DioFactory>().createConfiguredDio();
  instance.registerLazySingleton<AppServiceClient>(() => AppServiceClient(dio));

  instance.registerLazySingleton<RemoteDataSource>(
    () => RemoteDataSourceImpl(instance<AppServiceClient>()),
  );

  instance.registerLazySingleton<Repository>(
    () => RepositoryImpl(instance<RemoteDataSource>()),
  );
}

// This function has all the dependencies that are used in the login module.
void initLoginModule() {
  if (!GetIt.I.isRegistered<LoginUseCase>()) {
    instance.registerFactory<LoginUseCase>(
      () => LoginUseCase(instance<Repository>()),
    );

    instance.registerFactory<LoginBloc>(
      () => LoginBloc(instance<LoginUseCase>()),
    );

    // instance.registerFactory<LoginViewModel>(
    //   () => LoginViewModel(instance<LoginUseCase>()),
    // );
  }
}

void initRegisterModule() {
  if (!GetIt.I.isRegistered<RegisterUseCase>()) {
    instance.registerFactory<RegisterUseCase>(
      () => RegisterUseCase(instance<Repository>()),
    );

    instance.registerFactory<RegisterBloc>(
      () => RegisterBloc(instance<RegisterUseCase>()),
    );
  }
}

void initVerifyModule() {
  if (!GetIt.I.isRegistered<VerifyOtpUseCase>()) {
    instance.registerFactory<VerifyOtpUseCase>(
      () => VerifyOtpUseCase(instance<Repository>()),
    );

    instance.registerFactory<VerifyBloc>(
      () =>
          VerifyBloc(instance<VerifyOtpUseCase>(), instance<AppPreferences>()),
    );
  }
}

void initSubscriptionModule() {
  if (!GetIt.I.isRegistered<GetPlansUseCase>()) {
    instance.registerFactory<GetPlansUseCase>(
      () => GetPlansUseCase(instance<Repository>()),
    );

    instance.registerFactory<GetSubscriptionQuoteUseCase>(
      () => GetSubscriptionQuoteUseCase(instance<Repository>()),
    );

    instance.registerFactory<CheckoutSubscriptionUseCase>(
      () => CheckoutSubscriptionUseCase(instance<Repository>()),
    );

    instance.registerFactory<SubscriptionBloc>(
      () => SubscriptionBloc(
        instance<GetPlansUseCase>(),
        instance<GetSubscriptionQuoteUseCase>(),
        instance<CheckoutSubscriptionUseCase>(),
      ),
    );
  }
}

void initHomeModule() {
  if (!GetIt.I.isRegistered<GetPopularPackagesUseCase>()) {
    instance.registerFactory<GetPopularPackagesUseCase>(
      () => GetPopularPackagesUseCase(instance<Repository>()),
    );

    instance.registerFactory<HomeBloc>(
      () => HomeBloc(instance<GetPopularPackagesUseCase>()),
    );
  }
}

void initPremiumMealsModule() {
  if (!GetIt.I.isRegistered<GetPremiumMealsUseCase>()) {
    instance.registerFactory<GetPremiumMealsUseCase>(
      () => GetPremiumMealsUseCase(instance<Repository>()),
    );

    instance.registerFactory<PremiumMealsBloc>(
      () => PremiumMealsBloc(instance<GetPremiumMealsUseCase>()),
    );
  }
}

void initAddOnsModule() {
  if (!GetIt.I.isRegistered<GetAddOnsUseCase>()) {
    instance.registerFactory<GetAddOnsUseCase>(
      () => GetAddOnsUseCase(instance<Repository>()),
    );

    instance.registerFactory<AddOnsBloc>(
      () => AddOnsBloc(instance<GetAddOnsUseCase>()),
    );
  }
}

void initDeliveryOptionsModule() {
  if (!GetIt.I.isRegistered<GetDeliveryOptionsUseCase>()) {
    instance.registerFactory<GetDeliveryOptionsUseCase>(
      () => GetDeliveryOptionsUseCase(instance<Repository>()),
    );

    instance.registerFactory<DeliveryOptionsBloc>(
      () => DeliveryOptionsBloc(instance<GetDeliveryOptionsUseCase>()),
    );
  }
}

void initPlansModule() {
  if (!GetIt.I.isRegistered<GetCurrentSubscriptionOverviewUseCase>()) {
    instance.registerFactory<GetCurrentSubscriptionOverviewUseCase>(
      () => GetCurrentSubscriptionOverviewUseCase(instance<Repository>()),
    );

    instance.registerFactory<PlansBloc>(
      () => PlansBloc(instance<GetCurrentSubscriptionOverviewUseCase>()),
    );
  }
}

void initFreezeSubscriptionModule() {
  if (!GetIt.I.isRegistered<FreezeSubscriptionUseCase>()) {
    instance.registerFactory<FreezeSubscriptionUseCase>(
      () => FreezeSubscriptionUseCase(instance<Repository>()),
    );

    instance.registerFactory<FreezeSubscriptionBloc>(
      () => FreezeSubscriptionBloc(instance<FreezeSubscriptionUseCase>()),
    );
  }
}

void initSkipDaysModule() {
  if (!GetIt.I.isRegistered<SkipDayUseCase>()) {
    instance.registerFactory<SkipDayUseCase>(() => SkipDayUseCase(instance()));
  }
  if (!GetIt.I.isRegistered<SkipDateRangeUseCase>()) {
    instance.registerFactory<SkipDateRangeUseCase>(
      () => SkipDateRangeUseCase(instance()),
    );
  }
  if (!GetIt.I.isRegistered<SkipDaysBloc>()) {
    instance.registerFactory<SkipDaysBloc>(
      () => SkipDaysBloc(instance(), instance()),
    );
  }
}

void initTimelineModule() {
  if (!GetIt.I.isRegistered<GetTimelineUseCase>()) {
    instance.registerFactory<GetTimelineUseCase>(
      () => GetTimelineUseCase(instance<Repository>()),
    );
  }

  if (!GetIt.I.isRegistered<TimelineBloc>()) {
    instance.registerFactory<TimelineBloc>(
      () => TimelineBloc(instance<GetTimelineUseCase>()),
    );
  }
}

void initMealPlannerModule() {
  if (!GetIt.I.isRegistered<GetCategoriesWithMealsUseCase>()) {
    instance.registerFactory<GetCategoriesWithMealsUseCase>(
      () => GetCategoriesWithMealsUseCase(instance<Repository>()),
    );
  }

  if (!GetIt.I.isRegistered<MealPlannerBloc>()) {
    instance.registerFactoryParam<MealPlannerBloc, Map<String, dynamic>, void>(
      (params, _) => MealPlannerBloc(
        instance(),
        initialTimelineDays: params['timelineDays'],
        initialDayIndex: params['initialDayIndex'],
        premiumMealsRemaining: params['premiumMealsRemaining'],
      ),
    );
  }
}
