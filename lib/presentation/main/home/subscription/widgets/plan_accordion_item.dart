import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/presentation/main/home/subscription/widgets/meal_option_card.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class PlanAccordionItem extends StatelessWidget {
  const PlanAccordionItem({
    super.key,
    required this.plan,
    required this.isExpanded,
    required this.onTap,
    this.selectedPlan,
    this.selectedGramOption,
    this.selectedMealOption,
    this.onMealOptionTap,
  });

  final PlanModel plan;
  final bool isExpanded;
  final VoidCallback onTap;
  final PlanModel? selectedPlan;
  final GramOptionModel? selectedGramOption;
  final MealOptionModel? selectedMealOption;
  final void Function(PlanModel, GramOptionModel, MealOptionModel)?
  onMealOptionTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        decoration: BoxDecoration(
          color: ColorManager.backgroundSurface,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
          border: Border.all(
            color: isExpanded
                ? ColorManager.brandPrimary.withValues(alpha: 0.55)
                : ColorManager.borderSubtle,
          ),
          boxShadow: [
            BoxShadow(
              color: isExpanded
                  ? ColorManager.brandPrimaryGlow
                  : ColorManager.textPrimary.withValues(alpha: 0.04),
              blurRadius: 12,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Column(
          children: [
            _PlanHeader(plan: plan, isExpanded: isExpanded),
            if (isExpanded)
              _PlanExpandedContent(
                plan: plan,
                selectedPlan: selectedPlan,
                selectedGramOption: selectedGramOption,
                selectedMealOption: selectedMealOption,
                onMealOptionTap: onMealOptionTap,
              ),
          ],
        ),
      ),
    );
  }
}

class _PlanHeader extends StatelessWidget {
  const _PlanHeader({required this.plan, required this.isExpanded});

  final PlanModel plan;
  final bool isExpanded;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      child: Row(
        children: [
          _CalendarIconBadge(),
          Gap(AppSize.s16.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  plan.name,
                  style: getBoldTextStyle(
                    fontSize: FontSizeManager.s16.sp,
                    color: ColorManager.textPrimary,
                  ),
                ),
                Gap(AppSize.s4.h),
                Text(
                  Strings.chooseDailyMealCount.tr(),
                  style: getRegularTextStyle(
                    fontSize: FontSizeManager.s12.sp,
                    color: ColorManager.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          Icon(
            isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
            color: ColorManager.brandPrimary,
          ),
        ],
      ),
    );
  }
}

class _CalendarIconBadge extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      width: AppSize.s40.w,
      height: AppSize.s40.h,
      decoration: BoxDecoration(
        color: ColorManager.brandPrimaryTint,
        shape: BoxShape.circle,
      ),
      child: Icon(
        Icons.calendar_today_outlined,
        color: ColorManager.brandPrimary,
        size: AppSize.s20.w,
      ),
    );
  }
}

class _PlanExpandedContent extends StatelessWidget {
  const _PlanExpandedContent({
    required this.plan,
    this.selectedPlan,
    this.selectedGramOption,
    this.selectedMealOption,
    this.onMealOptionTap,
  });

  final PlanModel plan;
  final PlanModel? selectedPlan;
  final GramOptionModel? selectedGramOption;
  final MealOptionModel? selectedMealOption;
  final void Function(PlanModel, GramOptionModel, MealOptionModel)?
  onMealOptionTap;

  // Semantic name beats magic number 50.h
  static final _descriptionBarHeight = 50.h;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsetsDirectional.only(
        start: AppPadding.p16.w,
        end: AppPadding.p16.w,
        bottom: AppPadding.p16.h,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _GreenVerticalBar(height: _descriptionBarHeight),
              Gap(AppSize.s12.w),
              Expanded(
                child: Text(
                  Strings.perfectForTrying.tr(),
                  style: getRegularTextStyle(
                    fontSize: FontSizeManager.s14.sp,
                    color: ColorManager.textSecondary,
                  ).copyWith(height: 1.5),
                ),
              ),
            ],
          ),
          Gap(AppSize.s20.h),
          ...plan.gramsOptions.map(
            (g) => _GramSizeSection(
              plan: plan,
              gramOption: g,
              selectedPlan: selectedPlan,
              selectedGramOption: selectedGramOption,
              selectedMealOption: selectedMealOption,
              onMealOptionTap: onMealOptionTap,
            ),
          ),
        ],
      ),
    );
  }
}

