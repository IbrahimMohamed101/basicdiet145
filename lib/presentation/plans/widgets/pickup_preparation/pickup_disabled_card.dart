import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_bloc.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_event.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

/// Shown when flowStatus == 'disabled'.
/// Handles all reason codes with appropriate icon and CTA.
class PickupDisabledCard extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel data;

  const PickupDisabledCard({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final prep = data.pickupPreparation!;
    final reason = prep.reason;
    final message = prep.message.isNotEmpty
        ? prep.message
        : _defaultMessageFor(reason);

    final icon = _iconFor(reason);
    final isPlanningIncomplete = reason == 'PLANNING_INCOMPLETE';
    final isPlannerUnconfirmed = reason == 'PLANNER_UNCONFIRMED';
    final isActionable = isPlanningIncomplete || isPlannerUnconfirmed;

    final buttonLabel = isActionable
        ? Strings.mealPlanner.tr()
        : (prep.buttonLabel.isNotEmpty
              ? prep.buttonLabel
              : Strings.confirm.tr());

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p24.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F3F6),
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        border: Border.all(color: ColorManager.formFieldsBorderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: ColorManager.black101828, size: AppSize.s20.sp),
              Gap(AppSize.s8.w),
              Expanded(
                child: Text(
                  _titleFor(reason),
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s20.sp,
                  ),
                ),
              ),
            ],
          ),
          Gap(AppSize.s12.h),
          Text(
            message,
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s24.h),
          _buildButton(context, isActionable, buttonLabel),
        ],
      ),
    );
  }

  Widget _buildButton(
    BuildContext context,
    bool isActionable,
    String buttonLabel,
  ) {
    return InkWell(
      onTap: isActionable
          ? () => context.read<PlansBloc>().add(
              FetchTimelineAndOpenPlannerEvent(data.id),
            )
          : null,
      borderRadius: BorderRadius.circular(AppSize.s100.r),
      child: Container(
        width: double.infinity,
        height: AppSize.s55.h,
        decoration: BoxDecoration(
          color: isActionable
              ? ColorManager.greenPrimary
              : const Color(0xFFE5E7EB),
          borderRadius: BorderRadius.circular(AppSize.s100.r),
        ),
        child: Center(
          child: Text(
            buttonLabel,
            style: getBoldTextStyle(
              color: isActionable ? Colors.white : ColorManager.grey6A7282,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
        ),
      ),
    );
  }

  String _titleFor(String reason) {
    return switch (reason) {
      'DAY_SKIPPED' => Strings.daySkipped.tr(),
      'DAY_FROZEN' => Strings.dayFrozen.tr(),
      'RESTAURANT_CLOSED' => Strings.restaurantClosed.tr(),
      'SUBSCRIPTION_INACTIVE' => Strings.subscriptionInactive.tr(),
      'SUB_INACTIVE' => Strings.subscriptionInactive.tr(),
      'SUB_EXPIRED' => Strings.subscriptionExpired.tr(),
      'INSUFFICIENT_CREDITS' => Strings.insufficientCredits.tr(),
      'PAYMENT_REQUIRED' ||
      'PREMIUM_PAYMENT_REQUIRED' ||
      'PREMIUM_OVERAGE_PAYMENT_REQUIRED' ||
      'ONE_TIME_ADDON_PAYMENT_REQUIRED' =>
        Strings.paymentRequiredMessage.tr(),
      'PLANNER_UNCONFIRMED' => Strings.plannerUnconfirmed.tr(),
      _ => Strings.orderLocked.tr(),
    };
  }

  String _defaultMessageFor(String reason) {
    return switch (reason) {
      'DAY_SKIPPED' => Strings.daySkippedMessage.tr(),
      'DAY_FROZEN' => Strings.dayFrozenMessage.tr(),
      'RESTAURANT_CLOSED' => Strings.restaurantClosedMessage.tr(),
      'SUBSCRIPTION_INACTIVE' || 'SUB_INACTIVE' =>
        Strings.subscriptionInactive.tr(),
      'SUB_EXPIRED' => Strings.subscriptionExpired.tr(),
      'INSUFFICIENT_CREDITS' => Strings.insufficientCredits.tr(),
      'PAYMENT_REQUIRED' ||
      'PREMIUM_PAYMENT_REQUIRED' ||
      'PREMIUM_OVERAGE_PAYMENT_REQUIRED' ||
      'ONE_TIME_ADDON_PAYMENT_REQUIRED' =>
        Strings.paymentRequiredMessage.tr(),
      'PLANNER_UNCONFIRMED' => Strings.plannerUnconfirmed.tr(),
      'PLANNING_INCOMPLETE' => Strings.reviewSelectionToStartPreparation.tr(),
      _ => Strings.modificationPeriodEnded.tr(),
    };
  }

  IconData _iconFor(String reason) {
    return switch (reason) {
      'DAY_SKIPPED' => Icons.pause_circle_outline_rounded,
      'DAY_FROZEN' => Icons.ac_unit_outlined,
      'RESTAURANT_CLOSED' => Icons.storefront_outlined,
      'SUBSCRIPTION_INACTIVE' ||
      'SUB_INACTIVE' ||
      'SUB_EXPIRED' =>
        Icons.cancel_outlined,
      'INSUFFICIENT_CREDITS' => Icons.credit_card_off_outlined,
      'PAYMENT_REQUIRED' ||
      'PREMIUM_PAYMENT_REQUIRED' ||
      'PREMIUM_OVERAGE_PAYMENT_REQUIRED' ||
      'ONE_TIME_ADDON_PAYMENT_REQUIRED' =>
        Icons.payment_outlined,
      'PLANNING_INCOMPLETE' => Icons.edit_calendar_outlined,
      'PLANNER_UNCONFIRMED' => Icons.pending_actions_outlined,
      _ => Icons.lock_rounded,
    };
  }
}
