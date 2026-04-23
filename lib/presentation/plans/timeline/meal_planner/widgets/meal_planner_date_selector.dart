import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_event.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class MealPlannerDateSelector extends StatelessWidget {
  final MealPlannerLoaded state;

  const MealPlannerDateSelector({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 100.h,
      child: ListView.separated(
        padding: EdgeInsets.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: 8.h,
        ),
        scrollDirection: Axis.horizontal,
        itemCount: state.timelineDays.length,
        separatorBuilder: (_, __) => Gap(AppSize.s12.w),
        itemBuilder: (context, index) {
          return _DayCard(
            day: state.timelineDays[index],
            index: index,
            isSelected: index == state.selectedDayIndex,
            isComplete: _isDayComplete(state, index),
          );
        },
      ),
    );
  }

  bool _isDayComplete(MealPlannerLoaded state, int index) {
    final day = state.timelineDays[index];
    return (state.selectedSlotsPerDay[index]
                ?.where((s) => s.proteinId != null && s.carbId != null)
                .length ??
            0) >=
        day.requiredMeals;
  }
}

class _DayCard extends StatelessWidget {
  final TimelineDayModel day;
  final int index;
  final bool isSelected;
  final bool isComplete;

  const _DayCard({
    required this.day,
    required this.index,
    required this.isSelected,
    required this.isComplete,
  });

  @override
  Widget build(BuildContext context) {
    final isLocked = ![
      'open',
      'planned',
      'extension',
    ].contains(day.status.toLowerCase());
    final _DayStyle style = _resolveDayStyle(
      day.status,
      isSelected,
      isComplete,
    );

    return GestureDetector(
      onTap: isLocked
          ? null
          : () => context.read<MealPlannerBloc>().add(ChangeDateEvent(index)),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 70.w,
            height: 90.h,
            decoration: BoxDecoration(
              color: style.bgColor,
              borderRadius: BorderRadius.circular(AppSize.s16.r),
              border: Border.all(color: style.borderColor, width: 2),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  day.day,
                  style: getRegularTextStyle(
                    color: style.textColor,
                    fontSize: FontSizeManager.s12.sp,
                  ),
                ),
                Text(
                  "${day.month} ${day.dayNumber}",
                  style: getBoldTextStyle(
                    color: style.textColor,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
                Gap(AppSize.s8.h),
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 2.h),
                  decoration: BoxDecoration(
                    color: style.pillBgColor,
                    borderRadius: BorderRadius.circular(12.r),
                  ),
                  child: Text(
                    style.statusText,
                    style: getRegularTextStyle(
                      color: ColorManager.textInverse,
                      fontSize: FontSizeManager.s10.sp,
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (isComplete)
            Positioned(
              top: -6.h,
              right: -6.w,
              child: Container(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: ColorManager.brandPrimary,
                  border: Border.all(
                    color: ColorManager.backgroundSurface,
                    width: 2.w,
                  ),
                ),
                padding: EdgeInsets.all(4.w),
                child: Icon(
                  Icons.check,
                  color: ColorManager.textInverse,
                  size: 14.w,
                ),
              ),
            ),
        ],
      ),
    );
  }

  _DayStyle _resolveDayStyle(String status, bool isSelected, bool isComplete) {
    Color baseColor;
    Color baseBgColor;
    Color baseBorderColor;
    String statusText;

    switch (status.toLowerCase()) {
      case 'locked':
        baseColor = ColorManager.textMuted;
        baseBgColor = ColorManager.backgroundSubtle;
        baseBorderColor = ColorManager.transparent;
        statusText = Strings.locked.tr();
        break;
      case 'planned':
        baseColor = ColorManager.brandPrimary;
        baseBgColor = ColorManager.brandPrimaryTint;
        baseBorderColor = ColorManager.brandPrimary;
        statusText = Strings.planned.tr();
        break;
      case 'frozen':
        baseColor = ColorManager.bluePrimary;
        baseBgColor = ColorManager.blueSurface;
        baseBorderColor = ColorManager.blueBorder;
        statusText = Strings.frozen.tr();
        break;
      case 'skipped':
        baseColor = ColorManager.brandAccent;
        baseBgColor = ColorManager.brandAccentSoft;
        baseBorderColor = ColorManager.brandAccentBorder;
        statusText = Strings.skipped.tr();
        break;
      case 'extension':
        baseColor = ColorManager.brandAccentPressed;
        baseBgColor = ColorManager.brandAccentSoft;
        baseBorderColor = ColorManager.brandAccent;
        statusText = Strings.extension.tr();
        break;
      case 'open':
      default:
        baseColor = ColorManager.textPrimary;
        baseBgColor = ColorManager.backgroundSurface;
        baseBorderColor = ColorManager.borderDefault;
        statusText = Strings.open.tr();
        break;
    }

    Color textColor = baseColor;
    Color bgColor = baseBgColor;
    Color borderColor = baseBorderColor;

    if (isComplete) {
      bgColor = ColorManager.brandPrimary;
      borderColor = ColorManager.transparent;
      textColor = ColorManager.textInverse;
      statusText = Strings.planned.tr();
    }
    if (isSelected) {
      borderColor = ColorManager.brandPrimary;
      bgColor = ColorManager.brandPrimary;
      textColor = ColorManager.textInverse;
    }

    final pillBgColor = isComplete || isSelected
        ? ColorManager.textInverse.withValues(alpha: 0.2)
        : baseColor;

    return _DayStyle(
      bgColor: bgColor,
      borderColor: borderColor,
      textColor: textColor,
      pillBgColor: pillBgColor,
      statusText: statusText,
    );
  }
}

class _DayStyle {
  final Color bgColor;
  final Color borderColor;
  final Color textColor;
  final Color pillBgColor;
  final String statusText;

  const _DayStyle({
    required this.bgColor,
    required this.borderColor,
    required this.textColor,
    required this.pillBgColor,
    required this.statusText,
  });
}
