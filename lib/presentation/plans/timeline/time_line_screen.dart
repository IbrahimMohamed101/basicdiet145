import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/presentation/plans/timeline/bloc/timeline_bloc.dart';
import 'package:basic_diet/presentation/plans/timeline/bloc/timeline_event.dart';
import 'package:basic_diet/presentation/plans/timeline/bloc/timeline_state.dart';
import 'package:flutter/material.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/meal_planner_screen.dart';

class TimeLineScreen extends StatelessWidget {
  final String subscriptionId;

  const TimeLineScreen({super.key, required this.subscriptionId});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) {
        initTimelineModule();
        return instance<TimelineBloc>()
          ..add(FetchTimelineEvent(subscriptionId));
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        appBar: AppBar(
          backgroundColor: Colors.white,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: ColorManager.black101828),
            onPressed: () => Navigator.pop(context),
          ),
          title: Text(
            Strings.mealTimeline.tr(),
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
        ),
        body: BlocBuilder<TimelineBloc, TimelineState>(
          builder: (context, state) {
            if (state is TimelineLoading || state is TimelineInitial) {
              return const Center(
                child: CircularProgressIndicator(
                  color: ColorManager.greenPrimary,
                ),
              );
            } else if (state is TimelineError) {
              return Center(child: Text(state.message));
            } else if (state is TimelineLoaded) {
              final days = state.timeline.data.days;

              // Extract first month from data
              String currentMonthYear = "";
              if (days.isNotEmpty) {
                currentMonthYear = "${days.first.month} 2026";
              }

              return SingleChildScrollView(
                padding: EdgeInsets.symmetric(
                  horizontal: AppPadding.p16.w,
                  vertical: AppPadding.p8.h,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildMonthHeader(currentMonthYear),
                    Gap(AppSize.s24.h),
                    ...days.asMap().entries.map((entry) {
                      return Padding(
                        padding: EdgeInsets.only(bottom: AppSize.s16.h),
                        child: _buildDayItem(
                          context,
                          entry.value,
                          days,
                          entry.key,
                          state.timeline.data.premiumMealsRemaining,
                        ),
                      );
                    }),
                    Gap(AppSize.s16.h),
                    _buildStatusLegend(),
                    Gap(AppSize.s40.h),
                  ],
                ),
              );
            }
            return const SizedBox.shrink();
          },
        ),
      ),
    );
  }

  Widget _buildMonthHeader(String monthYear) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          monthYear,
          style: getBoldTextStyle(
            color: ColorManager.black101828,
            fontSize: FontSizeManager.s18.sp,
          ),
        ),
        Gap(AppSize.s4.h),
        Text(
          Strings.tapOnAnyDay.tr(),
          style: getRegularTextStyle(
            color: ColorManager.grey6A7282,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
      ],
    );
  }

  Widget _buildDayItem(
    BuildContext context,
    TimelineDayModel day,
    List<TimelineDayModel> days,
    int index,
    int premiumMealsRemaining,
  ) {
    Color color;
    Color bgColor;
    Color? borderColor;
    IconData? icon;
    String statusText;
    String? extraTag;

    switch (day.status.toLowerCase()) {
      case 'locked':
        color = ColorManager.grey9CA3AF;
        bgColor = ColorManager.greyF3F4F6;
        icon = Icons.lock_outline;
        statusText = Strings.locked.tr();
        break;
      case 'planned':
        color = ColorManager.greenPrimary;
        bgColor = ColorManager.greenPrimary.withValues(alpha: 0.05);
        borderColor = ColorManager.greenPrimary;
        icon = Icons.check_circle_outline;
        statusText = Strings.planned.tr();
        break;
      case 'frozen':
        color = ColorManager.bluePrimary;
        bgColor = ColorManager.bluePrimary.withValues(alpha: 0.05);
        borderColor = ColorManager.bluePrimary;
        icon = Icons.ac_unit;
        statusText = Strings.frozen.tr();
        break;
      case 'skipped':
        color = ColorManager.orangePrimary;
        bgColor = ColorManager.orangePrimary.withValues(alpha: 0.05);
        borderColor = ColorManager.orangePrimary;
        icon = Icons.cancel_outlined;
        statusText = Strings.skipped.tr();
        break;
      case 'extension':
        color = ColorManager.purplePrimary;
        bgColor = ColorManager.purplePrimary.withValues(alpha: 0.05);
        borderColor = ColorManager.purplePrimary;
        icon = Icons.add_circle_outline;
        statusText = Strings.extension.tr();
        extraTag = Strings.extensionDay.tr();
        break;
      case 'open':
      default:
        color = ColorManager.black101828;
        bgColor = Colors.white;
        borderColor = ColorManager.formFieldsBorderColor;
        statusText = Strings.open.tr();
        break;
    }

    bool isClickable = day.status.toLowerCase() == 'open' ||
        day.status.toLowerCase() == 'planned' ||
        day.status.toLowerCase() == 'extension';

    return GestureDetector(
      onTap: isClickable ? () async {
        final result = await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => MealPlannerScreen(
              timelineDays: days,
              initialDayIndex: index,
              premiumMealsRemaining: premiumMealsRemaining,
              subscriptionId: subscriptionId,
            ),
          ),
        );

        if (result == true && context.mounted) {
          context.read<TimelineBloc>().add(FetchTimelineEvent(subscriptionId));
        }
      } : null,
      child: Container(
        padding: EdgeInsets.all(AppPadding.p16.w),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
          border: borderColor != null
              ? Border.all(color: borderColor)
              : Border.all(color: Colors.transparent),
        ),
      child: Row(
        children: [
          SizedBox(
            width: AppSize.s40.w,
            child: Column(
              children: [
                Text(
                  day.day.toUpperCase(),
                  style: getRegularTextStyle(
                    color: ColorManager.grey9CA3AF,
                    fontSize: FontSizeManager.s10.sp,
                  ),
                ),
                Text(
                  day.dayNumber.toString(),
                  style: getBoldTextStyle(
                    color: color,
                    fontSize: FontSizeManager.s18.sp,
                  ),
                ),
              ],
            ),
          ),
          Gap(AppSize.s16.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  statusText,
                  style: getBoldTextStyle(
                    color: color,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                if (extraTag != null) ...[
                  Gap(AppSize.s4.h),
                  Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: AppPadding.p8.w,
                      vertical: AppPadding.p2.h,
                    ),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(AppSize.s4.r),
                    ),
                    child: Text(
                      extraTag,
                      style: getRegularTextStyle(
                        color: color,
                        fontSize: FontSizeManager.s10.sp,
                      ),
                    ),
                  ),
                ],
                if (day.selectedMeals > 0) ...[
                  Gap(AppSize.s4.h),
                  Text(
                    "${day.selectedMeals}/${day.requiredMeals} ${Strings.meals.tr()}",
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s12.sp,
                    ),
                  ),
                ]
              ],
            ),
          ),
          if (icon != null) Icon(icon, color: color, size: AppSize.s24.w),
        ],
      ),
      ),
    );
  }

  Widget _buildStatusLegend() {
    return Container(
      padding: EdgeInsets.all(AppPadding.p20.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
        border: Border.all(color: ColorManager.formFieldsBorderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.statusLegend.tr(),
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s16.sp,
            ),
          ),
          Gap(AppSize.s16.h),
          Wrap(
            spacing: AppSize.s24.w,
            runSpacing: AppSize.s16.h,
            children: [
              _buildLegendItem(
                Strings.planned.tr(),
                Icons.check_circle_outline,
                ColorManager.greenPrimary,
              ),
              _buildLegendItem(
                Strings.open.tr(),
                Icons.crop_square,
                ColorManager.grey9CA3AF,
              ),
              _buildLegendItem(
                Strings.locked.tr(),
                Icons.lock_outline,
                ColorManager.grey9CA3AF,
              ),
              _buildLegendItem(
                Strings.skipped.tr(),
                Icons.cancel_outlined,
                ColorManager.orangePrimary,
              ),
              _buildLegendItem(
                Strings.frozen.tr(),
                Icons.ac_unit,
                ColorManager.bluePrimary,
              ),
              _buildLegendItem(
                Strings.extension.tr(),
                Icons.add_circle_outline,
                ColorManager.purplePrimary,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLegendItem(String label, IconData icon, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: color, size: AppSize.s20.w),
        Gap(AppSize.s8.w),
        Text(
          label,
          style: getRegularTextStyle(
            color: ColorManager.black101828,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
      ],
    );
  }
}
