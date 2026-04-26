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

/// Shown when flowStatus == 'available' — user can tap to prepare.
class PickupAvailableCard extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel data;

  const PickupAvailableCard({super.key, required this.data});

  void _showConfirmDialog(BuildContext context) {
    final bloc = context.read<PlansBloc>();
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSize.s24.r),
        ),
        title: Text(
          Strings.confirmPrepareTitle.tr(),
          style: getBoldTextStyle(
            color: ColorManager.textPrimary,
            fontSize: FontSizeManager.s18.sp,
          ),
        ),
        content: Text(
          Strings.confirmPrepareMessage.tr(),
          style: getRegularTextStyle(
            color: ColorManager.textSecondary,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(
              Strings.cancel.tr(),
              style: getRegularTextStyle(
                color: ColorManager.textSecondary,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.of(context).pop();
              bloc.add(PreparePickupEvent(data.id, data.businessDate));
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: ColorManager.brandPrimary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s100.r),
              ),
              elevation: 0,
            ),
            child: Text(
              Strings.confirmPrepareAction.tr(),
              style: getBoldTextStyle(
                color: ColorManager.backgroundSurface,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final prep = data.pickupPreparation!;
    final buttonLabel = prep.buttonLabel.isNotEmpty
        ? prep.buttonLabel
        : Strings.confirmAndPrepare.tr();
    final message = prep.message.isNotEmpty
        ? prep.message
        : Strings.reviewSelectionToStartPreparation.tr();

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p24.w),
      decoration: BoxDecoration(
        color: ColorManager.backgroundSurface,
        borderRadius: BorderRadius.circular(AppSize.s24.r),
        border: Border.all(color: ColorManager.borderDefault),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  Strings.mealsNotPreparedYet.tr(),
                  style: getBoldTextStyle(
                    color: ColorManager.textPrimary,
                    fontSize: FontSizeManager.s20.sp,
                  ),
                ),
              ),
              Container(
                padding: EdgeInsets.all(AppPadding.p8.w),
                decoration: BoxDecoration(
                  color: ColorManager.brandPrimary.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.assignment_turned_in_outlined,
                  color: ColorManager.brandPrimary,
                  size: AppSize.s24.sp,
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
          SizedBox(
            width: double.infinity,
            height: AppSize.s55.h,
            child: ElevatedButton(
              onPressed: () => _showConfirmDialog(context),
              style: ElevatedButton.styleFrom(
                backgroundColor: ColorManager.brandPrimary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSize.s100.r),
                ),
                elevation: 0,
              ),
              child: Text(
                buttonLabel,
                style: getBoldTextStyle(
                  color: ColorManager.backgroundSurface,
                  fontSize: FontSizeManager.s18.sp,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
