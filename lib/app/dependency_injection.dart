import 'package:basic_diet/data/data_source/remote_data_source.dart';
import 'package:basic_diet/data/data_source/remote_data_source_impl.dart';
import 'package:basic_diet/data/network/app_api.dart';
import 'package:basic_diet/data/network/dio_factory.dart';
import 'package:basic_diet/data/repository/repository.dart';
import 'package:basic_diet/domain/repository/repository.dart';
import 'package:basic_diet/domain/usecase/login_usecase.dart';
import 'package:basic_diet/domain/usecase/verify_otp_usecase.dart';
import 'package:basic_diet/domain/usecase/get_plans_usecase.dart';
import 'package:basic_diet/presentation/login/login_bloc.dart';
import 'package:basic_diet/presentation/verify/verify_bloc.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_bloc.dart';
import 'package:basic_diet/domain/usecase/register_usecase.dart';
import 'package:basic_diet/domain/usecase/get_popular_packages_usecase.dart';
import 'package:basic_diet/domain/usecase/get_premium_meals_usecase.dart';
import 'package:basic_diet/presentation/register/register_bloc.dart';
import 'package:basic_diet/presentation/main/home/bloc/home_bloc.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_bloc.dart';
import 'package:dio/dio.dart';
import 'package:basic_diet/app/app_pref.dart';
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
initLoginModule() {
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

initRegisterModule() {
  if (!GetIt.I.isRegistered<RegisterUseCase>()) {
    instance.registerFactory<RegisterUseCase>(
      () => RegisterUseCase(instance<Repository>()),
    );

    instance.registerFactory<RegisterBloc>(
      () => RegisterBloc(instance<RegisterUseCase>()),
    );
  }
}

initVerifyModule() {
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

initSubscriptionModule() {
  if (!GetIt.I.isRegistered<GetPlansUseCase>()) {
    instance.registerFactory<GetPlansUseCase>(
      () => GetPlansUseCase(instance<Repository>()),
    );

    instance.registerFactory<SubscriptionBloc>(
      () => SubscriptionBloc(instance<GetPlansUseCase>()),
    );
  }
}

initHomeModule() {
  if (!GetIt.I.isRegistered<GetPopularPackagesUseCase>()) {
    instance.registerFactory<GetPopularPackagesUseCase>(
      () => GetPopularPackagesUseCase(instance<Repository>()),
    );

    instance.registerFactory<HomeBloc>(
      () => HomeBloc(instance<GetPopularPackagesUseCase>()),
    );
  }
}

initPremiumMealsModule() {
  if (!GetIt.I.isRegistered<GetPremiumMealsUseCase>()) {
    instance.registerFactory<GetPremiumMealsUseCase>(
      () => GetPremiumMealsUseCase(instance<Repository>()),
    );

    instance.registerFactory<PremiumMealsBloc>(
      () => PremiumMealsBloc(instance<GetPremiumMealsUseCase>()),
    );
  }
}
