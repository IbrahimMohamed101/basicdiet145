import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/presentation/main/subscription/widgets/meal_option_card.dart';
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
  });

  final PlanModel plan;
  final bool isExpanded;
  final VoidCallback onTap;

  // Named so it's easy to adjust in one place
  static const _borderColorCollapsed = Color(0xFFF2F4F7);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        decoration: BoxDecoration(
          color: ColorManager.whiteColor,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
          border: Border.all(
            color: isExpanded
                ? ColorManager.greenPrimary.withValues(alpha: 0.3)
                : _borderColorCollapsed,
          ),
          boxShadow: [
            if (!isExpanded)
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.02),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
          ],
        ),
        child: Column(
          children: [
            _PlanHeader(plan: plan, isExpanded: isExpanded),
            if (isExpanded) _PlanExpandedContent(plan: plan),
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
                    color: ColorManager.black101828,
                  ),
                ),
                Gap(AppSize.s4.h),
                Text(
                  Strings.chooseDailyMealCount,
                  style: getRegularTextStyle(
                    fontSize: FontSizeManager.s12.sp,
                    color: ColorManager.grey6A7282,
                  ),
                ),
              ],
            ),
          ),
          Icon(
            isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
            color: ColorManager.greenPrimary,
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
        color: ColorManager.greenPrimary.withValues(alpha: 0.1),
        shape: BoxShape.circle,
      ),
      child: Icon(
        Icons.calendar_today_outlined,
        color: ColorManager.greenPrimary,
        size: AppSize.s20.w,
      ),
    );
  }
}

class _PlanExpandedContent extends StatelessWidget {
  const _PlanExpandedContent({required this.plan});

  final PlanModel plan;

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
                  Strings.perfectForTrying,
                  style: getRegularTextStyle(
                    fontSize: FontSizeManager.s12.sp,
                    color: ColorManager.black101828.withValues(alpha: 0.8),
                  ).copyWith(height: 1.5),
                ),
              ),
            ],
          ),
          Gap(AppSize.s20.h),
          ...plan.gramsOptions.map((g) => _GramSizeSection(gramOption: g)),
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
        color: ColorManager.greenPrimary,
        borderRadius: BorderRadius.circular(AppSize.s4.r),
      ),
    );
  }
}

class _GramSizeSection extends StatelessWidget {
  const _GramSizeSection({required this.gramOption});

  final GramOptionModel gramOption;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _RestaurantIconBadge(),
            Gap(AppSize.s10.w),
            Text(
              '${gramOption.grams}g ${Strings.size}',
              style: getBoldTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ],
        ),
        Gap(AppSize.s12.h),
        _OptionsGrid(options: gramOption.mealsOptions),
        Gap(AppSize.s24.h),
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
        color: ColorManager.greenPrimary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppSize.s8.r),
      ),
      child: Icon(
        Icons.restaurant_menu,
        color: ColorManager.greenPrimary,
        size: AppSize.s14.sp,
      ),
    );
  }
}

class _OptionsGrid extends StatelessWidget {
  const _OptionsGrid({required this.options});

  final List<MealOptionModel> options;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (int i = 0; i < options.length; i += 2) {
      rows.add(
        Row(
          children: [
            Expanded(child: MealOptionCard(option: options[i])),
            if (i + 1 < options.length) ...[
              Gap(AppSize.s12.w),
              Expanded(child: MealOptionCard(option: options[i + 1])),
            ],
          ],
        ),
      );
      if (i + 2 < options.length) rows.add(Gap(AppSize.s12.h));
    }
    return Column(children: rows);
  }
}