class _GreenVerticalBar extends StatelessWidget {
  const _GreenVerticalBar({required this.height});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: AppSize.s4.w,
      height: height,
      decoration: BoxDecoration(
        color: ColorManager.brandPrimary,
        borderRadius: BorderRadius.circular(AppSize.s4.r),
      ),
    );
  }
}

class _GramSizeSection extends StatelessWidget {
  const _GramSizeSection({
    required this.plan,
    required this.gramOption,
    this.selectedPlan,
    this.selectedGramOption,
    this.selectedMealOption,
    this.onMealOptionTap,
  });

  final PlanModel plan;
  final GramOptionModel gramOption;
  final PlanModel? selectedPlan;
  final GramOptionModel? selectedGramOption;
  final MealOptionModel? selectedMealOption;
  final void Function(PlanModel, GramOptionModel, MealOptionModel)?
  onMealOptionTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: EdgeInsets.symmetric(
            horizontal: AppPadding.p12.w,
            vertical: AppPadding.p8.h,
          ),
          decoration: BoxDecoration(
            color: ColorManager.brandPrimaryTint,
            borderRadius: BorderRadius.circular(AppSize.s8.r),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _RestaurantIconBadge(),
              Gap(AppSize.s10.w),
              Text(
                '${gramOption.grams}g ${Strings.size.tr()}',
                style: getBoldTextStyle(
                  color: ColorManager.brandPrimary,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
            ],
          ),
        ),
        Gap(AppSize.s16.h),
        _OptionsGrid(
          plan: plan,
          gramOption: gramOption,
          options: gramOption.mealsOptions,
          selectedPlan: selectedPlan,
          selectedGramOption: selectedGramOption,
          selectedMealOption: selectedMealOption,
          onMealOptionTap: onMealOptionTap,
        ),
        Gap(AppSize.s24.h),
        if (plan.gramsOptions.last != gramOption)
          Padding(
            padding: EdgeInsets.only(bottom: AppSize.s24.h),
            child: Divider(
              color: ColorManager.borderDefault.withValues(alpha: 0.5),
              thickness: 1,
            ),
          ),
      ],
    );
  }
}

class _RestaurantIconBadge extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsetsDirectional.all(AppSize.s4.w),
      decoration: BoxDecoration(
        color: ColorManager.brandPrimary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppSize.s8.r),
      ),
      child: Icon(
        Icons.restaurant_menu,
        color: ColorManager.brandPrimary,
        size: AppSize.s14.sp,
      ),
    );
  }
}

class _OptionsGrid extends StatelessWidget {
  const _OptionsGrid({
    required this.plan,
    required this.gramOption,
    required this.options,
    this.selectedPlan,
    this.selectedGramOption,
    this.selectedMealOption,
    this.onMealOptionTap,
  });

  final PlanModel plan;
  final GramOptionModel gramOption;
  final List<MealOptionModel> options;
  final PlanModel? selectedPlan;
  final GramOptionModel? selectedGramOption;
  final MealOptionModel? selectedMealOption;
  final void Function(PlanModel, GramOptionModel, MealOptionModel)?
  onMealOptionTap;

  @override
  Widget build(BuildContext context) {
    bool isOptionSelected(MealOptionModel option) {
      final selectedMealsCount = selectedMealOption?.mealsPerDay;
      return selectedPlan?.id == plan.id &&
          selectedGramOption?.grams == gramOption.grams &&
          selectedMealsCount == option.mealsPerDay;
    }

    final rows = <Widget>[];
    for (int i = 0; i < options.length; i += 2) {
      rows.add(
        Row(
          children: [
            Expanded(
              child: MealOptionCard(
                option: options[i],
                isSelected: isOptionSelected(options[i]),
                onTap: () =>
                    onMealOptionTap?.call(plan, gramOption, options[i]),
              ),
            ),
            Gap(AppSize.s14.w),
            Expanded(
              child: i + 1 < options.length
                  ? MealOptionCard(
                      option: options[i + 1],
                      isSelected: isOptionSelected(options[i + 1]),
                      onTap: () => onMealOptionTap?.call(
                        plan,
                        gramOption,
                        options[i + 1],
                      ),
                    )
                  : const SizedBox.shrink(),
            ),
          ],
        ),
      );
      if (i + 2 < options.length) rows.add(Gap(AppSize.s14.h));
    }
    return Column(children: rows);
  }
}
