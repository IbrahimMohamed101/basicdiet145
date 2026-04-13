import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/main/home/add-ons/add_ons_screen.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_bloc.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_state.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_bloc.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_event.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

class PremiumMealsBottomActions extends StatelessWidget {
  const PremiumMealsBottomActions({super.key});

  void _navigateToAddOns(BuildContext context) {
    final subscriptionBloc = context.read<SubscriptionBloc>();
    final premiumState = context.read<PremiumMealsBloc>().state;

    if (premiumState is PremiumMealsSuccess) {
      subscriptionBloc.add(
        SavePremiumMealsSelectionEvent(premiumState.mealCounters),
      );
    }

    context.push(AddOnsScreen.addOnsRoute, extra: subscriptionBloc);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.symmetric(
        horizontal: AppPadding.p20.w,
        vertical: AppPadding.p16.h,
      ),
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        border: Border(
          top: BorderSide(color: ColorManager.formFieldsBorderColor, width: 1),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ElevatedButton(
            onPressed: () => _navigateToAddOns(context),
            style: ElevatedButton.styleFrom(
              backgroundColor: ColorManager.greenPrimary,
              minimumSize: Size(double.infinity, 56.h),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s16.r),
              ),
              elevation: 0,
            ),
            child: Text(
              Strings.continueText.tr(),
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s16.sp,
                color: ColorManager.whiteColor,
              ),
            ),
          ),
          Gap(AppSize.s12.h),
          TextButton(
            onPressed: () => _navigateToAddOns(context),
            style: TextButton.styleFrom(
              minimumSize: Size(double.infinity, 48.h),
            ),
            child: Text(
              Strings.skipThisStep.tr(),
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s16.sp,
                color: ColorManager.black101828,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
