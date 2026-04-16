import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
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
  final String subscriptionId;

  const MealPlannerScreen({
    super.key,
    required this.timelineDays,
    required this.initialDayIndex,
    required this.premiumMealsRemaining,
    required this.subscriptionId,
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
            'subscriptionId': subscriptionId,
          },
        )..add(const GetMealPlannerDataEvent());
      },
      child: BlocListener<MealPlannerBloc, MealPlannerState>(
        listenWhen: (prev, curr) =>
            curr is MealPlannerLoaded &&
            (prev is! MealPlannerLoaded || prev.saveSuccess != curr.saveSuccess),
        listener: (context, state) {
          if (state is MealPlannerLoaded && state.saveSuccess) {
            Navigator.pop(context, true);
          }
        },
        child: const MealPlannerView(),
      ),
    );
  }
}

class MealPlannerView extends StatelessWidget {
  const MealPlannerView({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<MealPlannerBloc, MealPlannerState>(
      builder: (context, state) {
        return Scaffold(
          backgroundColor: Colors.white,
          bottomNavigationBar: state is MealPlannerLoaded
              ? _buildBottomAction(state, context)
              : null,
          body: SafeArea(
            child: Builder(
              builder: (context) {
                if (state is MealPlannerLoading) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (state is MealPlannerError) {
                  return Center(child: Text(state.message));
                }
                if (state is! MealPlannerLoaded) {
                  return const SizedBox.shrink();
                }

                return Stack(
                  children: [
                    CustomScrollView(
                      slivers: [
                        SliverToBoxAdapter(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _buildHeader(context),
                              Gap(AppSize.s16.h),
                              _buildDateSelector(state),
                              Gap(AppSize.s16.h),
                            ],
                          ),
                        ),
                        SliverPadding(
                          padding: EdgeInsets.symmetric(
                            horizontal: AppPadding.p16.w,
                          ),
                          sliver: SliverToBoxAdapter(
                            child: Column(
                              children: [
                                _MealPlannerProgressIndicator(
                                  selectedMeals: _selectedMealsCount(state),
                                  totalMeals: state.maxMeals,
                                  premiumLeft: _premiumLeftForDay(state),
                                ),
                                Gap(AppSize.s16.h),
                              ],
                            ),
                          ),
                        ),
                        SliverPadding(
                          padding: EdgeInsets.only(
                            left: AppPadding.p16.w,
                            right: AppPadding.p16.w,
                            bottom: 24.h,
                          ),
                          sliver: SliverList.separated(
                            itemCount: state.maxMeals,
                            separatorBuilder: (_, __) => Gap(AppSize.s12.h),
                            itemBuilder: (context, index) {
                              final slot = _slotForIndex(state, index);
                              final protein = slot?.proteinId == null
                                  ? null
                                  : _findProteinById(
                                      state.menu,
                                      slot!.proteinId!,
                                    );
                              final carb = slot?.carbId == null
                                  ? null
                                  : _findCarbById(
                                      state.menu,
                                      slot!.carbId!,
                                    );

                              return _MealSlotCard(
                                slotNumber: index + 1,
                                protein: protein,
                                carb: carb,
                                isProteinPremium: protein?.isPremium ?? false,
                                onSelectProtein: () => _openProteinPickerSheet(
                                  context: context,
                                  state: state,
                                  slotIndex: index,
                                  selectedProteinId: slot?.proteinId,
                                ),
                                carbOptions: _sortedCarbs(state.menu),
                                onCarbSelected: protein == null
                                    ? null
                                    : (carbId) => context
                                        .read<MealPlannerBloc>()
                                        .add(
                                          SetMealSlotCarbEvent(
                                            slotIndex: index,
                                            carbId: carbId,
                                          ),
                                        ),
                                onClear: protein == null
                                    ? null
                                    : () => context.read<MealPlannerBloc>().add(
                                          SetMealSlotProteinEvent(
                                            slotIndex: index,
                                            proteinId: null,
                                          ),
                                        ),
                              );
                            },
                          ),
                        ),
                      ],
                    ),
                    _buildTopNotificationBanner(state, context),
                  ],
                );
              },
            ),
          ),
        );
      },
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

  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              IconButton(
                onPressed: () => Navigator.pop(context),
                icon:
                    const Icon(Icons.arrow_back, color: ColorManager.black101828),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
              const Spacer(),
            ],
          ),
          Gap(AppSize.s12.h),
          Text(
            Strings.mealPlanner.tr(),
            style: getBoldTextStyle(
              color: ColorManager.black101828,
              fontSize: FontSizeManager.s24.sp,
            ),
          ),
          Gap(AppSize.s4.h),
          Text(
            Strings.planMealsWeekAhead.tr(),
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ],
      ),
    );
  }

  // Keep as-is (top days slider).
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
              (state.selectedSlotsPerDay[index]
                          ?.where(
                            (s) => s.proteinId != null && s.carbId != null,
                          )
                          .length ??
                      0) >=
                  day.requiredMeals;

          Color baseColor;
          Color baseBgColor;
          Color? baseBorderColor;
          String statusText;

          switch (day.status.toLowerCase()) {
            case 'locked':
              baseColor = ColorManager.grey9CA3AF;
              baseBgColor = ColorManager.greyF3F4F6;
              statusText = Strings.locked.tr();
              break;
            case 'planned':
              baseColor = ColorManager.greenPrimary;
              baseBgColor = ColorManager.greenPrimary.withValues(alpha: 0.05);
              baseBorderColor = ColorManager.greenPrimary;
              statusText = Strings.planned.tr();
              break;
            case 'frozen':
              baseColor = ColorManager.bluePrimary;
              baseBgColor = ColorManager.bluePrimary.withValues(alpha: 0.05);
              baseBorderColor = ColorManager.bluePrimary;
              statusText = Strings.frozen.tr();
              break;
            case 'skipped':
              baseColor = ColorManager.orangePrimary;
              baseBgColor = ColorManager.orangePrimary.withValues(alpha: 0.05);
              baseBorderColor = ColorManager.orangePrimary;
              statusText = Strings.skipped.tr();
              break;
            case 'extension':
              baseColor = ColorManager.purplePrimary;
              baseBgColor = ColorManager.purplePrimary.withValues(alpha: 0.05);
              baseBorderColor = ColorManager.purplePrimary;
              statusText = Strings.extension.tr();
              break;
            case 'open':
            default:
              baseColor = ColorManager.black101828;
              baseBgColor = Colors.white;
              baseBorderColor = ColorManager.formFieldsBorderColor;
              statusText = Strings.open.tr();
              break;
          }

          Color textColor = baseColor;
          Color bgColor = baseBgColor;
          Color borderColor = baseBorderColor ?? Colors.transparent;

          if (isComplete) {
            bgColor = ColorManager.greenPrimary;
            borderColor = Colors.transparent;
            textColor = Colors.white;
            statusText = Strings.planned.tr();
          } else if (isSelected) {
            borderColor = ColorManager.bluePrimary;
            if (day.status.toLowerCase() == 'open') {
              bgColor = ColorManager.bluePrimary.withValues(alpha: 0.05);
            }
          }

          Color pillBgColor =
              isComplete ? Colors.white.withValues(alpha: 0.2) : baseColor;
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
                      child:
                          Icon(Icons.check, color: Colors.white, size: 14.w),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  int _selectedMealsCount(MealPlannerLoaded state) {
    final slots = state.selectedSlotsPerDay[state.selectedDayIndex] ?? [];
    var count = 0;
    for (final slot in slots) {
      if (slot.proteinId != null && slot.carbId != null) {
        count++;
      }
    }
    return count;
  }

  int _premiumLeftForDay(MealPlannerLoaded state) {
    final usedCredits = _premiumCreditsUsed(state);
    final left = state.premiumMealsRemaining - usedCredits;
    return left < 0 ? 0 : left;
  }

  int _premiumCreditsUsed(MealPlannerLoaded state) {
    var used = 0;
    for (final entry in state.selectedSlotsPerDay.entries) {
      for (final slot in entry.value) {
        final proteinId = slot.proteinId;
        if (proteinId == null) continue;
        final protein = _findProteinById(state.menu, proteinId);
        if (protein == null) continue;
        if (protein.isPremium) {
          used += protein.premiumCreditCost == 0 ? 1 : protein.premiumCreditCost;
        }
      }
    }
    return used;
  }

  MealPlannerSlotSelection? _slotForIndex(
    MealPlannerLoaded state,
    int slotIndex,
  ) {
    final slots = state.selectedSlotsPerDay[state.selectedDayIndex] ?? [];
    if (slotIndex < 0 || slotIndex >= slots.length) return null;
    return slots[slotIndex];
  }

  List<BuilderCarbModel> _sortedCarbs(MealPlannerMenuModel menu) {
    final carbs = List<BuilderCarbModel>.from(menu.builderCatalog.carbs);
    carbs.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return carbs;
  }

  BuilderProteinModel? _findProteinById(MealPlannerMenuModel menu, String id) {
    for (final protein in menu.builderCatalog.proteins) {
      if (protein.id == id) return protein;
    }
    return null;
  }

  BuilderCarbModel? _findCarbById(MealPlannerMenuModel menu, String id) {
    for (final carb in menu.builderCatalog.carbs) {
      if (carb.id == id) return carb;
    }
    return null;
  }

  bool _isBeefDisabledForSlot({
    required MealPlannerLoaded state,
    required int slotIndex,
    required BuilderProteinModel? currentProtein,
  }) {
    final beefRule = state.menu.builderCatalog.rules.beef;
    if (beefRule.maxSlotsPerDay <= 0) return false;

    final slots = state.selectedSlotsPerDay[state.selectedDayIndex] ?? [];
    var beefSlotsCount = 0;
    for (final slot in slots) {
      final proteinId = slot.proteinId;
      if (proteinId == null) continue;
      final protein = _findProteinById(state.menu, proteinId);
      if (protein?.proteinFamilyKey == beefRule.proteinFamilyKey) {
        beefSlotsCount++;
      }
    }

    final currentIsBeef =
        currentProtein?.proteinFamilyKey == beefRule.proteinFamilyKey;
    return beefSlotsCount >= beefRule.maxSlotsPerDay && !currentIsBeef;
  }

  Future<void> _openProteinPickerSheet({
    required BuildContext context,
    required MealPlannerLoaded state,
    required int slotIndex,
    required String? selectedProteinId,
  }) {
    final bloc = context.read<MealPlannerBloc>();
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => BlocProvider.value(
        value: bloc,
        child: _ProteinPickerSheet(
          state: state,
          slotIndex: slotIndex,
          selectedProteinId: selectedProteinId,
        ),
      ),
    );
  }

  Widget _buildBottomAction(MealPlannerLoaded state, BuildContext context) {
    bool hasCompletedDay = false;
    for (int i = 0; i < state.timelineDays.length; i++) {
      final required = state.timelineDays[i].requiredMeals;
      final slots = state.selectedSlotsPerDay[i] ?? [];
      final completeSlotsCount = slots
          .where((s) => s.proteinId != null && s.carbId != null)
          .length;
      if (completeSlotsCount >= required) {
        hasCompletedDay = true;
        break;
      }
    }

    final bool canSave = state.isDirty && hasCompletedDay;

    return Container(
      padding: EdgeInsets.all(AppPadding.p16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 12,
            offset: const Offset(0, -6),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          width: double.infinity,
          height: 56.h,
          child: ElevatedButton(
            onPressed: canSave
                ? () => context.read<MealPlannerBloc>().add(
                      const SaveMealPlannerChangesEvent(),
                    )
                : null,
            style: ElevatedButton.styleFrom(
              backgroundColor:
                  canSave ? ColorManager.greenPrimary : ColorManager.greyF3F4F6,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s16.r),
              ),
            ),
            child: state.isSaving
                ? const CircularProgressIndicator(color: Colors.white)
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.check,
                        color: canSave ? Colors.white : ColorManager.grey9CA3AF,
                        size: AppSize.s20.w,
                      ),
                      Gap(AppSize.s8.w),
                      Text(
                        canSave
                            ? Strings.saveChanges.tr()
                            : Strings.noChangesToSave.tr(),
                        style: getBoldTextStyle(
                          color:
                              canSave ? Colors.white : ColorManager.grey9CA3AF,
                          fontSize: FontSizeManager.s16.sp,
                        ),
                      ),
                    ],
                  ),
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

