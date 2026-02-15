import 'package:basic_diet/app/functions.dart';
import 'package:basic_diet/presentation/login/login_screen.dart';
import 'package:basic_diet/presentation/onboarding/on_boarding_screen.dart';
import 'package:basic_diet/presentation/splash/splash_screen.dart';
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
        pageBuilder: (BuildContext context, GoRouterState state) =>
            getCustomTransitionPage(state: state, child: LoginScreen()),
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
