import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/main/main_screen.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:go_router/go_router.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/widgets/button_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/main/home/payment-success/payment_validation_cubit.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

class PaymentSuccessfulScreen extends StatelessWidget {
  static const String routeName = '/payment_successful';
  final String draftId;

  const PaymentSuccessfulScreen({super.key, required this.draftId});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) =>
          instance<PaymentValidationCubit>()..validatePayment(draftId),
      child: PopScope(
        canPop: false,
        child: Scaffold(
          backgroundColor: ColorManager.whiteColor,
          body: SafeArea(
            child: BlocBuilder<PaymentValidationCubit, PaymentValidationState>(
              builder: (context, state) {
                if (state is PaymentValidationLoading ||
                    state is PaymentValidationInitial) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (state is PaymentValidationFailure) {
                  return Padding(
                    padding: EdgeInsets.symmetric(horizontal: AppPadding.p20.w),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.error_outline,
                          color: ColorManager.errorColor,
                          size: 64.sp,
                        ),
                        Gap(AppSize.s16.h),
                        Text(
                          state.message,
                          textAlign: TextAlign.center,
                          style: getRegularTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s16.sp,
                          ),
                        ),
                        Gap(AppSize.s24.h),
                        ButtonWidget(
                          text: Strings.goToHome.tr(),
                          onTap: () =>
                              _openMainScreen(context, MainScreen.homeTabIndex),
                          radius: AppSize.s14,
                        ),
                      ],
                    ),
                  );
                }

                return Padding(
                  padding: EdgeInsetsDirectional.fromSTEB(
                    AppPadding.p20.w,
                    AppPadding.p24.h,
                    AppPadding.p20.w,
                    AppPadding.p24.h,
                  ),
                  child: Column(
                    children: [
                      const Spacer(flex: 3),
                      const _SuccessBadge(),
                      Gap(AppSize.s28.h),
                      Text(
                        Strings.paymentSuccessful.tr(),
                        textAlign: TextAlign.center,
                        style: getBoldTextStyle(
                          color: ColorManager.black101828,
                          fontSize: FontSizeManager.s30.sp,
                        ),
                      ),
                      Gap(AppSize.s12.h),
                      Padding(
                        padding: EdgeInsetsDirectional.symmetric(
                          horizontal: AppPadding.p12.w,
                        ),
                        child: Text(
                          Strings.paymentSuccessfulSubtitle.tr(),
                          textAlign: TextAlign.center,
                          style: getRegularTextStyle(
                            color: ColorManager.grey6A7282,
                            fontSize: FontSizeManager.s16.sp,
                          ).copyWith(height: 1.45),
                        ),
                      ),
                      const Spacer(flex: 2),
                      ButtonWidget(
                        radius: AppSize.s14,
                        text: Strings.viewMyPlan.tr(),
                        onTap: () =>
                            _openMainScreen(context, MainScreen.plansTabIndex),
                      ),
                      Gap(AppSize.s14.h),
                      OutlinedButton(
                        onPressed: () =>
                            _openMainScreen(context, MainScreen.homeTabIndex),
                        style: OutlinedButton.styleFrom(
                          minimumSize: Size(double.infinity, AppSize.s50.h),
                          side: const BorderSide(
                            color: ColorManager.formFieldsBorderColor,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(AppSize.s14.r),
                          ),
                          backgroundColor: ColorManager.whiteColor,
                        ),
                        child: Text(
                          Strings.goToHome.tr(),
                          style: getBoldTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s16.sp,
                          ),
                        ),
                      ),
                      const Spacer(flex: 3),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  void _openMainScreen(BuildContext context, int initialIndex) {
    context.go(MainScreen.mainRoute, extra: initialIndex);
  }
}

class _SuccessBadge extends StatelessWidget {
  const _SuccessBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: AppSize.s120.w,
      height: AppSize.s120.w,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: ColorManager.greenPrimary.withValues(alpha: 0.10),
      ),
      child: Center(
        child: Container(
          width: AppSize.s60.w,
          height: AppSize.s60.w,
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            color: ColorManager.whiteColor,
          ),
          child: Center(
            child: Container(
              width: AppSize.s48.w,
              height: AppSize.s48.w,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: ColorManager.greenDark,
              ),
              child: Icon(
                Icons.check_rounded,
                color: ColorManager.whiteColor,
                size: AppSize.s28,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
