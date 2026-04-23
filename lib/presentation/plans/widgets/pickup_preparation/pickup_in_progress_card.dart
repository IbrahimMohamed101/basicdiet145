import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

/// Shown while polling and status is locked or in_preparation.
class PickupInProgressCard extends StatelessWidget {
  const PickupInProgressCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p24.w),
      decoration: BoxDecoration(
        color: ColorManager.backgroundSurface,
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        border: Border.all(color: ColorManager.borderDefault),
        boxShadow: [
          BoxShadow(
            color: ColorManager.textPrimary.withValues(alpha: 0.03),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      Strings.kitchenPreparingMeals.tr(),
                      style: getBoldTextStyle(
                        color: ColorManager.textPrimary,
                        fontSize: FontSizeManager.s20.sp,
                      ),
                    ),
                    Gap(AppSize.s8.h),
                    Text(
                      Strings.chefHandPickingIngredients.tr(),
                      style: getRegularTextStyle(
                        color: ColorManager.textSecondary,
                        fontSize: FontSizeManager.s16.sp,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: EdgeInsets.all(AppPadding.p12.w),
                decoration: const BoxDecoration(
                  color: ColorManager.brandAccentSoft,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.soup_kitchen_outlined,
                  color: ColorManager.brandAccent,
                  size: AppSize.s28.sp,
                ),
              ),
            ],
          ),
          Gap(AppSize.s24.h),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppSize.s100.r),
            child: LinearProgressIndicator(
              minHeight: AppSize.s8.h,
              backgroundColor: ColorManager.backgroundSubtle,
              valueColor: AlwaysStoppedAnimation<Color>(
                ColorManager.brandPrimary,
              ),
            ),
          ),
          Gap(AppSize.s24.h),
          Container(
            width: double.infinity,
            height: AppSize.s55.h,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [ColorManager.brandPrimaryPressed, ColorManager.brandPrimaryHover],
              ),
              borderRadius: BorderRadius.circular(AppSize.s100.r),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SizedBox(
                  width: AppSize.s20.w,
                  height: AppSize.s20.w,
                  child: const CircularProgressIndicator(
                    color: ColorManager.backgroundSurface,
                    strokeWidth: 2,
                  ),
                ),
                Gap(AppSize.s12.w),
                Text(
                  Strings.preparing.tr(),
                  style: getBoldTextStyle(
                    color: ColorManager.backgroundSurface,
                    fontSize: FontSizeManager.s18.sp,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
