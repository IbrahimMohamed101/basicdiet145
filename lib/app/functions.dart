import 'package:basic_diet/app/app_pref.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/splash/splash_screen.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_phoenix/flutter_phoenix.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

bool isTextNotEmpty(String text) => text.isNotEmpty;

bool isPasswordValid(String password) => password.isNotEmpty;

bool isPhoneValid(String phone) => phone.isNotEmpty;

bool isNumberNotZero(int number) => number != 0;

Future<void> openUrl(String link) async {
  final Uri url = Uri.parse(link);
  if (!await launchUrl(url)) throw 'Could not launch $url';
}

void changeLanguage(BuildContext context) async {
  final appPreferences = instance<AppPreferences>();
  await appPreferences.changeAppLanguage();
  
  // Get the current language after change
  final currentLanguage = await appPreferences.getAppLanguage();
  
  if (context.mounted) {
    // Set the locale directly without going through splash
    final locale = currentLanguage == 'ar' 
        ? const Locale('ar', 'SA') 
        : const Locale('en', 'US');
    await context.setLocale(locale);
    
    // Restart the app to apply language change
    await Phoenix.rebirth(context);
  }
}

final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
