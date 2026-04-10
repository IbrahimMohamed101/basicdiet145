import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_bloc.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_event.dart';
import 'package:basic_diet/presentation/main/home/premium/bloc/premium_meals_state.dart';
import 'package:basic_diet/presentation/main/home/premium/widgets/bottom_actions.dart';
import 'package:basic_diet/presentation/main/home/premium/widgets/premium_info_banner.dart';
import 'package:basic_diet/presentation/main/home/premium/widgets/premium_meal_card.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class PremiumMealsSuccessView extends StatelessWidget {
  final PremiumMealsSuccess state;

  const PremiumMealsSuccessView({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: EdgeInsetsDirectional.symmetric(
              horizontal: AppPadding.p16.w,
              vertical: AppPadding.p20.h,
            ),
            child: Column(
              children: [
                const PremiumInfoBanner(),
                Gap(AppSize.s16.h),
                ...state.premiumMealsModel.meals.map((meal) {
                  final quantity = state.mealCounters[meal.id] ?? 0;
                  return Padding(
                    padding: EdgeInsetsDirectional.only(bottom: AppSize.s16.h),
                    child: PremiumMealCard(
                      meal: meal,
                      quantity: quantity,
                      onIncrement: () => context.read<PremiumMealsBloc>().add(
                        UpdateMealCounterEvent(meal.id, quantity + 1),
                      ),
                      onDecrement: () => context.read<PremiumMealsBloc>().add(
                        UpdateMealCounterEvent(meal.id, quantity - 1),
                      ),
                    ),
                  );
                }),
              ],
            ),
          ),
        ),
        const PremiumMealsBottomActions(),
      ],
    );
  }
}
