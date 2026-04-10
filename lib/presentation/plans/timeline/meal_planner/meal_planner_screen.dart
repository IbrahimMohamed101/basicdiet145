import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/categories_with_meals_model.dart';
import 'package:basic_diet/domain/model/timeline_model.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_event.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class MealPlannerScreen extends StatelessWidget {
  final List<TimelineDayModel> timelineDays;
  final int initialDayIndex;
  final int premiumMealsRemaining;

  const MealPlannerScreen({
    super.key,
    required this.timelineDays,
    required this.initialDayIndex,
    required this.premiumMealsRemaining,
  });

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) {
        initMealPlannerModule();
        return instance<MealPlannerBloc>(
          param1: {
            'timelineDays': timelineDays,
            'initialDayIndex': initialDayIndex,
            'premiumMealsRemaining': premiumMealsRemaining,
          },
        )..add(const GetMealPlannerDataEvent());
      },
      child: const MealPlannerView(),
    );
  }
}

class MealPlannerView extends StatelessWidget {
  const MealPlannerView({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: BlocBuilder<MealPlannerBloc, MealPlannerState>(
          builder: (context, state) {
            if (state is MealPlannerLoading) {
              return const Center(child: CircularProgressIndicator());
            } else if (state is MealPlannerError) {
              return Center(child: Text(state.message));
            } else if (state is MealPlannerLoaded) {
              return Stack(
                children: [
                  CustomScrollView(
                    slivers: [
                      SliverToBoxAdapter(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _buildHeader(),
                            Gap(AppSize.s16.h),
                            _buildDateSelector(state),
                            Gap(AppSize.s16.h),
                            _buildBlueBanner(state),
                            Gap(AppSize.s16.h),
                            _buildProgressSection(state),
                            Gap(AppSize.s16.h),
                            _buildPremiumBanner(state),
                            Gap(AppSize.s16.h),
                          ],
                        ),
                      ),
                      SliverPersistentHeader(
                        pinned: true,
                        delegate: _StickyCategoryDelegate(
                          child: Container(
                            color: Colors.white,
                            padding: EdgeInsets.only(bottom: AppSize.s16.h),
                            child: _buildCategorySelector(state, context),
                          ),
                          height: 40.h + AppSize.s16.h,
                        ),
                      ),
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: EdgeInsets.only(bottom: 120.h),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [_buildMealList(state, context)],
                          ),
                        ),
                      ),
                    ],
                  ),
                  _buildBottomAction(state, context),
                  _buildTopNotificationBanner(state, context),
                ],
              );
            }
            return const SizedBox.shrink();
          },
        ),
      ),
    );
  }

  Widget _buildTopNotificationBanner(
    MealPlannerLoaded state,
    BuildContext context,
  ) {
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
                child: Icon(
                  Icons.check,
                  color: Colors.white,
                  size: AppSize.s14.w,
                ),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      Strings.mealAdded,
                      style: getRegularTextStyle(
                        color: const Color(0xFF166534),
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                    Text(
                      "${state.lastAddedMealName} ${Strings.addedTo} ${_getFullDayName(state.timelineDays[state.selectedDayIndex].day)}",
                      style: getRegularTextStyle(
                        color: const Color(0xFF166534),
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: () => context.read<MealPlannerBloc>().add(
                  const HideBannerEvent(),
                ),
                icon: const Icon(
                  Icons.close,
                  color: Color(0xFF166534),
                  size: 16,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.mealPlanner,
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s24.sp,
            ),
          ),
          Gap(AppSize.s4.h),
          Text(
            Strings.planMealsWeekAhead,
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDateSelector(MealPlannerLoaded state) {
    return SizedBox(
      height: 100.h,
      child: ListView.separated(
        padding: EdgeInsets.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: 8.h,
        ),
        scrollDirection: Axis.horizontal,
        itemCount: state.timelineDays.length,
        separatorBuilder: (context, index) => Gap(AppSize.s12.w),
        itemBuilder: (context, index) {
          final day = state.timelineDays[index];
          final isSelected = index == state.selectedDayIndex;
          final isLocked = ![
            'open',
            'planned',
            'extension',
          ].contains(day.status.toLowerCase());
          final isComplete =
              state.selectedMealsPerDay[index]?.length == state.maxMeals;

          Color baseColor;
          Color baseBgColor;
          Color? baseBorderColor;
          String statusText;

          switch (day.status.toLowerCase()) {
            case 'locked':
              baseColor = ColorManager.grey9CA3AF;
              baseBgColor = ColorManager.greyF3F4F6;
              statusText = Strings.locked;
              break;
            case 'planned':
              baseColor = ColorManager.greenPrimary;
              baseBgColor = ColorManager.greenPrimary.withValues(alpha: 0.05);
              baseBorderColor = ColorManager.greenPrimary;
              statusText = Strings.planned;
              break;
            case 'frozen':
              baseColor = ColorManager.bluePrimary;
              baseBgColor = ColorManager.bluePrimary.withValues(alpha: 0.05);
              baseBorderColor = ColorManager.bluePrimary;
              statusText = Strings.frozen;
              break;
            case 'skipped':
              baseColor = ColorManager.orangePrimary;
              baseBgColor = ColorManager.orangePrimary.withValues(alpha: 0.05);
              baseBorderColor = ColorManager.orangePrimary;
              statusText = Strings.skipped;
              break;
            case 'extension':
              baseColor = ColorManager.purplePrimary;
              baseBgColor = ColorManager.purplePrimary.withValues(alpha: 0.05);
              baseBorderColor = ColorManager.purplePrimary;
              statusText = Strings.extension;
              break;
            case 'open':
            default:
              baseColor = ColorManager.black101828;
              baseBgColor = Colors.white;
              baseBorderColor = ColorManager.formFieldsBorderColor;
              statusText = Strings.open;
              break;
          }

          Color textColor = baseColor;
          Color bgColor = baseBgColor;
          Color borderColor = baseBorderColor ?? Colors.transparent;

          if (isComplete) {
            bgColor = ColorManager.greenPrimary;
            borderColor = Colors.transparent;
            textColor = Colors.white;
          } else if (isSelected) {
            borderColor = ColorManager.bluePrimary;
            if (day.status.toLowerCase() == 'open') {
              bgColor = ColorManager.bluePrimary.withValues(alpha: 0.05);
            }
          }

          Color pillBgColor = isComplete
              ? Colors.white.withValues(alpha: 0.2)
              : baseColor;
          Color statusTextColor = Colors.white;

          return GestureDetector(
            onTap: () {
              if (!isLocked) {
                context.read<MealPlannerBloc>().add(ChangeDateEvent(index));
              }
            },
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 70.w,
                  height: 90.h,
                  decoration: BoxDecoration(
                    color: bgColor,
                    borderRadius: BorderRadius.circular(AppSize.s16.r),
                    border: Border.all(color: borderColor),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        day.day,
                        style: getRegularTextStyle(
                          color: textColor,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                      Text(
                        "${day.month} ${day.dayNumber}",
                        style: getBoldTextStyle(
                          color: textColor,
                          fontSize: FontSizeManager.s14.sp,
                        ),
                      ),
                      Gap(AppSize.s8.h),
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 8.w,
                          vertical: 2.h,
                        ),
                        decoration: BoxDecoration(
                          color: pillBgColor,
                          borderRadius: BorderRadius.circular(12.r),
                        ),
                        child: Text(
                          statusText,
                          style: getRegularTextStyle(
                            color: statusTextColor,
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
                        color: ColorManager.greenPrimary,
                        border: Border.all(color: Colors.white, width: 2.w),
                      ),
                      padding: EdgeInsets.all(4.w),
                      child: Icon(Icons.check, color: Colors.white, size: 14.w),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildBlueBanner(MealPlannerLoaded state) {
    final day = state.timelineDays[state.selectedDayIndex];
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: AppPadding.p12.h,
        ),
        decoration: BoxDecoration(
          color: ColorManager.bluePrimary,
          borderRadius: BorderRadius.circular(AppSize.s8.r),
        ),
        child: Row(
          children: [
            Icon(
              Icons.calendar_today,
              color: Colors.white,
              size: AppSize.s18.w,
            ),
            Gap(AppSize.s8.w),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  Strings.planningFor,
                  style: getRegularTextStyle(
                    color: Colors.white70,
                    fontSize: FontSizeManager.s10.sp,
                  ),
                ),
                Text(
                  "${_getFullDayName(day.day)}, ${day.month} ${day.dayNumber}",
                  style: getBoldTextStyle(
                    color: Colors.white,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProgressSection(MealPlannerLoaded state) {
    final selectedCount =
        state.selectedMealsPerDay[state.selectedDayIndex]?.length ?? 0;
    final maxMeals = state.maxMeals;
    bool isComplete = selectedCount == maxMeals;

    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    Strings.dailyMeals,
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s12.sp,
                    ),
                  ),
                  Row(
                    children: [
                      Text(
                        "$selectedCount",
                        style: getBoldTextStyle(
                          color: ColorManager.black101828,
                          fontSize: FontSizeManager.s20.sp,
                        ),
                      ),
                      Text(
                        " ${Strings.of} $maxMeals ${Strings.selected}",
                        style: getBoldTextStyle(
                          color: ColorManager.grey9CA3AF,
                          fontSize: FontSizeManager.s20.sp,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              if (isComplete)
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
                  decoration: BoxDecoration(
                    color: ColorManager.greenPrimary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(AppSize.s16.r),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.circle,
                        color: ColorManager.greenPrimary,
                        size: 8.w,
                      ),
                      Gap(4.w),
                      Text(
                        Strings.complete,
                        style: getRegularTextStyle(
                          color: ColorManager.greenPrimary,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          Gap(AppSize.s8.h),
          LinearProgressIndicator(
            value: selectedCount / maxMeals,
            backgroundColor: ColorManager.formFieldsBorderColor,
            valueColor: AlwaysStoppedAnimation<Color>(
              isComplete ? ColorManager.greenPrimary : ColorManager.bluePrimary,
            ),
            minHeight: 4.h,
            borderRadius: BorderRadius.circular(4.r),
          ),
        ],
      ),
    );
  }

  Widget _buildPremiumBanner(MealPlannerLoaded state) {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: AppPadding.p12.h,
        ),
        decoration: BoxDecoration(
          color: ColorManager.orangeFFF5EC,
          borderRadius: BorderRadius.circular(AppSize.s8.r),
          border: Border.all(color: ColorManager.orangeLight),
        ),
        child: Row(
          children: [
            Container(
              padding: EdgeInsets.all(4.w),
              decoration: BoxDecoration(
                color: ColorManager.orangePrimary,
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.star, color: Colors.white, size: AppSize.s14.w),
            ),
            Gap(AppSize.s12.w),
            Expanded(
              child: Text(
                Strings.premiumMealsRemaining,
                style: getBoldTextStyle(
                  color: ColorManager.black101828,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
            ),
            Text(
              "${state.premiumMealsRemaining} ",
              style: getBoldTextStyle(
                color: ColorManager.orangePrimary,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
            Text(
              Strings.left,
              style: getRegularTextStyle(
                color: ColorManager.orangePrimary,
                fontSize: FontSizeManager.s12.sp,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCategorySelector(MealPlannerLoaded state, BuildContext context) {
    return SizedBox(
      height: 40.h,
      child: ListView.separated(
        padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
        scrollDirection: Axis.horizontal,
        itemCount: state.categoriesWithMeals.data.length,
        separatorBuilder: (context, index) => Gap(AppSize.s8.w),
        itemBuilder: (context, index) {
          final category = state.categoriesWithMeals.data[index];
          final isSelected = index == state.selectedCategoryIndex;

          return GestureDetector(
            onTap: () {
              context.read<MealPlannerBloc>().add(ChangeCategoryEvent(index));
            },
            child: Container(
              padding: EdgeInsets.symmetric(horizontal: AppPadding.p12.w),
              decoration: BoxDecoration(
                color: isSelected
                    ? ColorManager.greenPrimary
                    : ColorManager.greyF3F4F6,
                borderRadius: BorderRadius.circular(AppSize.s8.r),
              ),
              child: Row(
                children: [
                  Text(
                    category.name,
                    style: getBoldTextStyle(
                      color: isSelected
                          ? Colors.white
                          : ColorManager.black101828,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                  Gap(AppSize.s8.w),
                  Container(
                    padding: EdgeInsets.all(4.w),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? Colors.white.withValues(alpha: 0.2)
                          : Colors.white,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      "${category.meals.length}",
                      style: getRegularTextStyle(
                        color: isSelected
                            ? Colors.white
                            : ColorManager.black101828,
                        fontSize: FontSizeManager.s10.sp,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildMealList(MealPlannerLoaded state, BuildContext context) {
    if (state.categoriesWithMeals.data.isEmpty) return const SizedBox.shrink();
    final selectedCategory =
        state.categoriesWithMeals.data[state.selectedCategoryIndex];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: EdgeInsets.symmetric(
            horizontal: AppPadding.p16.w,
            vertical: AppPadding.p8.h,
          ),
          child: Text(
            selectedCategory.name,
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s18.sp,
            ),
          ),
        ),
        ...selectedCategory.meals.map((meal) {
          return Padding(
            padding: EdgeInsets.symmetric(
              horizontal: AppPadding.p16.w,
              vertical: AppPadding.p8.h,
            ),
            child: _buildMealCard(meal, state, context),
          );
        }).toList(),
      ],
    );
  }

  Widget _buildMealCard(
    MealItemModel meal,
    MealPlannerLoaded state,
    BuildContext context,
  ) {
    bool isSelected =
        state.selectedMealsPerDay[state.selectedDayIndex]?.contains(meal.id) ??
        false;
    int selectedCount =
        state.selectedMealsPerDay[state.selectedDayIndex]?.length ?? 0;
    bool isMaxReached = selectedCount >= state.maxMeals;
    bool isNotAvailable = isMaxReached && !isSelected;

    return GestureDetector(
      onTap: isNotAvailable
          ? null
          : () {
              context.read<MealPlannerBloc>().add(
                ToggleMealSelectionEvent(meal.id),
              );
            },
      child: Opacity(
        opacity: isNotAvailable ? 0.5 : 1.0,
        child: Container(
          decoration: BoxDecoration(
            color: isSelected
                ? ColorManager.greenPrimary.withValues(alpha: 0.05)
                : const Color(0xFFFFFFFF),
            borderRadius: BorderRadius.circular(14.r),
            border: Border.all(
              color: isSelected
                  ? ColorManager.greenPrimary
                  : const Color(0xFFE5E7EB),
              width: 1.25.w,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(AppSize.s14.r),
                    ),
                    child: Image.network(
                      meal.imageUrl,
                      height: 150.h,
                      width: double.infinity,
                      fit: BoxFit.cover,
                    ),
                  ),
                  if (isSelected)
                    Positioned(
                      top: 12.h,
                      right: 12.w,
                      child: Container(
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.check_circle,
                          color: ColorManager.greenPrimary,
                          size: 28.w,
                        ),
                      ),
                    ),
                ],
              ),
              Padding(
                padding: EdgeInsets.all(AppPadding.p16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      meal.name,
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontWeight: FontWeight.w600,
                        fontSize: 16.sp,
                        height: 24 / 16,
                        color: const Color(0xFF101828),
                      ),
                    ),
                    Gap(AppSize.s8.h),
                    Text(
                      meal.description,
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontWeight: FontWeight.w400,
                        fontSize: 14.sp,
                        height: 20 / 14,
                        color: const Color(0xFF4A5565),
                      ),
                    ),
                    Gap(AppSize.s12.h),
                    Row(
                      children: [
                        _buildMacroItem(
                          ColorManager.bluePrimary,
                          "${meal.proteinGrams}g",
                          "protein",
                        ),
                        Gap(AppSize.s12.w),
                        _buildMacroItem(
                          ColorManager.orangePrimary,
                          "${meal.carbGrams}g",
                          "carbs",
                        ),
                        Gap(AppSize.s12.w),
                        _buildMacroItem(
                          ColorManager.greenPrimary,
                          "${meal.fatGrams}g",
                          "fat",
                        ),
                      ],
                    ),
                    Gap(AppSize.s16.h),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          "${meal.price} SAR",
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontWeight: FontWeight.w700,
                            fontSize: 18.sp,
                            height: 28 / 18,
                            color: const Color(0xFF101828),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMacroItem(Color color, String value, String label) {
    return Row(
      children: [
        Icon(Icons.circle, color: color, size: 6.w),
        Gap(4.w),
        RichText(
          text: TextSpan(
            children: [
              TextSpan(
                text: value,
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w600,
                  fontSize: 12.sp,
                  height: 16 / 12,
                  color: const Color(0xFF4A5565),
                ),
              ),
              TextSpan(
                text: " $label",
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w400,
                  fontSize: 12.sp,
                  height: 16 / 12,
                  color: const Color(0xFF4A5565),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildBottomAction(MealPlannerLoaded state, BuildContext context) {
    final bool canSave =
        state.isDirty &&
        state.selectedMealsPerDay.values.any((l) => l.isNotEmpty);

    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        padding: EdgeInsets.all(AppPadding.p16.w),
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 10,
              offset: const Offset(0, -5),
            ),
          ],
        ),
        child: SafeArea(
          child: SizedBox(
            width: double.infinity,
            height: 50.h,
            child: ElevatedButton(
              onPressed: canSave
                  ? () => context.read<MealPlannerBloc>().add(
                      const SaveMealPlannerChangesEvent(),
                    )
                  : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: canSave
                    ? ColorManager.greenPrimary
                    : ColorManager.greyF3F4F6,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSize.s8.r),
                ),
              ),
              child: state.isSaving
                  ? const CircularProgressIndicator(color: Colors.white)
                  : Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          canSave ? Icons.save : Icons.save_outlined,
                          color: canSave
                              ? Colors.white
                              : ColorManager.grey9CA3AF,
                          size: AppSize.s20.w,
                        ),
                        Gap(AppSize.s8.w),
                        Text(
                          canSave
                              ? Strings.saveChanges
                              : Strings.noChangesToSave,
                          style: getBoldTextStyle(
                            color: canSave
                                ? Colors.white
                                : ColorManager.grey9CA3AF,
                            fontSize: FontSizeManager.s16.sp,
                          ),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }

  String _getFullDayName(String shortName) {
    switch (shortName.toLowerCase()) {
      case 'mon':
        return 'Monday';
      case 'tue':
        return 'Tuesday';
      case 'wed':
        return 'Wednesday';
      case 'thu':
        return 'Thursday';
      case 'fri':
        return 'Friday';
      case 'sat':
        return 'Saturday';
      case 'sun':
        return 'Sunday';
      default:
        return shortName;
    }
  }
}

class _StickyCategoryDelegate extends SliverPersistentHeaderDelegate {
  final Widget child;
  final double height;

  _StickyCategoryDelegate({required this.child, required this.height});

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return SizedBox.expand(child: child);
  }

  @override
  double get maxExtent => height;

  @override
  double get minExtent => height;

  @override
  bool shouldRebuild(covariant _StickyCategoryDelegate oldDelegate) {
    return oldDelegate.child != child || oldDelegate.height != height;
  }
}
