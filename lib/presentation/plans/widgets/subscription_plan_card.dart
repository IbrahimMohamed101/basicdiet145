import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/presentation/plans/manage_subscription/manage_subscription_screen.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class SubscriptionPlanCard extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel data;

  const SubscriptionPlanCard({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final progressValue = data.totalMeals > 0
        ? (data.remainingMeals / data.totalMeals)
        : 0.0;

    return Container(
      decoration: BoxDecoration(
        color: ColorManager.backgroundSurface,
        borderRadius: BorderRadius.circular(AppSize.s16),
        border: Border.all(color: ColorManager.borderDefault),
        boxShadow: [
          BoxShadow(
            color: ColorManager.brandPrimaryGlow,
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsetsDirectional.all(AppPadding.p16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildCardHeader(context),
          Gap(AppSize.s16.h),
          _buildStatusBadge(),
          Gap(AppSize.s24.h),
          _buildMealsProgress(progressValue),
          Gap(AppSize.s16.h),
          if (data.addonSubscriptions.isNotEmpty) _buildAddonsSection(),
          Container(height: 1, color: ColorManager.borderDefault),
          Gap(AppSize.s20.h),
          if (data.premiumSummary.isNotEmpty) _buildPremiumSection(),

          _buildDeliveryInfo(),
        ],
      ),
    );
  }

  Widget _buildCardHeader(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          Strings.subscriptionPlanText.tr(),
          style: getBoldTextStyle(
            color: ColorManager.textPrimary,
            fontSize: FontSizeManager.s18.sp,
          ),
        ),
        InkWell(
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => ManageSubscriptionScreen(
                subscriptionId: data.id,
                selectedMealsPerDay: data.selectedMealsPerDay,
                deliveryModeLabel: data.deliveryModeLabel,
                validityEndDate: data.validityEndDate,
                skipDaysUsed: data.skipDaysUsed,
                skipDaysLimit: data.skipDaysLimit,
                remainingSkipDays: data.remainingSkipDays,
              ),
            ),
          ),
          child: Icon(
            Icons.settings_outlined,
            color: ColorManager.brandPrimary,
            size: AppSize.s20,
          ),
        ),
      ],
    );
  }

  Widget _buildStatusBadge() {
    return Container(
      padding: const EdgeInsetsDirectional.symmetric(
        horizontal: AppPadding.p12,
        vertical: AppPadding.p6,
      ),
      decoration: BoxDecoration(
        color: ColorManager.stateSuccessSurface,
        borderRadius: BorderRadius.circular(AppSize.s20.r),
      ),
      child: Text(
        data.statusLabel.isNotEmpty ? data.statusLabel : Strings.active.tr(),
        style: getBoldTextStyle(
          color: ColorManager.stateSuccessEmphasis,
          fontSize: FontSizeManager.s12.sp,
        ),
      ),
    );
  }

  Widget _buildMealsProgress(double progressValue) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              Strings.regularMealsRemaining.tr(),
              style: getRegularTextStyle(
                color: ColorManager.textSecondary,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
            Text(
              '${data.remainingMeals} / ${data.totalMeals}',
              style: getBoldTextStyle(
                color: ColorManager.textPrimary,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
          ],
        ),
        Gap(AppSize.s8.h),
        ClipRRect(
          borderRadius: BorderRadius.circular(AppSize.s4),
          child: LinearProgressIndicator(
            value: progressValue,
            backgroundColor: ColorManager.brandPrimaryTint,
            valueColor: AlwaysStoppedAnimation<Color>(
              ColorManager.brandPrimary,
            ),
            minHeight: AppSize.s8,
          ),
        ),
      ],
    );
  }

  Widget _buildPremiumSection() {
    return Column(
      children: [
        ...data.premiumSummary.map(
          (premium) => Padding(
            padding: EdgeInsetsDirectional.only(bottom: AppSize.s24.h),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsetsDirectional.all(AppPadding.p8),
                  decoration: BoxDecoration(
                    color: ColorManager.brandAccentSoft,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.workspace_premium_outlined,
                    color: ColorManager.brandAccent,
                    size: AppSize.s18,
                  ),
                ),
                Gap(AppSize.s12.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            Strings.premiumMealsText.tr(),
                            style: getRegularTextStyle(
                              color: ColorManager.textSecondary,
                              fontSize: FontSizeManager.s14.sp,
                            ),
                          ),
                          Text(
                            '${premium.remainingQtyTotal} ${Strings.available.tr()}',
                            style: getBoldTextStyle(
                              color: ColorManager.brandAccent,
                              fontSize: FontSizeManager.s14.sp,
                            ),
                          ),
                        ],
                      ),
                      Gap(AppSize.s4.h),
                      Text(
                        '${Strings.purchased.tr()} ${premium.purchasedQtyTotal} • ${Strings.consumed.tr()} ${premium.consumedQtyTotal}',
                        style: getRegularTextStyle(
                          color: ColorManager.textSecondary,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAddonsSection() {
    final summaryByAddonId = {
      for (final summary in data.addonsSummary) summary.addonId: summary,
    };

    return Column(
      children: data.addonSubscriptions.map((addon) {
        final summary = summaryByAddonId[addon.addonId];
        final used = summary?.consumedQtyTotal ?? 0;
        final total = summary?.purchasedQtyTotal ?? addon.includedCount;
        final progress = total > 0 ? used / total : 0.0;
        return Container(
          margin: EdgeInsets.only(bottom: AppSize.s12.h),
          padding: EdgeInsets.all(AppPadding.p14.w),
          decoration: BoxDecoration(
            color: ColorManager.brandAccentSoft,
            border: Border.all(color: ColorManager.brandAccentBorder),
            borderRadius: BorderRadius.circular(AppSize.s18.r),
          ),
          child: Text(
            '${addon.includedCount} ${addon.category.isNotEmpty
                ? addon.category
                : Strings.addOns.tr()} ${Strings.includedPerDay.tr()}',
            style: getBoldTextStyle(
              color: ColorManager.brandAccent,
                  fontSize: FontSizeManager.s12.sp,
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildDeliveryInfo() {
    return Row(
      children: [
        Icon(
          Icons.location_on_outlined,
          color: ColorManager.iconSecondary,
          size: AppSize.s18,
        ),
        const SizedBox(width: AppSize.s4),
        Text(
          data.deliveryModeLabel.isNotEmpty
              ? data.deliveryModeLabel
              : Strings.pickup.tr(),
          style: getRegularTextStyle(
            color: ColorManager.textSecondary,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
        Gap(AppSize.s16.w),
        Icon(
          Icons.access_time_outlined,
          color: ColorManager.iconSecondary,
          size: AppSize.s18,
        ),
        const SizedBox(width: AppSize.s4),
        Text(
          '${data.selectedMealsPerDay} ${Strings.mealsDay.tr()}',
          style: getRegularTextStyle(
            color: ColorManager.textSecondary,
            fontSize: FontSizeManager.s14,
          ),
        ),
      ],
    );
  }
}
