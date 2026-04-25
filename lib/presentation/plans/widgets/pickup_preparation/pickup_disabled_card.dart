import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/domain/model/pickup_preparation_enums.dart';
import 'package:basic_diet/presentation/plans/widgets/pickup_preparation/pickup_blocked_reason_ext.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_bloc.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_event.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

/// Shown when flowStatus == 'disabled'.
/// Uses [PickupBlockedReason] enum for type-safe reason handling.
class PickupDisabledCard extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel data;

  const PickupDisabledCard({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final prep = data.pickupPreparation!;
    final reason = PickupBlockedReason.fromString(prep.reason);

    final message = prep.message.isNotEmpty
        ? prep.message
        : reason.messageKey.tr();

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p24.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F3F6),
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        border: Border.all(color: ColorManager.borderDefault),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                reason.icon,
                color: ColorManager.textPrimary,
                size: AppSize.s20.sp,
              ),
              Gap(AppSize.s8.w),
              Expanded(
                child: Text(
                  reason.titleKey.tr(),
                  style: getBoldTextStyle(
                    color: ColorManager.textPrimary,
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
              color: ColorManager.textSecondary,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s24.h),
          _ActionButton(data: data, reason: reason),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel data;
  final PickupBlockedReason reason;

  const _ActionButton({required this.data, required this.reason});

  @override
  Widget build(BuildContext context) {
    final prep = data.pickupPreparation!;
    final label = reason.isActionable
        ? 'mealPlanner'.tr()
        : (prep.buttonLabel.isNotEmpty ? prep.buttonLabel : 'confirm'.tr());

    return InkWell(
      onTap: reason.isActionable
          ? () => context.read<PlansBloc>().add(
              FetchTimelineAndOpenPlannerEvent(
                data.id,
                preferredDate: data.businessDate,
              ),
            )
          : null,
      borderRadius: BorderRadius.circular(AppSize.s100.r),
      child: Container(
        width: double.infinity,
        height: AppSize.s55.h,
        decoration: BoxDecoration(
          color: reason.isActionable
              ? ColorManager.brandPrimary
              : const Color(0xFFE5E7EB),
          borderRadius: BorderRadius.circular(AppSize.s100.r),
        ),
        child: Center(
          child: Text(
            label,
            style: getBoldTextStyle(
              color: reason.isActionable
                  ? ColorManager.backgroundSurface
                  : ColorManager.textSecondary,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
        ),
      ),
    );
  }
}
