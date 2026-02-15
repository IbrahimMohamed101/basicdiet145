import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/widgets/button_widget.dart';
import 'package:basic_diet/presentation/widgets/custom_back_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_otp_text_field/flutter_otp_text_field.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class VerifyScreen extends StatelessWidget {
  static const String verifyRoute = "/verify";
  final String? phoneNumber;

  const VerifyScreen({super.key, this.phoneNumber});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorManager.whiteColor,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.symmetric(horizontal: AppPadding.p20.w),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Gap(AppSize.s20.h),
              const CustomBackButton(),
              Gap(AppSize.s40.h),
              Center(
                child: Column(
                  children: [
                    Text(
                      Strings.verifyYourPhone,
                      style: getBoldTextStyle(
                        color: ColorManager.blackColor,
                        fontSize: FontSizeManager.s24.sp,
                      ),
                    ),
                    Gap(AppSize.s16.h),
                    Text(
                      Strings.otpSentSubtitle,
                      style: getRegularTextStyle(
                        color: ColorManager.grayColor,
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                    Gap(AppSize.s8.h),
                    Text(
                      phoneNumber ?? "",
                      style: getBoldTextStyle(
                        color: ColorManager.blackColor,
                        fontSize: FontSizeManager.s16.sp,
                      ),
                    ),
                  ],
                ),
              ),
              Gap(AppSize.s40.h),
              OtpTextField(
                numberOfFields: 4,
                borderColor: ColorManager.greenPrimary,
                focusedBorderColor: ColorManager.greenPrimary,
                showFieldAsBox: true,
                fieldWidth: AppSize.s70.w,
                fieldHeight: AppSize.s70.h,
                onCodeChanged: (String code) {},
                onSubmit: (String verificationCode) {},
                borderRadius: BorderRadius.circular(AppSize.s16.r),
                filled: true,
                fillColor: ColorManager.whiteColor,
              ),
              Gap(AppSize.s24.h),
              Center(
                child: RichText(
                  text: TextSpan(
                    text: "${Strings.resendCodeIn} ",
                    style: getRegularTextStyle(
                      color: ColorManager.grayColor,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                    children: [
                      TextSpan(
                        text: "0:52",
                        style: getBoldTextStyle(
                          color: ColorManager.greenDark,
                          fontSize: FontSizeManager.s14.sp,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Gap(AppSize.s40.h),
              ButtonWidget(
                text: Strings.verifyAndContinue,
                textColor: ColorManager.whiteColor,
                color: ColorManager.greenDark,
                width: double.infinity,
                radius: AppSize.s12.r,
                onTap: () {},
              ),
              Gap(AppSize.s20.h),
              Container(
                padding: EdgeInsets.all(AppPadding.p12.w),
                decoration: BoxDecoration(
                  color: ColorManager.greenLight.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(AppSize.s8.r),
                  border: Border.all(
                    color: ColorManager.greenLight.withOpacity(0.3),
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.lock,
                      size: AppSize.s16.sp,
                      color: ColorManager.grayColor,
                    ),
                    Gap(AppSize.s8.w),
                    Expanded(
                      child: Text(
                        Strings.secureInfo,
                        style: getRegularTextStyle(
                          color: ColorManager.grayColor,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
