import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/presentation/plans/pickup_status/pickup_status_cubit.dart';
import 'package:basic_diet/presentation/plans/widgets/pickup_preparation/pickup_available_card.dart';
import 'package:basic_diet/presentation/plans/widgets/pickup_preparation/pickup_completed_card.dart';
import 'package:basic_diet/presentation/plans/widgets/pickup_preparation/pickup_disabled_card.dart';
import 'package:basic_diet/presentation/plans/widgets/pickup_preparation/pickup_in_progress_card.dart';
import 'package:basic_diet/presentation/plans/widgets/pickup_preparation/pickup_ready_card.dart';
import 'package:basic_diet/presentation/plans/widgets/pickup_preparation/pickup_terminal_card.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

/// Routes to the correct pickup card based on flowStatus from Overview.
/// For in_progress, starts polling via PickupStatusCubit and renders
/// the appropriate card based on the polled status.
class PickupPreparationSection extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel data;

  const PickupPreparationSection({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final flowStatus = data.pickupPreparation!.flowStatus;

    if (flowStatus == 'hidden') return const SizedBox.shrink();

    return Column(
      children: [
        Gap(AppSize.s16.h),
        _buildCard(context, flowStatus),
      ],
    );
  }

  Widget _buildCard(BuildContext context, String flowStatus) {
    return switch (flowStatus) {
      'available' => PickupAvailableCard(data: data),
      'disabled' => PickupDisabledCard(data: data),
      'completed' => const PickupCompletedCard(),
      'in_progress' => _buildPollingSection(),
      _ => const SizedBox.shrink(),
    };
  }

  Widget _buildPollingSection() {
    return BlocProvider(
      create: (_) {
        initPickupStatusModule();
        return instance<PickupStatusCubit>()..startPolling(data.id);
      },
      child: BlocBuilder<PickupStatusCubit, PickupStatusState>(
        builder: (context, state) {
          if (state is PickupStatusLoaded) {
            return _buildCardFromPolledStatus(state);
          }
          return const PickupInProgressCard();
        },
      ),
    );
  }

  Widget _buildCardFromPolledStatus(PickupStatusLoaded state) {
    final status = state.data.status;

    return switch (status) {
      'ready_for_pickup' || 'fulfilled' => PickupReadyCard(data: state.data),
      'no_show' || 'consumed_without_preparation' =>
        PickupTerminalCard(data: state.data),
      _ => const PickupInProgressCard(),
    };
  }
}
