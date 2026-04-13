import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class SubscriptionBanner extends StatelessWidget {
  const SubscriptionBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: AppSize.s205.h,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppSize.s30.r),
        image: const DecorationImage(
          image: AssetImage(ImageAssets.subscription),
          fit: BoxFit.cover,
        ),
      ),
      child: _GradientOverlay(),
    );
  }
}

class _GradientOverlay extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p20.w),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppSize.s30.r),
        gradient: LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [Colors.black.withValues(alpha: 0.8), Colors.transparent],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          // _BadgeLabel(label: Strings.new2026Packages),
          Gap(AppSize.s8.h),
          Text(
            Strings.subscriptionPricingMenu.tr(),
            style: getBoldTextStyle(
              color: ColorManager.whiteColor,
              fontSize: FontSizeManager.s24.sp,
            ).copyWith(height: 1.2),
          ),
          Gap(AppSize.s4.h),
          Text(
            Strings.choosePackageHealthGoals.tr(),
            style: getRegularTextStyle(
              color: ColorManager.whiteColor.withValues(alpha: 0.9),
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
        ],
      ),
    );
  }
}

// class _BadgeLabel extends StatelessWidget {
//   const _BadgeLabel({required this.label});

//   final String label;

//   @override
//   Widget build(BuildContext context) {
//     return Container(
//       padding: EdgeInsetsDirectional.symmetric(
//         horizontal: AppPadding.p12.w,
//         vertical: AppSize.s4.h,
//       ),
//       decoration: BoxDecoration(
//         color: ColorManager.greenPrimary,
//         borderRadius: BorderRadius.circular(AppSize.s20.r),
//       ),
//       child: Text(
//         label,
//         style: getBoldTextStyle(
//           color: ColorManager.whiteColor,
//           fontSize: FontSizeManager.s12.sp,
//         ),
//       ),
//     );
//   }
// }
