import 'dart:async';
import 'package:basic_diet/app/app_pref.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/language_selection/language_selection_screen.dart';
import 'package:basic_diet/presentation/login/login_screen.dart';
import 'package:basic_diet/presentation/main/main_screen.dart';
import 'package:basic_diet/presentation/onboarding/on_boarding_screen.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/constants_manager.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class SplashScreen extends StatefulWidget {
  static const String splashRoute = '/';
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  Timer? _timer;
  final AppPreferences _appPreferences = instance<AppPreferences>();

  @override
  void initState() {
    super.initState();
    _startDelay();
  }

  void _startDelay() {
    _timer = Timer(
      const Duration(seconds: AppConstants.splashDelay),
      _goNext,
    );
  }

  void _goNext() async {
    bool isLanguageSelected = await _appPreferences.isLanguageSelected();
    bool isUserLoggedIn = await _appPreferences.isUserLoggedIn("login");
    bool isOnboardingScreenViewed =
        await _appPreferences.isOnboardingScreenViewed();

    if (mounted) {
      if (!isLanguageSelected) {
        // First time user - show language selection
        context.go(LanguageSelectionScreen.languageSelectionRoute);
      } else if (isUserLoggedIn) {
        context.go(MainScreen.mainRoute);
      } else if (isOnboardingScreenViewed) {
        context.go(LoginScreen.loginRoute);
      } else {
        context.go(OnboardingScreen.routeName);
      }
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorManager.whiteColor,
      body: Center(child: Image.asset(ImageAssets.splashLogo)),
    );
  }
}
