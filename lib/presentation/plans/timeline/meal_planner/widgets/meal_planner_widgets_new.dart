import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/domain/model/subscription_day_model.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc_correct.dart';
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

/// Progress Indicator that uses backend's paymentRequirement (NOT local calculation)
/// API Guide: اعتمد 100% على paymentRequirement و plannerMeta العائدين من الـ backend
class MealPlannerProgressIndicatorNew extends StatelessWidget {
  final MealPlannerLoadedNew state;

  const MealPlannerProgressIndicatorNew({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    // Count complete slots from backend's mealSlots
    final completeSlots = state.currentSlots
        .where((s) => s.proteinId != null && s.carbId != null)
        .length;
    
    final totalSlots = state.plannerMeta?.requiredSlotCount ?? state.currentSlots.length;
    
    // API Guide: Use backend's paymentRequirement (NOT local calculation)
    final requiresPayment = state.paymentRequirement?.requiresPayment ?? false;
    final premiumPending = state.paymentRequirement?.premiumPendingPaymentCount ?? 0;
    final paymentAmountSAR = (state.paymentRequirement?.amountHalala ?? 0) / 100.0;

    final isAllSelected = totalSlots > 0 && completeSlots >= totalSlots;
    final activeColor = isAllSelected ? ColorManager.greenPrimary : ColorManager.bluePrimary;

    return Column(
      children: [
        Row(
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
                          "$completeSlots ${Strings.of.tr()} $totalSlots ${Strings.meals.tr()} ${Strings.selected.tr()}",
                          style: getRegularTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s14.sp,
                          ),
                        ),
                        Gap(8.h),
                        Row(
                          children: List.generate(totalSlots, (index) {
                            final isFilled = index < completeSlots;
                            return Container(
                              width: 20.w,
                              height: 4.h,
                              margin: EdgeInsets.only(right: 6.w),
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
          ],
        ),
        
        // Payment requirement banner (from backend - ALWAYS SHOW PRICE)
        // API Guide: إذا requiresPayment === true → انتقل للخطوة payment
        if (requiresPayment) ...[
          Gap(AppSize.s12.h),
          Container(
            padding: EdgeInsets.all(AppPadding.p12.w),
            decoration: BoxDecoration(
              color: ColorManager.orangeFFF5EC,
              border: Border.all(color: ColorManager.orangeLight),
              borderRadius: BorderRadius.circular(AppSize.s12.r),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.payment,
                  color: ColorManager.orangePrimary,
                  size: 20.w,
                ),
                Gap(AppSize.s12.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        Strings.paymentRequired.tr(),
                        style: getBoldTextStyle(
                          color: ColorManager.orangePrimary,
                          fontSize: FontSizeManager.s14.sp,
                        ),
                      ),
                      Gap(4.h),
                      Text(
                        "${Strings.youSelected.tr()} $premiumPending ${Strings.extraPremiumMeals.tr()}",
                        style: getRegularTextStyle(
                          color: ColorManager.orangePrimary,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                      Text(
                        "${Strings.totalAmount.tr()}: ${paymentAmountSAR.toStringAsFixed(2)} ${Strings.sar.tr()}",
                        style: getBoldTextStyle(
                          color: ColorManager.orangePrimary,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// Meal Slot Card that supports slot errors from backend validation
class MealSlotCardNew extends StatelessWidget {
  final int slotNumber;
  final BuilderProteinModel? protein;
  final BuilderCarbModel? carb;
  final bool isProteinPremium;
  final VoidCallback onSelectProtein;
  final List<BuilderCarbModel> carbOptions;
  final void Function(String carbId)? onCarbSelected;
  final VoidCallback? onClear;
  final SlotErrorModel? slotError;

  const MealSlotCardNew({
    super.key,
    required this.slotNumber,
    required this.protein,
    required this.carb,
    required this.isProteinPremium,
    required this.onSelectProtein,
    required this.carbOptions,
    required this.onCarbSelected,
    required this.onClear,
    this.slotError,
  });

  @override
  Widget build(BuildContext context) {
    final isComplete = protein != null && carb != null;
    final hasError = slotError != null;
    
    final borderColor = hasError
        ? Colors.red
        : isComplete
            ? isProteinPremium
                ? ColorManager.orangeLight
                : ColorManager.greenPrimary.withValues(alpha: 0.35)
            : ColorManager.formFieldsBorderColor;

    final bgColor = hasError
        ? Colors.red.withValues(alpha: 0.05)
        : isComplete
            ? isProteinPremium
                ? ColorManager.orangeFFF5EC.withValues(alpha: 0.6)
                : ColorManager.greenPrimary.withValues(alpha: 0.05)
            : Colors.white;

    return Column(
      children: [
        Stack(
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
                          color: hasError
                              ? Colors.red
                              : isComplete
                                  ? isProteinPremium
                                      ? ColorManager.orangePrimary
                                      : ColorManager.greenPrimary
                                  : ColorManager.greyF3F4F6,
                          borderRadius: BorderRadius.circular(AppSize.s14.r),
                        ),
                        child: Text(
                          "$slotNumber",
                          style: getBoldTextStyle(
                            color: isComplete || hasError
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
                              hasError
                                  ? Strings.error.tr()
                                  : isComplete
                                      ? Strings.complete.tr()
                                      : Strings.buildYourMeal.tr(),
                              style: getRegularTextStyle(
                                color: hasError
                                    ? Colors.red
                                    : ColorManager.grey6A7282,
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
        ),
        
        // API Guide: عرض نتيجة validate → إظهار slotErrors أسفل كل slot معني
        if (hasError) ...[
          Gap(AppSize.s8.h),
          Container(
            padding: EdgeInsets.all(AppPadding.p8.w),
            decoration: BoxDecoration(
              color: Colors.red.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(AppSize.s8.r),
              border: Border.all(color: Colors.red.withValues(alpha: 0.3)),
            ),
            child: Row(
              children: [
                Icon(Icons.error_outline, color: Colors.red, size: 16.w),
                Gap(AppSize.s8.w),
                Expanded(
                  child: Text(
                    slotError!.message,
                    style: getRegularTextStyle(
                      color: Colors.red,
                      fontSize: FontSizeManager.s12.sp,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Future<void> _openCarbPickerSheet(BuildContext context) {
    final bloc = context.read<MealPlannerBlocCorrect>();
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => BlocProvider.value(
        value: bloc,
        child: _CarbPickerSheetNew(
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

class _CarbPickerSheetNew extends StatelessWidget {
  final List<BuilderCarbModel> options;
  final String? selectedId;
  final int slotIndex;

  const _CarbPickerSheetNew({
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
                        // API Guide: المستخدم يغير وجبة → تحديث local draft ثم POST /selection/validate
                        context.read<MealPlannerBlocCorrect>().add(
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
