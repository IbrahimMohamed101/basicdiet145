import 'package:basic_diet/domain/model/current_subscription_overview_model.dart';
import 'package:basic_diet/domain/model/pickup_preparation_enums.dart';
import 'package:basic_diet/domain/model/pickup_status_model.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:easy_localization/easy_localization.dart';

enum PickupJourneyStepState { locked, active, completed }

enum PickupJourneyAction { none, openPlanner, prepareOrder }

enum PickupJourneyVisualState { idle, progress, completion }

class PickupJourneyStepViewState {
  final String label;
  final PickupJourneyStepState state;

  const PickupJourneyStepViewState({required this.label, required this.state});
}

class PickupJourneyProgressItemViewState {
  final String title;
  final PickupJourneyStepState state;

  const PickupJourneyProgressItemViewState({
    required this.title,
    required this.state,
  });
}

class PickupPreparationViewState {
  final String title;
  final String subtitle;
  final String? primaryActionLabel;
  final PickupJourneyAction primaryAction;
  final PickupJourneyVisualState visualState;
  final List<PickupJourneyStepViewState> steps;
  final List<PickupJourneyProgressItemViewState> progressItems;
  final String? pickupCode;
  final bool showPickupCode;
  final bool showProgressTimeline;
  final String businessDate;

  const PickupPreparationViewState({
    required this.title,
    required this.subtitle,
    required this.primaryActionLabel,
    required this.primaryAction,
    required this.visualState,
    required this.steps,
    required this.progressItems,
    required this.pickupCode,
    required this.showPickupCode,
    required this.showProgressTimeline,
    required this.businessDate,
  });

  factory PickupPreparationViewState.fromData(
    CurrentSubscriptionOverviewDataModel overview, {
    PickupStatusDataModel? pickupStatus,
    required bool isArabic,
  }) {
    final prep = overview.pickupPreparation!;
    final flowStatus = PickupFlowStatus.fromString(prep.flowStatus);
    final blockedReason = PickupBlockedReason.fromString(prep.reason);
    final dayStatus =
        pickupStatus == null
            ? null
            : PickupDayStatus.fromString(pickupStatus.status);
    final resolvedBusinessDate =
        prep.businessDate.isNotEmpty
            ? prep.businessDate
            : overview.businessDate;

    if (_shouldOpenPlanner(flowStatus, blockedReason, prep)) {
      return PickupPreparationViewState(
        title: Strings.pickupStartOrderTitle.tr(),
        subtitle: Strings.pickupStartOrderSubtitle.tr(),
        primaryActionLabel: _plannerCta(prep, isArabic),
        primaryAction: PickupJourneyAction.openPlanner,
        visualState: PickupJourneyVisualState.idle,
        steps: _steps(const [
          PickupJourneyStepState.active,
          PickupJourneyStepState.locked,
          PickupJourneyStepState.locked,
        ]),
        progressItems: const [],
        pickupCode: null,
        showPickupCode: false,
        showProgressTimeline: false,
        businessDate: resolvedBusinessDate,
      );
    }

    if (flowStatus == PickupFlowStatus.available && prep.canRequestPrepare) {
      return PickupPreparationViewState(
        title: Strings.pickupReadyTitle.tr(),
        subtitle: Strings.pickupReadySubtitle.tr(),
        primaryActionLabel: _prepareCta(prep),
        primaryAction: PickupJourneyAction.prepareOrder,
        visualState: PickupJourneyVisualState.idle,
        steps: _steps(const [
          PickupJourneyStepState.completed,
          PickupJourneyStepState.active,
          PickupJourneyStepState.locked,
        ]),
        progressItems: const [],
        pickupCode: null,
        showPickupCode: false,
        showProgressTimeline: false,
        businessDate: resolvedBusinessDate,
      );
    }

    if (flowStatus == PickupFlowStatus.inProgress || pickupStatus != null) {
      final progressStates = _progressStatesFor(dayStatus);
      final isReady = dayStatus == PickupDayStatus.readyForPickup;
      final isTerminal =
          dayStatus == PickupDayStatus.fulfilled ||
          dayStatus == PickupDayStatus.noShow ||
          dayStatus == PickupDayStatus.consumedWithoutPreparation;
      final completionCopy = _completionCopyFromStatus(
        dayStatus,
        pickupStatus,
        prep,
      );
      final title =
          isTerminal
              ? completionCopy.$1
              : (isReady
                  ? Strings.pickupReadyToCollectTitle.tr()
                  : Strings.pickupTrackingTitle.tr());
      final fallbackSubtitle =
          isTerminal
              ? completionCopy.$2
              : (isReady
                  ? Strings.pickupReadyToCollectSubtitle.tr()
                  : Strings.pickupTrackingSubtitle.tr());

      return PickupPreparationViewState(
        title: title,
        subtitle: _localizedMessage(
          prep,
          pickupStatus?.message,
          isArabic,
        ).ifEmpty(fallbackSubtitle),
        primaryActionLabel: null,
        primaryAction: PickupJourneyAction.none,
        visualState:
            isReady || isTerminal
                ? PickupJourneyVisualState.completion
                : PickupJourneyVisualState.progress,
        steps: _steps(_stepStatesForProgress(dayStatus)),
        progressItems: _progressItems(progressStates),
        pickupCode: pickupStatus?.pickupCode,
        showPickupCode:
            (pickupStatus?.pickupCode ?? '').isNotEmpty && dayStatus != null,
        showProgressTimeline: true,
        businessDate: resolvedBusinessDate,
      );
    }

    final completion = _completionCopy(prep, isArabic);
    return PickupPreparationViewState(
      title: completion.$1,
      subtitle: completion.$2,
      primaryActionLabel: null,
      primaryAction: PickupJourneyAction.none,
      visualState: PickupJourneyVisualState.completion,
      steps: _steps(const [
        PickupJourneyStepState.completed,
        PickupJourneyStepState.completed,
        PickupJourneyStepState.completed,
      ]),
      progressItems: _progressItems(const [
        PickupJourneyStepState.completed,
        PickupJourneyStepState.completed,
        PickupJourneyStepState.completed,
      ]),
      pickupCode: null,
      showPickupCode: false,
      showProgressTimeline: flowStatus == PickupFlowStatus.completed,
      businessDate: resolvedBusinessDate,
    );
  }

