import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';

ThemeData getApplicationTheme() {
  return ThemeData(
    useMaterial3: true,
    primaryColor: ColorManager.greenPrimary,

    buttonTheme: ButtonThemeData(
      shape: const StadiumBorder(),
      buttonColor: ColorManager.greenDark,
      disabledColor: ColorManager.greenLight,
      splashColor: ColorManager.greenPrimary,
    ),

    inputDecorationTheme: InputDecorationTheme(
      // contentPadding: const EdgeInsets.all(AppPadding.p8), // padding of the input field
      // hintStyle: getRegularTextStyle(color: ColorManager.teal950, fontSize: AppSize.s14),
      // labelStyle: getMediumTextStyle(color: ColorManager.teal950, fontSize: AppSize.s14),
      errorStyle: getRegularTextStyle(color: ColorManager.errorColor),

      enabledBorder: OutlineInputBorder(
        borderSide: const BorderSide(
          color: ColorManager.grayColor,
          width: AppSize.s1_5,
        ),
        borderRadius: BorderRadius.circular(AppSize.s8),
      ),

      focusedBorder: OutlineInputBorder(
        borderSide: BorderSide(
          color: ColorManager.greenPrimary,
          width: AppSize.s1_5,
        ),
        borderRadius: BorderRadius.circular(AppSize.s8),
      ),

      errorBorder: OutlineInputBorder(
        borderSide: BorderSide(
          color: ColorManager.errorColor,
          width: AppSize.s1_5,
        ),
        borderRadius: BorderRadius.circular(AppSize.s8),
      ),

      focusedErrorBorder: OutlineInputBorder(
        borderSide: BorderSide(
          color: ColorManager.errorColor,
          width: AppSize.s1_5,
        ),
        borderRadius: BorderRadius.circular(AppSize.s8),
      ),
    ),
  );
}
