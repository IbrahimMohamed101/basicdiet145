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
        backgroundColor: ColorManager.backgroundApp,
        appBar: AppBar(
          backgroundColor: ColorManager.backgroundSurface,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: ColorManager.textPrimary),
            onPressed: () => Navigator.pop(context),
          ),
          title: Text(
            Strings.mealTimeline.tr(),
            style: getBoldTextStyle(
              color: ColorManager.textPrimary,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
        ),
        body: BlocBuilder<TimelineBloc, TimelineState>(
          builder: (context, state) {
            if (state is TimelineLoading || state is TimelineInitial) {
              return Center(
                child: CircularProgressIndicator(
                  color: ColorManager.brandPrimary,
                ),
              );
            } else if (state is TimelineError) {
              return Center(child: Text(state.message));
            } else if (state is TimelineLoaded) {
              final days = state.timeline.data.days;

              return SingleChildScrollView(
                padding: EdgeInsets.symmetric(
                  horizontal: AppPadding.p16.w,
                  vertical: AppPadding.p8.h,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ..._buildDaysWithMonthHeaders(
                      context,
                      days,
                      state.timeline.data.premiumMealsRemaining,
                    ),
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

  List<Widget> _buildDaysWithMonthHeaders(
    BuildContext context,
    List<TimelineDayModel> days,
    int premiumMealsRemaining,
  ) {
    final List<Widget> widgets = [];
    String? lastMonth;

    for (int i = 0; i < days.length; i++) {
      final day = days[i];
      final monthLabel = _extractMonthYear(day);

      if (monthLabel != lastMonth) {
        if (lastMonth != null) widgets.add(Gap(AppSize.s8.h));
        widgets.add(_buildMonthHeader(monthLabel, isFirst: lastMonth == null));
        widgets.add(Gap(AppSize.s16.h));
        lastMonth = monthLabel;
      }

      widgets.add(
        Padding(
          padding: EdgeInsets.only(bottom: AppSize.s16.h),
          child: _buildDayItem(context, day, days, i, premiumMealsRemaining),
        ),
      );
    }

    return widgets;
  }

  String _extractMonthYear(TimelineDayModel day) {
    // date is expected as "YYYY-MM-DD"; fall back to month field if parsing fails
    try {
      final parsed = DateTime.parse(day.date);
      return "${day.month} ${parsed.year}";
    } catch (_) {
      return day.month;
    }
  }

  Widget _buildMonthHeader(String monthYear, {bool isFirst = false}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          monthYear,
          style: getBoldTextStyle(
            color: ColorManager.textPrimary,
            fontSize: FontSizeManager.s18.sp,
          ),
        ),
        if (isFirst) ...[
          Gap(AppSize.s4.h),
          Text(
            Strings.tapOnAnyDay.tr(),
            style: getRegularTextStyle(
              color: ColorManager.textSecondary,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ],
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
        color = ColorManager.textMuted;
        bgColor = ColorManager.backgroundSubtle;
        icon = Icons.lock_outline;
        statusText = Strings.locked.tr();
        break;
      case 'planned':
        color = ColorManager.brandPrimary;
        bgColor = ColorManager.brandPrimaryTint;
        borderColor = ColorManager.brandPrimary;
        icon = Icons.check_circle_outline;
        statusText = Strings.planned.tr();
        break;
      case 'frozen':
        color = ColorManager.bluePrimary;
        bgColor = ColorManager.blueSurface;
        borderColor = ColorManager.blueBorder;
        icon = Icons.ac_unit;
        statusText = Strings.frozen.tr();
        break;
      case 'skipped':
        color = ColorManager.brandAccent;
        bgColor = ColorManager.brandAccentSoft;
        borderColor = ColorManager.brandAccentBorder;
        icon = Icons.cancel_outlined;
        statusText = Strings.skipped.tr();
        break;
      case 'extension':
        color = ColorManager.brandAccentPressed;
        bgColor = ColorManager.brandAccentSoft;
        borderColor = ColorManager.brandAccent;
        icon = Icons.add_circle_outline;
        statusText = Strings.extension.tr();
        extraTag = Strings.extensionDay.tr();
        break;
      case 'delivered':
        color = ColorManager.stateSuccessEmphasis;
        bgColor = ColorManager.stateSuccessSurface;
        borderColor = ColorManager.stateSuccess;
        icon = Icons.check_circle;
        statusText = Strings.delivered.tr();
        break;
      case 'delivery_canceled':
        color = ColorManager.stateError;
        bgColor = ColorManager.stateError.withValues(alpha: 0.05);
        borderColor = ColorManager.stateError;
        icon = Icons.local_shipping_outlined;
        statusText = Strings.deliveryCanceled.tr();
        break;
      case 'canceled_at_branch':
        color = ColorManager.stateError;
        bgColor = ColorManager.stateError.withValues(alpha: 0.05);
        borderColor = ColorManager.stateError;
        icon = Icons.store_mall_directory_outlined;
        statusText = Strings.canceledAtBranch.tr();
        break;
      case 'no_show':
        color = ColorManager.textSecondary;
        bgColor = ColorManager.backgroundSubtle;
        borderColor = ColorManager.textSecondary;
        icon = Icons.person_off_outlined;
        statusText = Strings.noShow.tr();
        break;
      case 'open':
      default:
        color = ColorManager.textPrimary;
        bgColor = ColorManager.backgroundSurface;
        borderColor = ColorManager.borderDefault;
        statusText = Strings.open.tr();
        break;
    }

    final String statusLower = day.status.toLowerCase();
    final bool isClickable =
        statusLower == 'open' ||
        statusLower == 'planned' ||
        statusLower == 'extension';
    final bool isReadOnly = statusLower == 'planned';

    return GestureDetector(
      onTap:
          isClickable
              ? () async {
                final result = await Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder:
                        (context) => MealPlannerScreen(
                          timelineDays: days,
                          initialDayIndex: index,
                          premiumMealsRemaining: premiumMealsRemaining,
                          subscriptionId: subscriptionId,
                          readOnly: isReadOnly,
                        ),
                  ),
                );

                if (result == true && context.mounted) {
                  context.read<TimelineBloc>().add(
                    FetchTimelineEvent(subscriptionId),
                  );
                }
              }
              : null,
      child: Container(
        padding: EdgeInsets.all(AppPadding.p16.w),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
          border:
              borderColor != null
                  ? Border.all(color: borderColor)
                  : Border.all(color: ColorManager.transparent),
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
                      color: ColorManager.textMuted,
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
                        color: ColorManager.textSecondary,
                        fontSize: FontSizeManager.s12.sp,
                      ),
                    ),
                  ],
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
      width: double.infinity,
      padding: EdgeInsets.all(AppPadding.p20.w),
      decoration: BoxDecoration(
        color: ColorManager.backgroundSurface,
        borderRadius: BorderRadius.circular(AppSize.s16.r),
        border: Border.all(color: ColorManager.borderDefault),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.statusLegend.tr(),
            style: getBoldTextStyle(
              color: ColorManager.textPrimary,
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
                ColorManager.brandPrimary,
              ),
              _buildLegendItem(
                Strings.open.tr(),
                Icons.crop_square,
                ColorManager.textMuted,
              ),
              _buildLegendItem(
                Strings.locked.tr(),
                Icons.lock_outline,
                ColorManager.textMuted,
              ),
              _buildLegendItem(
                Strings.skipped.tr(),
                Icons.cancel_outlined,
                ColorManager.brandAccent,
              ),
              _buildLegendItem(
                Strings.frozen.tr(),
                Icons.ac_unit,
                ColorManager.bluePrimary,
              ),
              _buildLegendItem(
                Strings.extension.tr(),
                Icons.add_circle_outline,
                ColorManager.brandAccentPressed,
              ),
              _buildLegendItem(
                Strings.delivered.tr(),
                Icons.check_circle,
                ColorManager.stateSuccessEmphasis,
              ),
              _buildLegendItem(
                Strings.deliveryCanceled.tr(),
                Icons.local_shipping_outlined,
                ColorManager.stateError,
              ),
              _buildLegendItem(
                Strings.canceledAtBranch.tr(),
                Icons.store_mall_directory_outlined,
                ColorManager.stateError,
              ),
              _buildLegendItem(
                Strings.noShow.tr(),
                Icons.person_off_outlined,
                ColorManager.textSecondary,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLegendItem(String label, IconData icon, Color color) {
    return Container(
      padding: EdgeInsets.all(2),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: AppSize.s20.w),
          Gap(AppSize.s8.w),
          Text(
            label,
            style: getRegularTextStyle(
              color: ColorManager.textPrimary,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ],
      ),
    );
  }
}
