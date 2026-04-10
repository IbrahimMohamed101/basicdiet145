import 'package:basic_diet/domain/model/plans_model.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_bloc.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_event.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_state.dart';
import 'package:basic_diet/presentation/main/home/subscription/widgets/plan_accordion_item.dart';
import 'package:basic_diet/presentation/main/home/subscription/widgets/subscription_banner.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class SubscriptionContentView extends StatelessWidget {
  const SubscriptionContentView({super.key, required this.plansModel});

  final PlansModel plansModel;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<SubscriptionBloc, SubscriptionState>(
      buildWhen: (previous, current) => current is SubscriptionSuccess,
      builder: (context, state) {
        if (state is! SubscriptionSuccess) {
          return const SizedBox.shrink();
        }

        final selectedPlan = state.selectedPlan;
        final selectedGramOption = state.selectedGramOption;
        final selectedMealOption = state.selectedMealOption;
        final expandedIndex = state.expandedPlanIndex;

        return ListView(
          padding: EdgeInsetsDirectional.symmetric(
            horizontal: AppPadding.p20.w,
          ),
          children: [
            Gap(AppSize.s20.h),
            const SubscriptionBanner(),
            Gap(AppSize.s20.h),
            const _BenefitsRow(),
            Gap(AppSize.s30.h),
            ...List.generate(plansModel.plans.length, (index) {
              return Padding(
                padding: EdgeInsetsDirectional.only(bottom: AppSize.s16.h),
                child: PlanAccordionItem(
                  plan: plansModel.plans[index],
                  isExpanded: expandedIndex == index,
                  onTap: () {
                    context.read<SubscriptionBloc>().add(
                      TogglePlanExpansionEvent(index),
                    );
                  },
                  selectedPlan: selectedPlan,
                  selectedGramOption: selectedGramOption,
                  selectedMealOption: selectedMealOption,
                  onMealOptionTap: (plan, gramOption, option) {
                    context.read<SubscriptionBloc>().add(
                      SelectMealOptionEvent(
                        plan: plan,
                        gramOption: gramOption,
                        option: option,
                      ),
                    );
                  },
                ),
              );
            }),
          ],
        );
      },
    );
  }
}

class _BenefitsRow extends StatelessWidget {
  const _BenefitsRow();

  static const _benefits = [
    Strings.dailyDelivery,
    Strings.variedMenu,
    Strings.guaranteedQuality,
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Center(
          child: Text(
            Strings.vatAndDelivery,
            style: getRegularTextStyle(
              color: ColorManager.grayColor,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ),
        Gap(AppSize.s8.h),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children:
              _benefits
                  .map((text) => _BenefitItem(text: text))
                  .expand((w) => [w, Gap(AppSize.s8.w)])
                  .toList()
                ..removeLast(), // drop trailing gap
        ),
      ],
    );
  }
}

class _BenefitItem extends StatelessWidget {
  const _BenefitItem({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(
          Icons.check,
          color: ColorManager.greenPrimary,
          size: AppSize.s16.sp,
        ),
        Gap(AppSize.s4.w),
        Text(
          text,
          style: getRegularTextStyle(
            color: ColorManager.grey6A7282,
            fontSize: FontSizeManager.s10.sp,
          ),
        ),
      ],
    );
  }
}