  static bool _shouldOpenPlanner(
    PickupFlowStatus flowStatus,
    PickupBlockedReason reason,
    PickupPreparationModel prep,
  ) {
    if (flowStatus != PickupFlowStatus.disabled) return false;
    if (reason == PickupBlockedReason.planningIncomplete &&
        prep.showMealPlannerCta) {
      return true;
    }
    return !prep.planningReady &&
        prep.showMealPlannerCta &&
        !prep.canRequestPrepare;
  }

  static String _plannerCta(PickupPreparationModel prep, bool isArabic) {
    final backendLabel =
        isArabic ? prep.mealPlannerCtaLabelAr : prep.mealPlannerCtaLabelEn;
    return backendLabel.isNotEmpty
        ? backendLabel
        : Strings.pickupChooseMealsAction.tr();
  }

  static String _prepareCta(PickupPreparationModel prep) {
    if (prep.buttonLabel.isNotEmpty) {
      return prep.buttonLabel;
    }
    return Strings.pickupPrepareAction.tr();
  }

  static String _localizedMessage(
    PickupPreparationModel prep,
    String? liveMessage,
    bool isArabic,
  ) {
    final localized = isArabic ? prep.messageAr : prep.messageEn;
    if (liveMessage != null && liveMessage.isNotEmpty) return liveMessage;
    if (localized.isNotEmpty) return localized;
    return prep.message;
  }

  static List<PickupJourneyStepViewState> _steps(
    List<PickupJourneyStepState> states,
  ) {
    return [
      PickupJourneyStepViewState(
        label: Strings.pickupStepChooseMeals.tr(),
        state: states[0],
      ),
      PickupJourneyStepViewState(
        label: Strings.pickupStepPrepare.tr(),
        state: states[1],
      ),
      PickupJourneyStepViewState(
        label: Strings.pickupStepTrack.tr(),
        state: states[2],
      ),
    ];
  }

