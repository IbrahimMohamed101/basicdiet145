import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/domain/model/pickup_preparation_enums.dart';
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

/// Routes to the correct pickup card based on [PickupFlowStatus] from Overview.
/// For [PickupFlowStatus.inProgress], starts polling via [PickupStatusCubit]
/// and renders the appropriate card based on the polled [PickupDayStatus].
class PickupPreparationSection extends StatelessWidget {
  final CurrentSubscriptionOverviewDataModel data;

  const PickupPreparationSection({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final flowStatus = PickupFlowStatus.fromString(
      data.pickupPreparation!.flowStatus,
    );

    if (flowStatus == PickupFlowStatus.hidden) return const SizedBox.shrink();

    return Column(
      children: [
        Gap(AppSize.s16.h),
        _buildCard(flowStatus),
      ],
    );
  }

  Widget _buildCard(PickupFlowStatus flowStatus) {
    return switch (flowStatus) {
      PickupFlowStatus.available => PickupAvailableCard(data: data),
      PickupFlowStatus.disabled => PickupDisabledCard(data: data),
      PickupFlowStatus.completed => PickupCompletedCard(data: data.pickupPreparation!),
      PickupFlowStatus.inProgress => _PollingSection(subscriptionId: data.id),
      PickupFlowStatus.hidden => const SizedBox.shrink(),
    };
  }
}

class _PollingSection extends StatelessWidget {
  final String subscriptionId;

  const _PollingSection({required this.subscriptionId});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) {
        initPickupStatusModule();
        return instance<PickupStatusCubit>()..startPolling(subscriptionId);
      },
      child: BlocBuilder<PickupStatusCubit, PickupStatusState>(
        builder: (_, state) {
          if (state is PickupStatusLoaded) {
            final dayStatus = PickupDayStatus.fromString(state.data.status);
            return _buildCardFromDayStatus(dayStatus, state);
          }
          return const PickupInProgressCard();
        },
      ),
    );
  }

  Widget _buildCardFromDayStatus(
    PickupDayStatus dayStatus,
    PickupStatusLoaded state,
  ) {
    return switch (dayStatus) {
      PickupDayStatus.readyForPickup ||
      PickupDayStatus.fulfilled =>
        PickupReadyCard(data: state.data),
      PickupDayStatus.noShow ||
      PickupDayStatus.consumedWithoutPreparation =>
        PickupTerminalCard(data: state.data),
      _ => const PickupInProgressCard(),
    };
  }
}
