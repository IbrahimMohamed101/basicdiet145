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
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

class NoSubscriptionView extends StatelessWidget {
  const NoSubscriptionView({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppPadding.p24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Gap(AppSize.s60.h),
            _buildIllustration(),
            Gap(AppSize.s40.h),
            Text(
              Strings.noSubscriptionTitle.tr(),
              textAlign: TextAlign.center,
              style: getBoldTextStyle(
                color: ColorManager.textPrimary,
                fontSize: FontSizeManager.s22.sp,
              ),
            ),
            Gap(AppSize.s12.h),
            Text(
              Strings.noSubscriptionSubtitle.tr(),
              textAlign: TextAlign.center,
              style: getRegularTextStyle(
                color: ColorManager.textSecondary,
                fontSize: FontSizeManager.s15.sp,
              ),
            ),
            Gap(AppSize.s40.h),
            _buildExploreButton(context),
          ],
        ),
      ),
    );
  }

  Widget _buildIllustration() {
    return Container(
      height: 220.h,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        boxShadow: [
          BoxShadow(
            color: ColorManager.brandPrimary.withValues(alpha: 0.1),
            blurRadius: 40,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        child: Image.asset(ImageAssets.noSubscription, fit: BoxFit.contain),
      ),
    );
  }

  Widget _buildExploreButton(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: () =>
            context.pushReplacement(SubscriptionScreen.subscriptionRoute),
        style: ElevatedButton.styleFrom(
          backgroundColor: ColorManager.brandPrimary,
          padding: const EdgeInsets.symmetric(vertical: AppPadding.p18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSize.s16.r),
          ),
          elevation: 4,
          shadowColor: ColorManager.brandPrimary.withValues(alpha: 0.3),
        ),
        child: Text(
          Strings.exploreOurPlans.tr(),
          style: getBoldTextStyle(
            color: ColorManager.backgroundSurface,
            fontSize: FontSizeManager.s16.sp,
          ),
        ),
      ),
    );
  }
}
