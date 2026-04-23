import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';

ThemeData getApplicationTheme() {
  final colorScheme = ColorScheme(
    brightness: Brightness.light,
    primary: ColorManager.brandPrimary,
    onPrimary: ColorManager.textInverse,
    secondary: ColorManager.brandAccent,
    onSecondary: ColorManager.textInverse,
    error: ColorManager.stateError,
    onError: ColorManager.textInverse,
    surface: ColorManager.backgroundSurface,
    onSurface: ColorManager.textPrimary,
  );

  return ThemeData(
    useMaterial3: true,
    fontFamily: FontConstants.fontFamily,
    primaryColor: ColorManager.brandPrimary,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: ColorManager.backgroundApp,
    dividerColor: ColorManager.borderDefault,
    appBarTheme: AppBarTheme(
      backgroundColor: ColorManager.backgroundSurface,
      foregroundColor: ColorManager.textPrimary,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: ColorManager.transparent,
    ),

    buttonTheme: ButtonThemeData(
      shape: const StadiumBorder(),
      buttonColor: ColorManager.brandPrimary,
      disabledColor: ColorManager.stateDisabledSurface,
      splashColor: ColorManager.brandPrimary,
    ),

    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: ColorManager.brandPrimary,
        foregroundColor: ColorManager.textInverse,
        disabledBackgroundColor: ColorManager.stateDisabledSurface,
        disabledForegroundColor: ColorManager.stateDisabled,
        elevation: 0,
        shadowColor: ColorManager.brandPrimaryGlow,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSize.s16),
        ),
      ),
    ),

    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ColorManager.brandPrimary,
        side: BorderSide(color: ColorManager.brandPrimary),
        backgroundColor: ColorManager.brandPrimaryTint,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSize.s14),
        ),
      ),
    ),

    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: ColorManager.brandPrimary),
    ),

    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: ColorManager.backgroundSurface,
      errorStyle: getRegularTextStyle(color: ColorManager.stateError),
      hintStyle: getRegularTextStyle(
        color: ColorManager.textSecondary,
        fontSize: AppSize.s16,
      ),

      enabledBorder: OutlineInputBorder(
        borderSide: BorderSide(
          color: ColorManager.borderDefault,
          width: AppSize.s1_5,
        ),
        borderRadius: BorderRadius.circular(AppSize.s8),
      ),

      focusedBorder: OutlineInputBorder(
        borderSide: BorderSide(
          color: ColorManager.brandPrimary,
          width: AppSize.s1_5,
        ),
        borderRadius: BorderRadius.circular(AppSize.s8),
      ),

      errorBorder: OutlineInputBorder(
        borderSide: BorderSide(
          color: ColorManager.stateError,
          width: AppSize.s1_5,
        ),
        borderRadius: BorderRadius.circular(AppSize.s8),
      ),

      focusedErrorBorder: OutlineInputBorder(
        borderSide: BorderSide(
          color: ColorManager.stateError,
          width: AppSize.s1_5,
        ),
        borderRadius: BorderRadius.circular(AppSize.s8),
      ),
    ),
  );
}
