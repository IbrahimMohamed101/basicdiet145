import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/main/home/subscription/subscription_screen.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

class SubscribeCard extends StatelessWidget {
  const SubscribeCard({super.key});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(AppSize.s16.r),
      onTap: () => context.push(SubscriptionScreen.subscriptionRoute),
      child: Container(
        padding: EdgeInsetsDirectional.symmetric(
          horizontal: AppPadding.p20.w,
          vertical: AppPadding.p28.h,
        ),
        decoration: BoxDecoration(
          color: ColorManager.greenDark,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [_buildIconBadge(), _buildSaveBadge()],
            ),
            Gap(AppSize.s20.h),
            Text(
              Strings.subscribeSave.tr(),
              style: getBoldTextStyle(
                fontSize: FontSizeManager.s18.sp,
                color: ColorManager.whiteColor,
              ).copyWith(height: 1.2),
            ),
            Gap(AppSize.s8.h),
            Text(
              Strings.personalizedPlans.tr(),
              style: getRegularTextStyle(
                fontSize: FontSizeManager.s12.sp,
                color: ColorManager.whiteColor.withValues(alpha: 0.8),
              ).copyWith(height: 1.2),
            ),
            const Spacer(),
            Gap(AppSize.s16.h),
            _buildViewPlansRow(),
          ],
        ),
      ),
    );
  }

  Widget _buildIconBadge() {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p12.w),
      decoration: BoxDecoration(
        color: ColorManager.whiteColor.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(AppSize.s16.r),
      ),
      child: SvgPicture.asset(
        IconAssets.increase,
        colorFilter: const ColorFilter.mode(
          ColorManager.whiteColor,
          BlendMode.srcIn,
        ),
        width: AppSize.s24.w,
        height: AppSize.s24.h,
      ),
    );
  }

  Widget _buildSaveBadge() {
    return Container(
      height: AppSize.s45.h,
      width: AppSize.s45.w,
      padding: EdgeInsetsDirectional.all(AppPadding.p8.w),
      decoration: BoxDecoration(
        color: ColorManager.whiteColor.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(AppSize.s10.r),
      ),
      child: Text(
        Strings.save20.tr(),
        textAlign: TextAlign.center,
        style: getBoldTextStyle(
          fontSize: FontSizeManager.s10.sp,
          color: ColorManager.greenDark,
        ).copyWith(height: 1.2),
      ),
    );
  }

  Widget _buildViewPlansRow() {
    return Row(
      children: [
        Text(
          Strings.viewPlans.tr(),
          style: getBoldTextStyle(
            fontSize: FontSizeManager.s12.sp,
            color: ColorManager.whiteColor,
          ).copyWith(letterSpacing: 1),
        ),
        Gap(AppSize.s4.w),
        const Icon(
          Icons.arrow_forward_rounded,
          color: ColorManager.whiteColor,
          size: AppSize.s16,
        ),
      ],
    );
  }
}
