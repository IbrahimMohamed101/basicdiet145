import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

/// Shown when flowStatus == 'completed' from Overview.
/// Handles both the fulfilled (success) case and the no-show case
/// (reason == 'PICKUP_NO_SHOW').
class PickupCompletedCard extends StatelessWidget {
  final PickupPreparationModel data;

  const PickupCompletedCard({super.key, required this.data});

  bool get _isNoShow => data.reason.toUpperCase() == 'PICKUP_NO_SHOW';

  @override
  Widget build(BuildContext context) {
    if (_isNoShow) return _NoShowCompletedCard(data: data);

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p24.w),
      decoration: BoxDecoration(
        color: ColorManager.brandPrimary.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        border: Border.all(
          color: ColorManager.brandPrimary.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(AppPadding.p8.w),
            decoration: BoxDecoration(
              color: ColorManager.brandPrimary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.check_circle_outline,
              color: ColorManager.brandPrimary,
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
                    color: ColorManager.brandPrimary,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                Gap(AppSize.s2.h),
                Text(
                  Strings.pickupCompletedMessage.tr(),
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
    );
  }
}

class _NoShowCompletedCard extends StatelessWidget {
  final PickupPreparationModel data;

  const _NoShowCompletedCard({required this.data});

  @override
  Widget build(BuildContext context) {
    final message = data.message.isNotEmpty
        ? data.message
        : Strings.noShowMessage.tr();

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p24.w),
      decoration: BoxDecoration(
        color: ColorManager.backgroundSubtle,
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        border: Border.all(color: ColorManager.borderDefault),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: EdgeInsets.all(AppPadding.p10.w),
            decoration: BoxDecoration(
              color: ColorManager.backgroundSurface,
              shape: BoxShape.circle,
              border: Border.all(color: ColorManager.borderDefault),
            ),
            child: Icon(
              Icons.person_off_outlined,
              color: ColorManager.textSecondary,
              size: AppSize.s20.sp,
            ),
          ),
          Gap(AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  Strings.noShowTitle.tr(),
                  style: getBoldTextStyle(
                    color: ColorManager.textPrimary,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                Gap(AppSize.s4.h),
                Text(
                  message,
                  style: getRegularTextStyle(
                    color: ColorManager.textSecondary,
                    fontSize: FontSizeManager.s14.sp,
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
