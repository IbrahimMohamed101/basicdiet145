import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/app/functions.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';
import 'package:basic_diet/presentation/login/login_screen.dart';
import 'package:basic_diet/presentation/main/main_screen.dart';
import 'package:basic_diet/presentation/main/home/delivery/delivery_method_screen.dart';
import 'package:basic_diet/presentation/main/home/add-ons/add_ons_screen.dart';
import 'package:basic_diet/presentation/main/home/premium/premium_meals_screen.dart';
import 'package:basic_diet/presentation/main/home/subscription-details/subscription_details_screen.dart';
import 'package:basic_diet/presentation/main/home/subscription/subscription_screen.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_bloc.dart';
import 'package:basic_diet/presentation/onboarding/on_boarding_screen.dart';
import 'package:basic_diet/presentation/register/register_screen.dart';
import 'package:basic_diet/presentation/splash/splash_screen.dart';
import 'package:basic_diet/presentation/verify/verify_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

class GoRouterConfig {
  static GoRouter get router => _router;
  static final GoRouter _router = GoRouter(
    navigatorKey: navigatorKey,
    routes: <RouteBase>[
      GoRoute(
        path: SplashScreen.splashRoute,
        pageBuilder: (BuildContext context, GoRouterState state) =>
            getCustomTransitionPage(state: state, child: SplashScreen()),
      ),
      GoRoute(
        path: OnboardingScreen.routeName,
        pageBuilder: (BuildContext context, GoRouterState state) =>
            getCustomTransitionPage(state: state, child: OnboardingScreen()),
      ),
      GoRoute(
        path: LoginScreen.loginRoute,
        pageBuilder: (BuildContext context, GoRouterState state) {
          initLoginModule();
          return getCustomTransitionPage(state: state, child: LoginScreen());
        },
      ),
      GoRoute(
        path: RegisterScreen.registerRoute,
        pageBuilder: (BuildContext context, GoRouterState state) {
          initRegisterModule();
          return getCustomTransitionPage(state: state, child: RegisterScreen());
        },
      ),
      GoRoute(
        path: VerifyScreen.verifyRoute,
        pageBuilder: (BuildContext context, GoRouterState state) {
          initVerifyModule();
          return getCustomTransitionPage(
            state: state,
            child: VerifyScreen(phoneNumber: state.extra as String?),
          );
        },
      ),
      GoRoute(
        path: MainScreen.mainRoute,
        pageBuilder: (BuildContext context, GoRouterState state) {
          initHomeModule();
          final initialIndex = state.extra is int
              ? state.extra as int
              : MainScreen.homeTabIndex;
          return getCustomTransitionPage(
            state: state,
            child: MainScreen(initialIndex: initialIndex),
          );
        },
      ),
      GoRoute(
        path: SubscriptionScreen.subscriptionRoute,
        pageBuilder: (BuildContext context, GoRouterState state) {
          initSubscriptionModule();
          return getCustomTransitionPage(
            state: state,
            child: SubscriptionScreen(),
          );
        },
      ),
      GoRoute(
        path: PremiumMealsScreen.premiumRoute,
        pageBuilder: (BuildContext context, GoRouterState state) {
          initPremiumMealsModule();
          return getCustomTransitionPage(
            state: state,
            child: BlocProvider.value(
              value: state.extra as SubscriptionBloc,
              child: const PremiumMealsScreen(),
            ),
          );
        },
      ),
      GoRoute(
        path: DeliveryMethodScreen.deliveryMethodRoute,
        pageBuilder: (BuildContext context, GoRouterState state) {
          initDeliveryOptionsModule();
          return getCustomTransitionPage(
            state: state,
            child: BlocProvider.value(
              value: state.extra as SubscriptionBloc,
              child: const DeliveryMethodScreen(),
            ),
          );
        },
      ),
      GoRoute(
        path: AddOnsScreen.addOnsRoute,
        pageBuilder: (BuildContext context, GoRouterState state) {
          initAddOnsModule();
          return getCustomTransitionPage(
            state: state,
            child: BlocProvider.value(
              value: state.extra as SubscriptionBloc,
              child: const AddOnsScreen(),
            ),
          );
        },
      ),
      GoRoute(
        path: SubscriptionDetails.subscriptionDetailsRoute,
        pageBuilder: (BuildContext context, GoRouterState state) {
          final extras = state.extra as Map<String, dynamic>;
          return getCustomTransitionPage(
            state: state,
            child: BlocProvider.value(
              value: extras['bloc'] as SubscriptionBloc,
              child: SubscriptionDetails(
                quote: extras['quote'] as SubscriptionQuoteModel,
                quoteRequest: extras['quoteRequest'] as SubscriptionQuoteRequestModel,
              ),
            ),
          );
        },
      ),
    ],
  );

  static CustomTransitionPage getCustomTransitionPage({
    required GoRouterState state,
    required Widget child,
  }) {
    return CustomTransitionPage(
      key: state.pageKey,
      child: child,
      transitionDuration: Duration.zero,
      reverseTransitionDuration: Duration.zero,
      transitionsBuilder: (context, animation, secondaryAnimation, child) {
        return FadeTransition(
          opacity: CurveTween(curve: Curves.easeInOutCirc).animate(animation),
          child: child,
        );
      },
    );
  }
}
