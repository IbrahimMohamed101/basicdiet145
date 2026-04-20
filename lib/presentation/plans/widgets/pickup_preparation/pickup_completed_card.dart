import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

/// Shown when flowStatus == 'completed' from Overview (fulfilled case).
class PickupCompletedCard extends StatelessWidget {
  const PickupCompletedCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p24.w),
      decoration: BoxDecoration(
        color: ColorManager.greenPrimary.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        border: Border.all(
          color: ColorManager.greenPrimary.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(AppPadding.p8.w),
            decoration: BoxDecoration(
              color: ColorManager.greenPrimary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.check_circle_outline,
              color: ColorManager.greenPrimary,
              size: AppSize.s24.sp,
            ),
          ),
          Gap(AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  Strings.pickupCompletedTitle.tr(),
                  style: getBoldTextStyle(
                    color: ColorManager.greenPrimary,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                Gap(AppSize.s2.h),
                Text(
                  Strings.pickupCompletedMessage.tr(),
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s12.sp,
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
