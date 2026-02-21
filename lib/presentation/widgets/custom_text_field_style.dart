import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class AppTextField extends StatelessWidget {
  final String hintText;
  final TextEditingController controller;
  final TextInputType keyboardType;
  final bool obscureText;
  final String? errorText;
  final TextInputAction textInputAction;
  final ValueChanged<String>? onChanged;

  const AppTextField._({
    required this.hintText,
    required this.controller,
    required this.keyboardType,
    required this.obscureText,
    required this.textInputAction,
    this.errorText,
    this.onChanged,
  });

  // 🔹 Default constructor
  factory AppTextField.normal({
    required String hintText,
    required TextEditingController controller,
    ValueChanged<String>? onChanged,
    String? errorText,
  }) {
    return AppTextField._(
      hintText: hintText,
      controller: controller,
      keyboardType: TextInputType.text,
      obscureText: false,
      textInputAction: TextInputAction.done,
      errorText: errorText,
      onChanged: onChanged,
    );
  }

  // 🔹 Email constructor
  factory AppTextField.email({
    required TextEditingController controller,
    ValueChanged<String>? onChanged,
    String? errorText,
  }) {
    return AppTextField._(
      hintText: Strings.emailHint,
      controller: controller,
      keyboardType: TextInputType.emailAddress,
      obscureText: false,
      textInputAction: TextInputAction.next,
      errorText: errorText,
      onChanged: onChanged,
    );
  }

  factory AppTextField.phone({
    required TextEditingController controller,
    ValueChanged<String>? onChanged,
    String? errorText,
  }) {
    return AppTextField._(
      hintText: Strings.phoneHint,
      controller: controller,
      keyboardType: TextInputType.phone,
      obscureText: false,
      textInputAction: TextInputAction.done,
      errorText: errorText,
      onChanged: onChanged,
    );
  }

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      onChanged: onChanged,
      controller: controller,
      keyboardType: keyboardType,
      obscureText: obscureText,
      textInputAction: textInputAction,
      // decoration: InputDecoration(
      //   hintText: hintText,
      //   prefixIcon: prefixIcon,
      //   errorText: errorText,
      // ),
      decoration: InputDecoration(
        errorText: errorText,

        // helperText: "",
        // helperStyle: getRegularTextStyle(
        //   color: ColorManager.greyColor,
        //   fontSize: AppSize.s8.sp,
        // ),
        contentPadding: EdgeInsets.symmetric(
          vertical: AppPadding.p18.h,
          horizontal: AppPadding.p12.w,
        ),

        hintText: hintText,
        filled: true,
        fillColor: ColorManager.whiteColor,
        hintStyle: getRegularTextStyle(
          color: ColorManager.grayColor,
          fontSize: AppSize.s16.sp,
        ),

        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSize.s14.r),
          borderSide: BorderSide(
            color: ColorManager.formFieldsBorderColor,
            width: AppSize.s1.w,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSize.s14.r),
          borderSide: BorderSide(
            color: ColorManager.greenPrimary,
            width: AppSize.s1.w,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSize.s14.r),
          borderSide: BorderSide(color: ColorManager.errorColor),
        ),

        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSize.s14.r),
          borderSide: BorderSide(
            color: ColorManager.errorColor,
            width: AppSize.s1.w,
          ),
        ),
      ),
    );
  }
}

  // // 🔹 Password constructor
  // factory AppTextField.password({
  //   required TextEditingController controller,
  //   String? errorText,
  // }) {
  //   return AppTextField._(
  //     hintText: "Password",
  //     controller: controller,
  //     keyboardType: TextInputType.visiblePassword,
  //     obscureText: true,
  //     textInputAction: TextInputAction.done,
  //     prefixIcon: Icon(Icons.lock),
  //     errorText: errorText,
  //   );
  // }