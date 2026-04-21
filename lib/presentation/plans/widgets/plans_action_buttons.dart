import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_bloc.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_event.dart';
import 'package:basic_diet/presentation/plans/timeline/time_line_screen.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class PlansActionButtons extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel data;

  const PlansActionButtons({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: _buildTimelineButton(context)),
        Gap(AppSize.s12.w),
        Expanded(child: _buildTodaysMealsButton(context)),
      ],
    );
  }

  Widget _buildTimelineButton(BuildContext context) {
    return ElevatedButton(
      onPressed: () async {
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => TimeLineScreen(subscriptionId: data.id),
          ),
        );
        if (context.mounted) {
          context.read<PlansBloc>().add(
            FetchCurrentSubscriptionOverviewEvent(),
          );
        }
      },
      style: ElevatedButton.styleFrom(
        backgroundColor: ColorManager.greenPrimary,
        padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSize.s12),
        ),
        elevation: 0,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.calendar_today_outlined,
            color: Colors.white,
            size: AppSize.s18,
          ),
          Gap(AppSize.s8.w),
          Text(
            Strings.viewTimeline.tr(),
            style: getRegularTextStyle(
              color: Colors.white,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTodaysMealsButton(BuildContext context) {
    return OutlinedButton(
      onPressed:
          () => context.read<PlansBloc>().add(
            FetchTimelineAndOpenPlannerEvent(
              data.id,
              openCurrentDay: true,
              preferredDate: data.businessDate,
            ),
          ),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsetsDirectional.symmetric(
          vertical: AppPadding.p16,
        ),
        foregroundColor: ColorManager.black101828,
        side: const BorderSide(color: ColorManager.formFieldsBorderColor),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSize.s12.r),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.access_time,
            color: ColorManager.black101828,
            size: AppSize.s18,
          ),
          Gap(AppSize.s8.w),
          Text(
            Strings.todaysMeals.tr(),
            style: getRegularTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ],
      ),
    );
  }
}
