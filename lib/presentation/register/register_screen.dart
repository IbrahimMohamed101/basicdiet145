import 'package:basic_diet/presentation/login/login_screen.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/widgets/button_widget.dart';
import 'package:basic_diet/presentation/widgets/custom_back_button.dart';
import 'package:basic_diet/presentation/widgets/custom_text_field_style.dart';
import 'package:basic_diet/presentation/widgets/text_button_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

class RegisterScreen extends StatelessWidget {
  static const String registerRoute = "/register";
  const RegisterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorManager.whiteColor,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsetsDirectional.symmetric(horizontal: AppSize.s24.w),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Gap(AppSize.s20.h),
              const CustomBackButton(),
              Gap(AppSize.s100.h),
              _buildHeader(),
              Gap(AppSize.s40.h),
              _buildForm(context),
              Gap(AppSize.s20.h),
              _buildFooter(context),
              Gap(AppSize.s20.h),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          Strings.welcome,
          style: getBoldTextStyle(
            color: ColorManager.blackColor,
            fontSize: FontSizeManager.s30.sp,
          ),
        ),
        Gap(AppSize.s10.h),
        Text(
          Strings.registerSubtitle,
          style: getRegularTextStyle(
            color: ColorManager.grayColor,
            fontSize: FontSizeManager.s16.sp,
          ),
        ),
      ],
    );
  }

  Widget _buildForm(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Full Name
        Text(
          Strings.fullName,
          style: getRegularTextStyle(
            color: ColorManager.blackColor,
            fontSize: FontSizeManager.s16.sp,
          ),
        ),
        Gap(AppSize.s8.h),
        AppTextField.normal(
          hintText: Strings.fullNameHint,
          controller: TextEditingController(),
        ),
        Gap(AppSize.s16.h),

        // Phone Number
        Text(
          Strings.phone,
          style: getRegularTextStyle(
            color: ColorManager.blackColor,
            fontSize: FontSizeManager.s16.sp,
          ),
        ),
        Gap(AppSize.s8.h),
        AppTextField.phone(controller: TextEditingController()),
        Gap(AppSize.s16.h),

        // Email Address
        Text(
          Strings.emailOptional,
          style: getRegularTextStyle(
            color: ColorManager.blackColor,
            fontSize: FontSizeManager.s16.sp,
          ),
        ),
        Gap(AppSize.s8.h),
        AppTextField.email(controller: TextEditingController()),
        Gap(AppSize.s24.h),

        // Create Account Button
        ButtonWidget(
          text: Strings.createAccount,
          textColor: ColorManager.whiteColor,
          color: ColorManager.greenDark,
          width: double.infinity,
          radius: AppSize.s12.r,
          onTap: () {},
        ),
      ],
    );
  }

  Widget _buildFooter(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(
          Strings.alreadyHaveAccount,
          style: getRegularTextStyle(
            color: ColorManager.grayColor,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
        TextButtonWidget(
          Strings.signIn,
          ColorManager.greenDark,
          FontSizeManager.s14,
          () => context.push(LoginScreen.loginRoute),
        ),
      ],
    );
  }
}
