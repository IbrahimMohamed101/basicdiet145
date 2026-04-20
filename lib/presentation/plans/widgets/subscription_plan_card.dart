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
    final progressValue =
        data.totalMeals > 0 ? (data.remainingMeals / data.totalMeals) : 0.0;

    return Container(
      decoration: BoxDecoration(
        color: ColorManager.whiteColor,
        borderRadius: BorderRadius.circular(AppSize.s16),
        border: Border.all(color: ColorManager.formFieldsBorderColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 10,
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
          Gap(AppSize.s24.h),
          Container(height: 1, color: ColorManager.formFieldsBorderColor),
          Gap(AppSize.s20.h),
          if (data.premiumSummary.isNotEmpty) _buildPremiumSection(),
          if (data.addonSubscriptions.isNotEmpty) _buildAddonsSection(),
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
            color: ColorManager.black101828,
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
          child: const Icon(
            Icons.settings_outlined,
            color: ColorManager.grey6A7282,
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
        color: ColorManager.greenPrimary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppSize.s20.r),
      ),
      child: Text(
        data.statusLabel.isNotEmpty ? data.statusLabel : Strings.active.tr(),
        style: getBoldTextStyle(
          color: ColorManager.greenPrimary,
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
                color: ColorManager.grey6A7282,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
            Text(
              '${data.remainingMeals} / ${data.totalMeals}',
              style: getBoldTextStyle(
                color: ColorManager.black101828,
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
            backgroundColor: ColorManager.formFieldsBorderColor,
            valueColor: const AlwaysStoppedAnimation<Color>(
              ColorManager.greenPrimary,
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
                    color: ColorManager.orangePrimary.withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.workspace_premium_outlined,
                    color: ColorManager.orangePrimary,
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
                              color: ColorManager.grey6A7282,
                              fontSize: FontSizeManager.s14.sp,
                            ),
                          ),
                          Text(
                            '${premium.remainingQtyTotal} ${Strings.available.tr()}',
                            style: getBoldTextStyle(
                              color: ColorManager.grey4A5565,
                              fontSize: FontSizeManager.s14.sp,
                            ),
                          ),
                        ],
                      ),
                      Gap(AppSize.s4.h),
                      Text(
                        '${Strings.purchased.tr()} ${premium.purchasedQtyTotal} • ${Strings.consumed.tr()} ${premium.consumedQtyTotal}',
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
          ),
        ),
      ],
    );
  }

  Widget _buildAddonsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          Strings.addOnsIncluded.tr(),
          style: getRegularTextStyle(
            color: ColorManager.grey6A7282,
            fontSize: FontSizeManager.s12.sp,
          ),
        ),
        Gap(AppSize.s8.h),
        Wrap(
          spacing: AppSize.s8,
          runSpacing: AppSize.s8,
          children: data.addonSubscriptions.map((addon) {
            return Container(
              padding: const EdgeInsetsDirectional.symmetric(
                horizontal: AppPadding.p12,
                vertical: AppPadding.p8,
              ),
              decoration: BoxDecoration(
                border: Border.all(color: ColorManager.formFieldsBorderColor),
                borderRadius: BorderRadius.circular(AppSize.s20),
              ),
              child: Text(
                '${addon.name} • 1/${Strings.day.tr()}',
                style: getRegularTextStyle(
                  color: ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s12,
                ),
              ),
            );
          }).toList(),
        ),
        Gap(AppSize.s20.h),
      ],
    );
  }

  Widget _buildDeliveryInfo() {
    return Row(
      children: [
        const Icon(
          Icons.location_on_outlined,
          color: ColorManager.grey6A7282,
          size: AppSize.s18,
        ),
        const SizedBox(width: AppSize.s4),
        Text(
          data.deliveryModeLabel.isNotEmpty
              ? data.deliveryModeLabel
              : Strings.pickup.tr(),
          style: getRegularTextStyle(
            color: ColorManager.grey6A7282,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
        Gap(AppSize.s16.w),
        const Icon(
          Icons.access_time_outlined,
          color: ColorManager.grey6A7282,
          size: AppSize.s18,
        ),
        const SizedBox(width: AppSize.s4),
        Text(
          '${data.selectedMealsPerDay} ${Strings.mealsDay.tr()}',
          style: getRegularTextStyle(
            color: ColorManager.grey6A7282,
            fontSize: FontSizeManager.s14,
          ),
        ),
      ],
    );
  }
}
