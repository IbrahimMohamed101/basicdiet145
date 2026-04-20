import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_bloc.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_event.dart';
import 'package:basic_diet/presentation/plans/bloc/plans_state.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/meal_planner_screen.dart';
import 'package:basic_diet/presentation/plans/widgets/no_subscription_view.dart';
import 'package:basic_diet/presentation/plans/widgets/pickup_preparation/pickup_preparation_section.dart';
import 'package:basic_diet/presentation/plans/widgets/plans_action_buttons.dart';
import 'package:basic_diet/presentation/plans/widgets/plans_header.dart';
import 'package:basic_diet/presentation/plans/widgets/subscription_plan_card.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class PlansScreen extends StatelessWidget {
  const PlansScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) {
        initPlansModule();
        return instance<PlansBloc>()
          ..add(FetchCurrentSubscriptionOverviewEvent());
      },
      child: BlocListener<PlansBloc, PlansState>(
        listener: _onStateChanged,
        child: Scaffold(
          backgroundColor: Colors.white,
          body: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppPadding.p16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: AppSize.s8),
                  const PlansHeader(),
                  const SizedBox(height: AppSize.s24),
                  BlocBuilder<PlansBloc, PlansState>(
                    builder: _buildBody,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _onStateChanged(BuildContext context, PlansState state) {
    if (state is NavigateToMealPlannerState) {
      initMealPlannerModule();
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => MealPlannerScreen(
            timelineDays: state.timelineDays,
            initialDayIndex: state.initialDayIndex,
            premiumMealsRemaining: state.premiumMealsRemaining,
            subscriptionId: state.subscriptionId,
          ),
        ),
      ).then((_) {
        if (context.mounted) {
          context
              .read<PlansBloc>()
              .add(FetchCurrentSubscriptionOverviewEvent());
        }
      });
    }
  }

  Widget _buildBody(BuildContext context, PlansState state) {
    if (state is PlansLoading || state is PlansInitial) {
      return const Center(
        child: CircularProgressIndicator(color: ColorManager.greenPrimary),
      );
    }

    if (state is PlansError && state.data == null) {
      return Center(child: Text(state.message));
    }

    final data = state.data?.data;

    if (data == null) return const NoSubscriptionView();

    return Stack(
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SubscriptionPlanCard(data: data),
            Gap(AppSize.s16.h),
            PlansActionButtons(data: data),
            if (data.pickupPreparation != null &&
                data.pickupPreparation!.flowStatus != 'hidden')
              PickupPreparationSection(data: data),
            Gap(AppSize.s24.h),
          ],
        ),
        if (state is OpenPlannerLoading || state is PreparePickupLoading)
          Positioned.fill(
            child: Container(
              color: Colors.white.withValues(alpha: 0.5),
              child: const Center(
                child: CircularProgressIndicator(
                  color: ColorManager.greenPrimary,
                ),
              ),
            ),
          ),
      ],
    );
  }
}
