import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class CustomTextFormField extends StatelessWidget {
  final String hintText;
  final TextEditingController controller;
  final void Function(String)? onFieldSubmitted;
  final String? Function(String?)? validator;
  final TextInputType keyboardType;
  final bool isPasswordField;
  final Widget? prefixIcon;
  final Widget? suffixIcon;
  final TextInputAction textInputAction;
  final FocusNode? focusNode;
  final bool isEnabled;
  final bool shouldCenterText;
  final VoidCallback? onTap;
  final String? errorText;
  final bool isReadOnly;

  const CustomTextFormField({
    super.key,
    required this.hintText,
    required this.controller,
    this.onFieldSubmitted,
    this.validator,
    this.keyboardType = TextInputType.text,
    this.isPasswordField = false,
    this.prefixIcon,
    this.suffixIcon,
    this.textInputAction = TextInputAction.done,
    this.focusNode,
    this.isEnabled = true,
    this.onTap,
    this.shouldCenterText = false,
    this.errorText,
    this.isReadOnly = false,
  });

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      readOnly: isReadOnly,
      textAlign: shouldCenterText ? TextAlign.center : TextAlign.start,
      controller: controller,
      focusNode: focusNode,
      validator: validator,
      obscureText: isPasswordField,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      style: getRegularTextStyle(
        color: ColorManager.greenPrimary,
        fontSize: FontSizeManager.s16.sp,
      ),
      enabled: isEnabled,
      onFieldSubmitted: onFieldSubmitted,
      cursorColor: ColorManager.greenPrimary,
      onTap: onTap,
      decoration: _buildInputDecoration(),
    );
  }

  InputDecoration _buildInputDecoration() {
    return InputDecoration(
      errorText: errorText,
      prefixIcon: prefixIcon,
      suffixIcon: suffixIcon,
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
      enabledBorder: _buildOutlineBorder(ColorManager.formFieldsBorderColor),
      focusedBorder: _buildOutlineBorder(ColorManager.greenPrimary),
      errorBorder: _buildOutlineBorder(ColorManager.errorColor),
      focusedErrorBorder: _buildOutlineBorder(ColorManager.errorColor),
    );
  }

  OutlineInputBorder _buildOutlineBorder(Color borderColor) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppSize.s14.r),
      borderSide: BorderSide(color: borderColor, width: AppSize.s1.w),
    );
  }
}
