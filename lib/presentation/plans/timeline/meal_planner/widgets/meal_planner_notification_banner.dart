import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_event.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class MealPlannerNotificationBanner extends StatelessWidget {
  final MealPlannerLoaded state;

  const MealPlannerNotificationBanner({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return AnimatedPositioned(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
      top: state.showSavedBanner ? AppPadding.p16.h : -120.h,
      left: AppPadding.p16.w,
      right: AppPadding.p16.w,
      child: Material(
        color: Colors.transparent,
        child: Container(
          padding: EdgeInsets.all(AppPadding.p12.w),
          decoration: BoxDecoration(
            color: const Color(0xFFF0FDF4),
            border: Border.all(color: const Color(0xFFBBF7D0)),
            borderRadius: BorderRadius.circular(AppSize.s8.r),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.05),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: Color(0xFF16A34A),
                ),
                padding: EdgeInsets.all(4.w),
                child: Icon(Icons.check, color: Colors.white, size: AppSize.s14.w),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      Strings.mealAdded.tr(),
                      style: getRegularTextStyle(
                        color: const Color(0xFF166534),
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                    Text(
                      "${state.lastAddedMealName} ${Strings.addedTo.tr()} ${_getFullDayName(state.timelineDays[state.selectedDayIndex].day)}",
                      style: getRegularTextStyle(
                        color: const Color(0xFF166534),
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: () =>
                    context.read<MealPlannerBloc>().add(const HideBannerEvent()),
                icon: const Icon(Icons.close, color: Color(0xFF166534), size: 16),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _getFullDayName(String shortName) {
    switch (shortName.toLowerCase()) {
      case 'mon':
        return Strings.monday.tr();
      case 'tue':
        return Strings.tuesday.tr();
      case 'wed':
        return Strings.wednesday.tr();
      case 'thu':
        return Strings.thursday.tr();
      case 'fri':
        return Strings.friday.tr();
      case 'sat':
        return Strings.saturday.tr();
      case 'sun':
        return Strings.sunday.tr();
      default:
        return shortName;
    }
  }
}
