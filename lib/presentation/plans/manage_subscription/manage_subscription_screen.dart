import 'package:flutter/material.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:gap/gap.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/freeze_subscription.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/skip_days.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/delivery_settings.dart';

class ManageSubscriptionScreen extends StatelessWidget {
  final String subscriptionId;
  final int selectedMealsPerDay;
  final String deliveryModeLabel;
  final String validityEndDate;

  const ManageSubscriptionScreen({
    super.key,
    required this.subscriptionId,
    required this.selectedMealsPerDay,
    required this.deliveryModeLabel,
    required this.validityEndDate,
  });

  @override
  Widget build(BuildContext context) {
    String formattedDate = '';
    try {
      DateTime dt = DateTime.parse(validityEndDate);
      formattedDate = DateFormat('MMMM d, yyyy').format(dt);
    } catch (e) {
      formattedDate = validityEndDate;
    }

    return Scaffold(
      backgroundColor: ColorManager.greyF3F4F6,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.black),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          Strings.manageSubscription,
          style: getRegularTextStyle(
            color: Colors.black,
            fontSize: FontSizeManager.s18.sp,
          ),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(
            color: ColorManager.formFieldsBorderColor,
            height: 1.0,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppPadding.p16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildPlanCard(formattedDate),
            Gap(AppSize.s24.h),
            Text(
              Strings.subscriptionActions,
              style: getRegularTextStyle(
                color: Colors.black,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
            Gap(AppSize.s12.h),
            _buildActionItem(
              icon: IconAssets.freeze,
              title: Strings.freezeSubscription,
              subtitle: Strings.freezeSubscriptionDesc,
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => FreezeSubscriptionScreen(
                      subscriptionId: subscriptionId,
                      validityEndDate: validityEndDate,
                    ),
                  ),
                );
              },
            ),
            Gap(AppSize.s12.h),
            _buildActionItem(
              icon: IconAssets.skip,
              title: Strings.skipDays,
              subtitle: Strings.skipDaysDesc,
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => const SkipDaysScreen(),
                  ),
                );
              },
            ),
            Gap(AppSize.s12.h),
            _buildActionItem(
              icon: IconAssets.delivery,
              title: Strings.deliverySettings,
              subtitle: Strings.deliverySettingsDesc,
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => const DeliverySettingsScreen(),
                  ),
                );
              },
            ),
            Gap(AppSize.s24.h),
            _buildDangerZone(),
          ],
        ),
      ),
    );
  }

  Widget _buildPlanCard(String date) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: ColorManager.greenPrimary.withValues(alpha: 0.05),
        border: Border.all(
          color: ColorManager.greenPrimary.withValues(alpha: 0.2),
        ),
        borderRadius: BorderRadius.circular(AppSize.s16),
      ),
      padding: const EdgeInsets.all(AppPadding.p16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.premiumMonthlyPlan,
            style: getRegularTextStyle(
              color: Colors.black,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          Text(
            '${Strings.activeUntil} $date',
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
          Gap(AppSize.s16.h),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(AppPadding.p12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(AppSize.s8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        Strings.mealsPerDay,
                        style: getRegularTextStyle(
                          color: ColorManager.grey6A7282,
                          fontSize: FontSizeManager.s14.sp,
                        ),
                      ),
                      Gap(AppSize.s4.h),
                      Text(
                        selectedMealsPerDay.toString(),
                        style: getRegularTextStyle(
                          color: Colors.black,
                          fontSize: FontSizeManager.s16.sp,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(AppPadding.p12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(AppSize.s8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        Strings.deliveryMode,
                        style: getRegularTextStyle(
                          color: ColorManager.grey6A7282,
                          fontSize: FontSizeManager.s14.sp,
                        ),
                      ),
                      Gap(AppSize.s4.h),
                      Text(
                        deliveryModeLabel.isNotEmpty
                            ? deliveryModeLabel
                            : Strings.delivery,
                        style: getRegularTextStyle(
                          color: Colors.black,
                          fontSize: FontSizeManager.s16.sp,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildActionItem({
    required String icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSize.s12),
      child: Container(
        padding: const EdgeInsets.all(AppPadding.p16),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: ColorManager.formFieldsBorderColor),
          borderRadius: BorderRadius.circular(AppSize.s12),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(AppPadding.p12),
              decoration: BoxDecoration(
                color: ColorManager.greyF3F4F6,
                shape: BoxShape.circle,
              ),
              child: SvgPicture.asset(
                icon,
                width: AppSize.s24,
                height: AppSize.s24,
              ),
            ),
            Gap(AppSize.s16.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: getRegularTextStyle(
                      color: Colors.black,
                      fontSize: FontSizeManager.s16.sp,
                    ),
                  ),
                  Gap(AppSize.s4.h),
                  Text(
                    subtitle,
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDangerZone() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        border: Border.all(color: const Color(0xFFFECACA)),
        borderRadius: BorderRadius.circular(AppSize.s16),
      ),
      padding: const EdgeInsets.all(AppPadding.p16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.dangerZone,
            style: getRegularTextStyle(
              color: const Color(0xFF991B1B),
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          Text(
            Strings.dangerZoneDesc,
            style: getRegularTextStyle(
              color: const Color(0xFFB91C1C),
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
          Gap(AppSize.s16.h),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () {},
              icon: SvgPicture.asset(
                IconAssets.cancel,
                width: AppSize.s20,
                height: AppSize.s20,
                colorFilter: const ColorFilter.mode(
                  ColorManager.errorColor,
                  BlendMode.srcIn,
                ),
              ),
              label: Text(
                Strings.cancelSubscription,
                style: getRegularTextStyle(
                  color: ColorManager.errorColor,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
                side: const BorderSide(color: ColorManager.errorColor),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSize.s12),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
