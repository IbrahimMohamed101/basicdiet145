import 'dart:ui' as ui;
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/main/main_screen.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';
import 'package:pinput/pinput.dart';
import 'verify_bloc.dart';
import 'verify_event.dart';
import 'verify_state.dart';

class VerifyScreen extends StatelessWidget {
  static const String verifyRoute = "/verify";
  final String? phoneNumber;

  const VerifyScreen({super.key, this.phoneNumber});

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return BlocProvider(
      create: (_) => instance<VerifyBloc>(),
      child: BlocListener<VerifyBloc, VerifyState>(
        listener: (context, state) {
          if (state is VerifySuccessState) {
            context.go(MainScreen.mainRoute);
          }
        },
        child: Scaffold(
          backgroundColor: ColorManager.backgroundSurface,
          body: SafeArea(
            child: Builder(
              builder: (innerContext) => SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: EdgeInsetsDirectional.symmetric(
                  horizontal: AppPadding.p20.w,
                ).copyWith(bottom: AppPadding.p20.h + bottomInset),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Gap(AppSize.s20.h),
                    Gap(AppSize.s40.h),
                    _buildHeader(),
                    Gap(AppSize.s40.h),
                    _buildOtpForm(innerContext),
                    Gap(AppSize.s24.h),
                    _buildResendCode(innerContext),
                    Gap(AppSize.s40.h),
                    BlocBuilder<VerifyBloc, VerifyState>(
                      builder: (context, state) {
                        if (state is VerifyLoadingState) {
                          return _loader();
                        }
                        return const SizedBox.shrink();
                      },
                    ),
                    Gap(AppSize.s20.h),
                    _buildSecurityInfo(),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Center(
      child: Column(
        children: [
          Text(
            Strings.verifyYourPhone.tr(),
            style: getBoldTextStyle(
              color: ColorManager.textPrimary,
              fontSize: FontSizeManager.s24.sp,
            ),
          ),
          Gap(AppSize.s16.h),
          Text(
            Strings.otpSentSubtitle.tr(),
            style: getRegularTextStyle(
              color: ColorManager.textSecondary,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          Text(
            phoneNumber ?? "",
            style: getBoldTextStyle(
              color: ColorManager.textPrimary,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOtpForm(BuildContext context) {
    final defaultPinTheme = PinTheme(
      width: AppSize.s50.w,
      height: AppSize.s70.h,
      textStyle: getBoldTextStyle(
        color: ColorManager.textPrimary,
        fontSize: FontSizeManager.s20.sp,
      ),
      decoration: BoxDecoration(
        color: ColorManager.backgroundSurface,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
        border: Border.all(color: ColorManager.brandPrimary),
      ),
    );

    final focusedPinTheme = defaultPinTheme.copyWith(
      decoration: defaultPinTheme.decoration!.copyWith(
        border: Border.all(color: ColorManager.brandPrimary, width: 2),
      ),
    );

    return Directionality(
      textDirection: ui.TextDirection.ltr,
      child: Center(
        child: Pinput(
          length: 6,
          defaultPinTheme: defaultPinTheme,
          focusedPinTheme: focusedPinTheme,
          onChanged: (code) {
            context.read<VerifyBloc>().add(VerifyCodeChanged(code));
          },
          onCompleted: (code) {
            context.read<VerifyBloc>().add(VerifyCodeChanged(code));
            context.read<VerifyBloc>().add(VerifySubmitted(phoneNumber ?? ""));
          },
          keyboardType: TextInputType.number,
          autofocus: true,
        ),
      ),
    );
  }

  Widget _buildResendCode(BuildContext context) {
    return BlocBuilder<VerifyBloc, VerifyState>(
      builder: (context, state) {
        return Center(
          child: GestureDetector(
            onTap: state.canResend
                ? () => context.read<VerifyBloc>().add(const VerifyResendCode())
                : null,
            child: RichText(
              text: TextSpan(
                text: state.canResend
                    ? Strings.resendCode.tr()
                    : "${Strings.resendCodeIn.tr()} ",
                style:
                    getRegularTextStyle(
                      color: state.canResend
                          ? ColorManager.stateSuccessEmphasis
                          : ColorManager.textSecondary,
                      fontSize: FontSizeManager.s14.sp,
                    ).copyWith(
                      fontWeight: state.canResend
                          ? FontWeight.bold
                          : FontWeight.normal,
                    ),
                children: state.canResend
                    ? []
                    : [
                        TextSpan(
                          text:
                              "0:${state.timerDuration.toString().padLeft(2, '0')}",
                          style: getBoldTextStyle(
                            color: ColorManager.stateSuccessEmphasis,
                            fontSize: FontSizeManager.s14.sp,
                          ),
                        ),
                      ],
              ),
            ),
          ),
        );
      },
    );
  }

  // Widget _buildVerifyButton() {
  //   return BlocBuilder<VerifyBloc, VerifyState>(
  //     builder: (context, state) {
  //       final isLoading = state is VerifyLoadingState; // check if loading
  //       final isEnabled =
  //           state.otpError == null &&
  //           state.otpCode.length ==
  //               4; // check if text field is valid and filled

  //       return ButtonWidget(
  //         text: isLoading ? Strings.loading : Strings.verifyAndContinue,
  //         textColor: ColorManager.backgroundSurface,
  //         color: isEnabled
  //             ? ColorManager.stateSuccessEmphasis
  //             : ColorManager.stateSuccessEmphasis.withValues(alpha: 0.5),
  //         width: double.infinity,
  //         radius: AppSize.s12.r,
  //         onTap: isEnabled
  //             ? () => context.read<VerifyBloc>().add(const VerifySubmitted())
  //             : null,
  //       );
  //     },
  //   );
  // }

  Widget _buildSecurityInfo() {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p12.w),
      decoration: BoxDecoration(
        color: ColorManager.brandPrimaryTint.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppSize.s8.r),
        border: Border.all(
          color: ColorManager.brandPrimaryTint.withValues(alpha: 0.3),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.lock,
            size: AppSize.s16.sp,
            color: ColorManager.textSecondary,
          ),
          Gap(AppSize.s8.w),
          Expanded(
            child: Text(
              Strings.secureInfo.tr(),
              style: getRegularTextStyle(
                color: ColorManager.textSecondary,
                fontSize: FontSizeManager.s12.sp,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _loader() {
    return Center(
      child: CircularProgressIndicator(
        color: ColorManager.stateSuccessEmphasis,
      ),
    );
  }
}
