import 'package:basic_diet/presentation/resources/routes_manager.dart';
import 'package:basic_diet/presentation/resources/theme_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
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
  @override
  Widget build(BuildContext context) {
    return ScreenUtilInit(
      designSize: Size(AppSize.s392, AppSize.s851),
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        routerConfig: GoRouterConfig.router,
        theme: getApplicationTheme(),
      ),
    );
  }
}
