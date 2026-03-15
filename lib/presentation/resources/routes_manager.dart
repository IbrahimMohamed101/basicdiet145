import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/app/functions.dart';
import 'package:basic_diet/presentation/login/login_screen.dart';
import 'package:basic_diet/presentation/main/main_screen.dart';
import 'package:basic_diet/presentation/main/subscription/subscription_screen.dart';
import 'package:basic_diet/presentation/onboarding/on_boarding_screen.dart';
import 'package:basic_diet/presentation/register/register_screen.dart';
import 'package:basic_diet/presentation/splash/splash_screen.dart';
import 'package:basic_diet/presentation/verify/verify_screen.dart';
import 'package:flutter/material.dart';
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
        pageBuilder: (BuildContext context, GoRouterState state) =>
            getCustomTransitionPage(state: state, child: RegisterScreen()),
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
        pageBuilder: (BuildContext context, GoRouterState state) =>
            getCustomTransitionPage(state: state, child: MainScreen()),
      ),
      GoRoute(
        path: SubscriptionScreen.subscriptionRoute,
        pageBuilder: (BuildContext context, GoRouterState state) =>
            getCustomTransitionPage(state: state, child: SubscriptionScreen()),
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