class _MealPlannerProgressIndicator extends StatelessWidget {
  final int selectedMeals;
  final int totalMeals;
  final int premiumLeft;

  const _MealPlannerProgressIndicator({
    required this.selectedMeals,
    required this.totalMeals,
    required this.premiumLeft,
  });

  @override
  Widget build(BuildContext context) {
    final isAllSelected = totalMeals > 0 && selectedMeals >= totalMeals;
    final activeColor =
        isAllSelected ? ColorManager.greenPrimary : ColorManager.bluePrimary;

    return Row(
      children: [
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                height: 32.w,
                width: 32.w,
                decoration: BoxDecoration(
                  color: activeColor.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.check,
                  color: activeColor,
                  size: 18.w,
                ),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "$selectedMeals ${Strings.of.tr()} $totalMeals ${Strings.meals.tr()} ${Strings.selected.tr()}",
                      style: getRegularTextStyle(
                        color: ColorManager.black101828,
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                    Gap(8.h),
                    Row(
                      children: List.generate(totalMeals, (index) {
                        final isFilled = index < selectedMeals;
                        return Container(
                          width: 20.w,
                          height: 4.h,
                          margin: EdgeInsets.only(
                            right:  6.w,
                          ),
                          decoration: BoxDecoration(
                            color: isFilled
                                ? activeColor
                                : ColorManager.greyF3F4F6,
                            borderRadius: BorderRadius.circular(99.r),
                          ),
                        );
                      }),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Gap(AppSize.s12.w),
        Container(
          padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
          decoration: BoxDecoration(
            color: ColorManager.orangeFFF5EC,
            border: Border.all(color: ColorManager.orangeLight),
            borderRadius: BorderRadius.circular(AppSize.s12.r),
          ),
          child: Row(
            children: [
              Icon(
                Icons.workspace_premium,
                color: ColorManager.orangePrimary,
                size: 18.w,
              ),
              Gap(6.w),
              Text(
                "$premiumLeft ${Strings.premiumMealsText.tr()} ${Strings.left.tr()}",
                style: getBoldTextStyle(
                  color: ColorManager.orangePrimary,
                  fontSize: FontSizeManager.s12.sp,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _MealSlotCard extends StatelessWidget {
  final int slotNumber;
  final BuilderProteinModel? protein;
  final BuilderCarbModel? carb;
  final bool isProteinPremium;
  final VoidCallback onSelectProtein;
  final List<BuilderCarbModel> carbOptions;
  final void Function(String carbId)? onCarbSelected;
  final VoidCallback? onClear;

  const _MealSlotCard({
    required this.slotNumber,
    required this.protein,
    required this.carb,
    required this.isProteinPremium,
    required this.onSelectProtein,
    required this.carbOptions,
    required this.onCarbSelected,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final isComplete = protein != null && carb != null;
    final borderColor = isComplete
        ? isProteinPremium
            ? ColorManager.orangeLight
            : ColorManager.greenPrimary.withValues(alpha: 0.35)
        : ColorManager.formFieldsBorderColor;

    final bgColor = isComplete
        ? isProteinPremium
            ? ColorManager.orangeFFF5EC.withValues(alpha: 0.6)
            : ColorManager.greenPrimary.withValues(alpha: 0.05)
        : Colors.white;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          padding: EdgeInsets.all(AppPadding.p16.w),
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: BorderRadius.circular(AppSize.s16.r),
            border: Border.all(color: borderColor),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    height: 40.w,
                    width: 40.w,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: isComplete
                          ? isProteinPremium
                              ? ColorManager.orangePrimary
                              : ColorManager.greenPrimary
                          : ColorManager.greyF3F4F6,
                      borderRadius: BorderRadius.circular(AppSize.s14.r),
                    ),
                    child: Text(
                      "$slotNumber",
                      style: getBoldTextStyle(
                        color: isComplete
                            ? Colors.white
                            : ColorManager.grey9CA3AF,
                        fontSize: FontSizeManager.s18.sp,
                      ),
                    ),
                  ),
                  Gap(AppSize.s12.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "${Strings.meal.tr()} $slotNumber",
                          style: getBoldTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s16.sp,
                          ),
                        ),
                        Gap(2.h),
                        Text(
                          isComplete
                              ? Strings.complete.tr()
                              : Strings.buildYourMeal.tr(),
                          style: getRegularTextStyle(
                            color: ColorManager.grey6A7282,
                            fontSize: FontSizeManager.s12.sp,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (onClear != null && protein != null)
                    IconButton(
                      onPressed: onClear,
                      icon: Icon(
                        Icons.close,
                        size: 18.w,
                        color: ColorManager.grey6A7282,
                      ),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                ],
              ),
              Gap(AppSize.s16.h),
              _PlannerField(
                title: Strings.selectProtein.tr(),
                value: protein?.name ?? Strings.selectMeal.tr(),
                isSelected: protein != null,
                isPremium: isProteinPremium && protein != null,
                onTap: onSelectProtein,
              ),
              Gap(AppSize.s12.h),
              _PlannerField(
                title: Strings.selectCarb.tr(),
                value: carb?.name ?? Strings.selectMeal.tr(),
                isSelected: carb != null,
                isPremium: false,
                onTap: onCarbSelected == null
                    ? () {}
                    : () => _openCarbPickerSheet(context),
                isDisabled: onCarbSelected == null,
              ),
            ],
          ),
        ),
        if (isProteinPremium && protein != null)
          Positioned(
            top: -10.h,
            right: -6.w,
            child: Container(
              padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 6.h),
              decoration: BoxDecoration(
                color: ColorManager.orangePrimary,
                borderRadius: BorderRadius.circular(99.r),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.12),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.star,
                    color: Colors.white,
                    size: 14.w,
                  ),
                  Gap(4.w),
                  Text(
                    Strings.premiumMealsText.tr(),
                    style: getBoldTextStyle(
                      color: Colors.white,
                      fontSize: FontSizeManager.s12.sp,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _openCarbPickerSheet(BuildContext context) {
    final bloc = context.read<MealPlannerBloc>();
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => BlocProvider.value(
        value: bloc,
        child: _CarbPickerSheet(
          options: carbOptions,
          selectedId: carb?.id,
          slotIndex: slotNumber - 1,
        ),
      ),
    );
  }
}

class _PlannerField extends StatelessWidget {
  final String title;
  final String value;
  final bool isSelected;
  final bool isPremium;
  final VoidCallback onTap;
  final bool isDisabled;

  const _PlannerField({
    required this.title,
    required this.value,
    required this.isSelected,
    required this.isPremium,
    required this.onTap,
    this.isDisabled = false,
  });

  @override
  Widget build(BuildContext context) {
    final bgColor = isSelected
        ? (isPremium
            ? ColorManager.orangeFFF5EC
            : ColorManager.bluePrimary.withValues(alpha: 0.06))
        : ColorManager.greyF3F4F6.withValues(alpha: 0.8);

    final borderColor = isSelected
        ? (isPremium
            ? ColorManager.orangeLight
            : ColorManager.bluePrimary.withValues(alpha: 0.25))
        : Colors.transparent;

    return Opacity(
      opacity: isDisabled ? 0.5 : 1.0,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
          Gap(8.h),
          GestureDetector(
            onTap: isDisabled ? null : onTap,
            child: Container(
              width: double.infinity,
              padding: EdgeInsets.symmetric(
                horizontal: AppPadding.p16.w,
                vertical: AppPadding.p14.h,
              ),
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(AppSize.s14.r),
                border: Border.all(color: borderColor),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: getBoldTextStyle(
                        color: isSelected
                            ? ColorManager.black101828
                            : ColorManager.grey6A7282,
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                  ),
                  Icon(
                    Icons.keyboard_arrow_down,
                    color: ColorManager.grey6A7282,
                    size: 22.w,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CarbPickerSheet extends StatelessWidget {
  final List<BuilderCarbModel> options;
  final String? selectedId;
  final int slotIndex;

  const _CarbPickerSheet({
    required this.options,
    required this.selectedId,
    required this.slotIndex,
  });

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.4,
      maxChildSize: 0.9,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(AppSize.s24.r),
            ),
          ),
          child: Column(
            children: [
              Gap(AppSize.s10.h),
              Container(
                width: 48.w,
                height: 5.h,
                decoration: BoxDecoration(
                  color: ColorManager.greyF3F4F6,
                  borderRadius: BorderRadius.circular(99.r),
                ),
              ),
              Gap(AppSize.s12.h),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        Strings.selectCarb.tr(),
                        style: getBoldTextStyle(
                          color: ColorManager.black101828,
                          fontSize: FontSizeManager.s18.sp,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: Icon(
                        Icons.close,
                        color: ColorManager.grey6A7282,
                        size: 20.w,
                      ),
                    ),
                  ],
                ),
              ),
              Gap(AppSize.s8.h),
              Expanded(
                child: ListView.separated(
                  controller: scrollController,
                  padding: EdgeInsets.only(
                    left: AppPadding.p16.w,
                    right: AppPadding.p16.w,
                    bottom: 24.h,
                  ),
                  itemCount: options.length,
                  separatorBuilder: (_, __) => Gap(AppSize.s10.h),
                  itemBuilder: (context, index) {
                    final carb = options[index];
                    final isSelected = selectedId == carb.id;

                    return GestureDetector(
                      onTap: () {
                        context.read<MealPlannerBloc>().add(
                              SetMealSlotCarbEvent(
                                slotIndex: slotIndex,
                                carbId: carb.id,
                              ),
                            );
                        Navigator.pop(context);
                      },
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: EdgeInsets.all(AppPadding.p12.w),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? ColorManager.bluePrimary.withValues(alpha: 0.06)
                              : Colors.white,
                          borderRadius: BorderRadius.circular(AppSize.s16.r),
                          border: Border.all(
                            color: isSelected
                                ? ColorManager.bluePrimary
                                : ColorManager.formFieldsBorderColor,
                          ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                carb.name,
                                style: getBoldTextStyle(
                                  color: ColorManager.black101828,
                                  fontSize: FontSizeManager.s14.sp,
                                ),
                              ),
                            ),
                            Gap(AppSize.s8.w),
                            Icon(
                              isSelected
                                  ? Icons.check_circle
                                  : Icons.radio_button_unchecked,
                              color: isSelected
                                  ? ColorManager.bluePrimary
                                  : ColorManager.grey9CA3AF,
                              size: 22.w,
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ProteinPickerSheet extends StatefulWidget {
  final MealPlannerLoaded state;
  final int slotIndex;
  final String? selectedProteinId;

  const _ProteinPickerSheet({
    required this.state,
    required this.slotIndex,
    required this.selectedProteinId,
  });

  @override
  State<_ProteinPickerSheet> createState() => _ProteinPickerSheetState();
}

class _ProteinPickerSheetState extends State<_ProteinPickerSheet> {
  late String _activeTabKey;

  BuilderProteinModel? _proteinById(String id) {
    for (final protein in widget.state.menu.builderCatalog.proteins) {
      if (protein.id == id) return protein;
    }
    return null;
  }

  /// Returns a fixed emoji for each known protein family / tab key.
  String _iconForTabKey(String key) {
    switch (key.toLowerCase()) {
      case 'chicken':
        return '🍗';
      case 'beef':
        return '🥩';
      case 'seafood':
        return '🦐';
      case 'egg':
        return '🥚';
      case 'premium':
        return '⭐';
      default:
        return '🍽️';
    }
  }

  @override
  void initState() {
    super.initState();
    _activeTabKey = 'premium';
    final selectedProtein = widget.selectedProteinId == null
        ? null
        : _proteinById(widget.selectedProteinId!);

    if (selectedProtein != null && selectedProtein.isPremium) {
      _activeTabKey = 'premium';
    } else if (selectedProtein != null) {
      _activeTabKey = selectedProtein.displayCategoryKey;
    }
  }

  @override
  Widget build(BuildContext context) {
    final allCategories = widget.state.menu.builderCatalog.categories
        .where((c) => c.dimension == 'protein')
        .toList()
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

    if (allCategories.isEmpty) {
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppSize.s24.r),
          ),
        ),
        padding: EdgeInsets.all(AppPadding.p16.w),
        child: SafeArea(
          child: Text(
            Strings.noContent.tr(),
            style: getRegularTextStyle(
              color: ColorManager.grey6A7282,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ),
      );
    }

    final selectedProtein = widget.selectedProteinId == null
        ? null
        : _proteinById(widget.selectedProteinId!);

    final beefRule = widget.state.menu.builderCatalog.rules.beef;
    final slots =
        widget.state.selectedSlotsPerDay[widget.state.selectedDayIndex] ?? [];
    var beefCount = 0;
    for (final slot in slots) {
      final proteinId = slot.proteinId;
      if (proteinId == null) continue;
      final protein = _proteinById(proteinId);
      if (protein != null &&
          protein.proteinFamilyKey == beefRule.proteinFamilyKey) {
        beefCount++;
      }
    }
    final currentIsBeef =
        selectedProtein?.proteinFamilyKey == beefRule.proteinFamilyKey;
    final isBeefDisabled =
        beefRule.maxSlotsPerDay > 0 &&
        beefCount >= beefRule.maxSlotsPerDay &&
        !currentIsBeef;

    // Build tab list: premium first, then regular categories
    final tabs = [
      _ProteinTab(key: 'premium', label: Strings.premium.tr()),
      ...allCategories.map((c) => _ProteinTab(key: c.key, label: c.name)),
    ];

    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(AppSize.s24.r),
            ),
          ),
          child: Column(
            children: [
              Gap(AppSize.s10.h),
              Container(
                width: 48.w,
                height: 5.h,
                decoration: BoxDecoration(
                  color: ColorManager.greyF3F4F6,
                  borderRadius: BorderRadius.circular(99.r),
                ),
              ),
              Gap(AppSize.s12.h),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        Strings.selectProtein.tr(),
                        style: getBoldTextStyle(
                          color: ColorManager.black101828,
                          fontSize: FontSizeManager.s18.sp,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: Icon(
                        Icons.close,
                        color: ColorManager.grey6A7282,
                        size: 20.w,
                      ),
                    ),
                  ],
                ),
              ),
              Gap(AppSize.s4.h),
              // Category tabs: icon card + label below
              SizedBox(
                height: 88.h,
                child: ListView.separated(
                  padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
                  scrollDirection: Axis.horizontal,
                  itemCount: tabs.length,
                  separatorBuilder: (_, __) => Gap(AppSize.s12.w),
                  itemBuilder: (context, index) {
                    final tab = tabs[index];
                    final isSelected = tab.key == _activeTabKey;
                    final isPremiumTab = tab.key == 'premium';
                    final isBeefTab =
                        tab.key == beefRule.proteinFamilyKey && !isPremiumTab;
                    final isTabDisabled = isBeefTab && isBeefDisabled;

                    final activeCardColor = isPremiumTab
                        ? ColorManager.orangePrimary
                        : ColorManager.bluePrimary;

                    return GestureDetector(
                      onTap: isTabDisabled
                          ? null
                          : () => setState(() => _activeTabKey = tab.key),
                      child: Opacity(
                        opacity: isTabDisabled ? 0.4 : 1.0,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              width: 56.w,
                              height: 56.w,
                              decoration: BoxDecoration(
                                color: isSelected
                                    ? activeCardColor
                                    : ColorManager.whiteColor,
                                borderRadius:
                                    BorderRadius.circular(AppSize.s16.r),
                                border: isSelected
                                    ? null
                                    : Border.all(
                                        color: isPremiumTab
                                            ? ColorManager.orangeLight
                                            : ColorManager.formFieldsBorderColor,
                                      ),
                              ),
                              alignment: Alignment.center,
                              child: Text(
                                _iconForTabKey(tab.key),
                                style: TextStyle(fontSize: 26.sp),
                              ),
                            ),
                            Gap(6.h),
                            Text(
                              tab.label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: getBoldTextStyle(
                                color: isSelected
                                    ? (isPremiumTab
                                        ? ColorManager.orangePrimary
                                        : ColorManager.bluePrimary)
                                    : ColorManager.grey6A7282,
                                fontSize: FontSizeManager.s10.sp,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
              Gap(AppSize.s12.h),
              Expanded(
                child: ListView.separated(
                  controller: scrollController,
                  padding: EdgeInsets.only(
                    left: AppPadding.p16.w,
                    right: AppPadding.p16.w,
                    bottom: 24.h,
                  ),
                  itemCount: _filteredProteins(
                    widget.state.menu,
                    _activeTabKey,
                  ).length,
                  separatorBuilder: (_, __) => Gap(AppSize.s10.h),
                  itemBuilder: (context, index) {
                    final proteins = _filteredProteins(
                      widget.state.menu,
                      _activeTabKey,
                    );
                    final protein = proteins[index];
                    final isSelected = widget.selectedProteinId == protein.id;
                    final isPremium = protein.isPremium;
                    final isItemDisabled = isBeefDisabled &&
                        protein.proteinFamilyKey == beefRule.proteinFamilyKey &&
                        !currentIsBeef;

                    return GestureDetector(
                      onTap: isItemDisabled
                          ? null
                          : () {
                              context.read<MealPlannerBloc>().add(
                                    SetMealSlotProteinEvent(
                                      slotIndex: widget.slotIndex,
                                      proteinId: protein.id,
                                    ),
                                  );
                              Navigator.pop(context);
                            },
                      child: Opacity(
                        opacity: isItemDisabled ? 0.4 : 1.0,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: EdgeInsets.all(AppPadding.p12.w),
                          decoration: BoxDecoration(
                            color: isSelected
                                ? ColorManager.bluePrimary
                                    .withValues(alpha: 0.06)
                                : Colors.white,
                            borderRadius: BorderRadius.circular(AppSize.s16.r),
                            border: Border.all(
                              color: isSelected
                                  ? ColorManager.bluePrimary
                                  : ColorManager.formFieldsBorderColor,
                            ),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            protein.name,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: getBoldTextStyle(
                                              color: ColorManager.black101828,
                                              fontSize: FontSizeManager.s14.sp,
                                            ),
                                          ),
                                        ),
                                        if (isPremium) ...[
                                          Gap(AppSize.s8.w),
                                          Container(
                                            padding: EdgeInsets.symmetric(
                                              horizontal: 8.w,
                                              vertical: 3.h,
                                            ),
                                            decoration: BoxDecoration(
                                              color: ColorManager.orangeFFF5EC,
                                              borderRadius:
                                                  BorderRadius.circular(99.r),
                                              border: Border.all(
                                                color: ColorManager.orangeLight,
                                              ),
                                            ),
                                            child: Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Icon(
                                                  Icons.workspace_premium,
                                                  color:
                                                      ColorManager.orangePrimary,
                                                  size: 12.w,
                                                ),
                                                Gap(3.w),
                                                Text(
                                                  Strings.premium.tr(),
                                                  style: getBoldTextStyle(
                                                    color: ColorManager
                                                        .orangePrimary,
                                                    fontSize:
                                                        FontSizeManager.s10.sp,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                    if(protein.description.isNotEmpty)...[
                                      Gap(4.h),
                                      Text(
                                        protein.description,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: getRegularTextStyle(
                                          color: ColorManager.grey4A5565,
                                          fontSize: FontSizeManager.s12.sp,
                                        ),
                                      ),
                                    ],

                                  ],
                                ),
                              ),
                              Gap(AppSize.s8.w),
                              Icon(
                                isSelected
                                    ? Icons.check_circle
                                    : Icons.radio_button_unchecked,
                                color: isSelected
                                    ? ColorManager.bluePrimary
                                    : ColorManager.grey9CA3AF,
                                size: 22.w,
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  List<BuilderProteinModel> _filteredProteins(
    MealPlannerMenuModel menu,
    String tabKey,
  ) {
    final proteins = menu.builderCatalog.proteins;
    final filtered = tabKey == 'premium'
        ? proteins.where((p) => p.isPremium).toList()
        : proteins
            .where((p) => !p.isPremium && p.displayCategoryKey == tabKey)
            .toList();
    filtered.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return filtered;
  }
}

/// Simple data class for tab entries.
class _ProteinTab {
  final String key;
  final String label;
  const _ProteinTab({required this.key, required this.label});
}