  static List<PickupJourneyProgressItemViewState> _progressItems(
    List<PickupJourneyStepState> states,
  ) {
    return [
      PickupJourneyProgressItemViewState(
        title: Strings.pickupProgressReceived.tr(),
        state: states[0],
      ),
      PickupJourneyProgressItemViewState(
        title: Strings.pickupProgressPreparing.tr(),
        state: states[1],
      ),
      PickupJourneyProgressItemViewState(
        title: Strings.pickupProgressReady.tr(),
        state: states[2],
      ),
    ];
  }

  static List<PickupJourneyStepState> _stepStatesForProgress(
    PickupDayStatus? dayStatus,
  ) {
    if (dayStatus == PickupDayStatus.readyForPickup ||
        dayStatus == PickupDayStatus.fulfilled ||
        dayStatus == PickupDayStatus.noShow ||
        dayStatus == PickupDayStatus.consumedWithoutPreparation) {
      return const [
        PickupJourneyStepState.completed,
        PickupJourneyStepState.completed,
        PickupJourneyStepState.active,
      ];
    }

    return const [
      PickupJourneyStepState.completed,
      PickupJourneyStepState.active,
      PickupJourneyStepState.active,
    ];
  }

  static List<PickupJourneyStepState> _progressStatesFor(
    PickupDayStatus? dayStatus,
  ) {
    return switch (dayStatus) {
      PickupDayStatus.readyForPickup ||
      PickupDayStatus.fulfilled ||
      PickupDayStatus.noShow ||
      PickupDayStatus.consumedWithoutPreparation => const [
        PickupJourneyStepState.completed,
        PickupJourneyStepState.completed,
        PickupJourneyStepState.active,
      ],
      PickupDayStatus.inPreparation => const [
        PickupJourneyStepState.completed,
        PickupJourneyStepState.active,
        PickupJourneyStepState.locked,
      ],
      _ => const [
        PickupJourneyStepState.active,
        PickupJourneyStepState.locked,
        PickupJourneyStepState.locked,
      ],
    };
  }

  static (String, String) _completionCopy(
    PickupPreparationModel prep,
    bool isArabic,
  ) {
    final reason = prep.reason.toUpperCase();
    final localized = _localizedMessage(prep, null, isArabic);

    if (reason == 'PICKUP_NO_SHOW') {
      return (
        Strings.pickupCompletedNoShowTitle.tr(),
        localized.ifEmpty(Strings.pickupCompletedNoShowSubtitle.tr()),
      );
    }

    if (reason == 'CONSUMED_WITHOUT_PREPARATION') {
      return (
        Strings.pickupCompletedConsumedTitle.tr(),
        localized.ifEmpty(Strings.pickupCompletedConsumedSubtitle.tr()),
      );
    }

    return (
      Strings.pickupCompletedSuccessTitle.tr(),
      localized.ifEmpty(Strings.pickupCompletedSuccessSubtitle.tr()),
    );
  }

  static (String, String) _completionCopyFromStatus(
    PickupDayStatus? dayStatus,
    PickupStatusDataModel? pickupStatus,
    PickupPreparationModel prep,
  ) {
    final statusMessage = pickupStatus?.message ?? '';

    if (dayStatus == PickupDayStatus.noShow) {
      return (
        Strings.pickupCompletedNoShowTitle.tr(),
        statusMessage.ifEmpty(Strings.pickupCompletedNoShowSubtitle.tr()),
      );
    }

    if (dayStatus == PickupDayStatus.consumedWithoutPreparation) {
      return (
        Strings.pickupCompletedConsumedTitle.tr(),
        statusMessage.ifEmpty(Strings.pickupCompletedConsumedSubtitle.tr()),
      );
    }

    return (
      Strings.pickupCompletedSuccessTitle.tr(),
      statusMessage.ifEmpty(
        prep.message.ifEmpty(Strings.pickupCompletedSuccessSubtitle.tr()),
      ),
    );
  }
}

extension on String {
  String ifEmpty(String fallback) => isNotEmpty ? this : fallback;
}
