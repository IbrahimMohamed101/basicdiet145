import 'package:basic_diet/app/app_pref.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/resources/routes_manager.dart';
import 'package:basic_diet/presentation/resources/theme_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class MyApp extends StatefulWidget {
  const MyApp._internal();

  static final MyApp _instance = MyApp._internal();

  factory MyApp() => _instance;

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  final AppPreferences _appPreferences = instance<AppPreferences>();
  bool _isLocaleInitialized = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();

    if (_isLocaleInitialized) return;
    _isLocaleInitialized = true;
    _initLocale();
  }

  Future<void> _initLocale() async {
    final locale = await _appPreferences.getLocalLanguage();
    if (!mounted) return;
    if (context.locale == locale) return;
    await context.setLocale(locale);
  }

  @override
  Widget build(BuildContext context) {
    return ScreenUtilInit(
      designSize: Size(AppSize.s392, AppSize.s851),
      child: MaterialApp.router(
        localizationsDelegates: context.localizationDelegates,
        supportedLocales: context.supportedLocales,
        locale: context.locale,
        debugShowCheckedModeBanner: false,
        routerConfig: GoRouterConfig.router,
        theme: getApplicationTheme(),
      ),
    );
  }
}
