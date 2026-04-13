import 'package:easy_localization/easy_localization.dart';
import 'package:basic_diet/domain/model/delivery_options_model.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';
import 'package:basic_diet/presentation/main/home/delivery/bloc/delivery_options_bloc.dart';
import 'package:basic_diet/presentation/main/home/delivery/bloc/delivery_options_event.dart';
import 'package:basic_diet/presentation/main/home/delivery/bloc/delivery_options_state.dart';
import 'package:basic_diet/presentation/main/home/delivery/delivery_method_screen.dart';
import 'package:basic_diet/presentation/main/home/delivery/widgets/base_selection_widgets.dart';
import 'package:basic_diet/presentation/main/home/delivery/widgets/selection_widgets.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_bloc.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_event.dart';
import 'package:basic_diet/presentation/main/home/subscription/bloc/subscription_state.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/widgets/button_widget.dart';
import 'package:basic_diet/presentation/widgets/custom_text_field_style.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class DeliveryMethodContentView extends StatelessWidget {
  final DeliveryOptionsSuccess state;

  const DeliveryMethodContentView({
    super.key,
    required this.state,
    required DeliveryOptionsModel deliveryOptions,
  });

  @override
  Widget build(BuildContext context) {
    final selectedMethod = _getSelectedMethod();
    final bloc = context.read<DeliveryOptionsBloc>();

    return SingleChildScrollView(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SectionTitle(title: Strings.chooseDeliveryType.tr()),
          Gap(AppSize.s16.h),
          ...state.deliveryOptionsModel.methods.map(
            (method) => Padding(
              padding: EdgeInsetsDirectional.only(bottom: AppSize.s16.h),
              child: DeliveryTypeCard(
                method: method,
                icon: method.type == 'pickup'
                    ? Icons.location_on_outlined
                    : Icons.local_shipping_outlined,
                isSelected: _isMethodSelected(method),
                onTap: () => bloc.add(
                  ChangeDeliveryTypeEvent(
                    method.type == 'pickup'
                        ? DeliveryType.pickup
                        : DeliveryType.home,
                  ),
                ),
              ),
            ),
          ),
          Gap(AppSize.s8.h),
          _SectionTitle(title: Strings.subscriptionStartDate.tr()),
          Gap(AppSize.s12.h),
          _buildStartDateSelector(context),
          if (state.selectedType == DeliveryType.home &&
              selectedMethod != null) ...[
            Gap(AppSize.s24.h),
            _SectionTitle(title: Strings.deliveryArea.tr()),
            Gap(AppSize.s12.h),
            DeliveryLocationSelector(
              label: Strings.selectYourArea.tr(),
              value: state.selectedArea?.label,
              onTap: () =>
                  _showAreaModal(context, state.deliveryOptionsModel.areas),
            ),
            Gap(AppSize.s8.h),
            _HelperText(text: selectedMethod.helperText),
            Gap(AppSize.s24.h),
            _SectionTitle(title: Strings.deliveryAddress.tr()),
            Gap(AppSize.s16.h),
            _buildAddressFields(context),
            Gap(AppSize.s24.h),
            _SectionTitle(title: Strings.deliverySchedule.tr()),
            Gap(AppSize.s12.h),
            DeliveryLocationSelector(
              label: Strings.selectPreferredTime.tr(),
              value: state.selectedTime?.window,
              onTap: () => _showTimeModal(context, selectedMethod.slots),
            ),
          ] else ...[
            Gap(AppSize.s24.h),
            _buildBranchCard(state.selectedPickupLocation),
          ],
          Gap(AppSize.s16.h),
          _buildLabelledField(
            context,
            Strings.notesOptional.tr(),
            Strings.notesHint.tr(),
            bloc.notesController,
            onChanged: (val) => bloc.add(UpdateAddressFieldsEvent(notes: val)),
          ),
          Gap(AppSize.s24.h),
          _buildSubmitButton(context),
        ],
      ),
    );
  }

  // --- UI Components ---

  Widget _buildAddressFields(BuildContext context) {
    final bloc = context.read<DeliveryOptionsBloc>();
    return Column(
      children: [
        _buildLabelledField(
          context,
          Strings.streetName.tr(),
          Strings.streetHint.tr(),
          bloc.streetController,
          isRequired: true,
          onChanged: (val) => bloc.add(UpdateAddressFieldsEvent(street: val)),
        ),
        _buildLabelledField(
          context,
          Strings.buildingNumber.tr(),
          Strings.buildingHint.tr(),
          bloc.buildingController,
          isRequired: true,
          onChanged: (val) => bloc.add(UpdateAddressFieldsEvent(building: val)),
        ),
        _buildLabelledField(
          context,
          Strings.apartmentOptional.tr(),
          Strings.apartmentHint.tr(),
          bloc.apartmentController,
          onChanged: (val) =>
              bloc.add(UpdateAddressFieldsEvent(apartment: val)),
        ),
      ],
    );
  }

  Widget _buildSubmitButton(BuildContext context) {
    return BlocBuilder<SubscriptionBloc, SubscriptionState>(
      builder: (context, subscriptionState) {
        final success = subscriptionState is SubscriptionSuccess
            ? subscriptionState
            : null;
        final loading = success?.quoteStatus == SubscriptionQuoteStatus.loading;
        final enabled = state.isFormValid && success != null && !loading;

        return ButtonWidget(
          radius: AppSize.s12.r,
          text: loading ? Strings.loading.tr() : Strings.getYourPrice.tr(),
          color: enabled || loading
              ? ColorManager.greenPrimary
              : ColorManager.greyF3F4F6,
          textColor: enabled || loading
              ? Colors.white
              : ColorManager.grey6A7282,
          onTap: enabled ? () => _submitQuote(context, success) : null,
        );
      },
    );
  }

  // --- Modal Launchers ---

  void _showAreaModal(BuildContext context, List<DeliveryAreaModel> areas) {
    final bloc = context.read<DeliveryOptionsBloc>();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: _modalShape(),
      builder: (context) => SelectionModal<DeliveryAreaModel>(
        title: Strings.selectYourArea.tr(),
        items: areas,
        initialSelection: state.selectedArea,
        itemBuilder: (item, current, onSelected) => RadioSelectionTile(
          label: item.label,
          isSelected: current?.id == item.id,
          isAvailable: item.isAvailable,
          trailing: item.feeLabel,
          onTap: () => onSelected(item),
        ),
        onConfirm: (selected) => bloc.add(SelectAreaEvent(selected)),
      ),
    );
  }

  void _showTimeModal(BuildContext context, List<DeliverySlotModel> slots) {
    final bloc = context.read<DeliveryOptionsBloc>();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: _modalShape(),
      builder: (context) => SelectionModal<DeliverySlotModel>(
        title: Strings.chooseDeliveryTime.tr(),
        items: slots,
        initialSelection: state.selectedTime,
        itemBuilder: (item, current, onSelected) => RadioSelectionTile(
          label: item.window,
          isSelected: current?.id == item.id,
          onTap: () => onSelected(item),
        ),
        onConfirm: (selected) => bloc.add(SelectTimeEvent(selected)),
      ),
    );
  }

  Future<void> _showStartDatePicker(BuildContext context) async {
    final bloc = context.read<DeliveryOptionsBloc>();
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate:
          state.selectedStartDate ??
          DateTime.now().add(const Duration(days: 1)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(
            primary: ColorManager.greenPrimary,
          ),
        ),
        child: child!,
      ),
    );
    if (picked != null) bloc.add(SelectStartDateEvent(picked));
  }

  // --- Helper Methods ---

  bool _isMethodSelected(DeliveryMethodModel method) =>
      state.selectedType ==
      (method.type == 'pickup' ? DeliveryType.pickup : DeliveryType.home);

  DeliveryMethodModel? _getSelectedMethod() {
    final type = state.selectedType == DeliveryType.home
        ? 'delivery'
        : 'pickup';
    return state.deliveryOptionsModel.methods
        .cast<DeliveryMethodModel?>()
        .firstWhere((m) => m?.type == type, orElse: () => null);
  }

  void _submitQuote(
    BuildContext context,
    SubscriptionSuccess subscriptionState,
  ) {
    final request = SubscriptionQuoteRequestModel(
      planId: subscriptionState.selectedPlan!.id,
      grams: subscriptionState.selectedGramOption!.grams,
      mealsPerDay: subscriptionState.selectedMealOption!.mealsPerDay,
      startDate: _formatRequestDate(state.selectedStartDate!),
      premiumItems: subscriptionState.selectedPremiumMealCounters.entries
          .map(
            (e) => SubscriptionQuotePremiumItemRequestModel(
              premiumMealId: e.key,
              qty: e.value,
            ),
          )
          .toList(),
      addons: subscriptionState.selectedAddOns.map((a) => a.id).toList(),
      delivery: state.selectedType == DeliveryType.home
          ? SubscriptionQuoteDeliveryRequestModel(
              type: 'delivery',
              zoneId: state.selectedArea!.zoneId,
              slotId: state.selectedTime!.id,
              address: SubscriptionAddressModel(
                street: state.street.trim(),
                building: state.building.trim(),
                apartment: state.apartment.trim(),
                notes: state.notes.trim(),
                district: state.selectedArea!.label,
                city: 'Riyadh',
              ),
            )
          : SubscriptionQuoteDeliveryRequestModel(type: 'pickup'),
    );
    context.read<SubscriptionBloc>().add(GetSubscriptionQuoteEvent(request));
  }

  String _formatRequestDate(DateTime date) =>
      "${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}";

  ShapeBorder _modalShape() => RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(AppSize.s24.r)),
  );

  Widget _buildStartDateSelector(BuildContext context) {
    return DeliveryLocationSelector(
      label: Strings.selectStartDate.tr(),
      value: state.selectedStartDate != null
          ? _formatRequestDate(state.selectedStartDate!)
          : null,
      onTap: () => _showStartDatePicker(context),
    );
  }

  Widget _buildLabelledField(
    BuildContext context,
    String label,
    String hint,
    TextEditingController controller, {
    bool isRequired = false,
    ValueChanged<String>? onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              label,
              style: getRegularTextStyle(
                color: ColorManager.grey4A5565,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
            if (isRequired)
              Text(" *", style: TextStyle(color: ColorManager.errorColor)),
          ],
        ),
        Gap(AppSize.s8.h),
        AppTextField.normal(
          hintText: hint,
          controller: controller,
          onChanged: onChanged,
        ),
        Gap(AppSize.s16.h),
      ],
    );
  }

  Widget _buildBranchCard(PickupLocationModel? pickupLocation) {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      decoration: BoxDecoration(
        color: ColorManager.greenPrimary.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(AppSize.s12.r),
        border: Border.all(
          color: ColorManager.greenPrimary.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        children: [
          const Icon(Icons.location_on, color: ColorManager.greenPrimary),
          Gap(AppSize.s12.w),
          Expanded(
            child: Text(
              pickupLocation?.label ?? Strings.pickupFromBranch.tr(),
              style: getBoldTextStyle(
                color: ColorManager.greenDark,
                fontSize: 16.sp,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String title;
  const _SectionTitle({required this.title});
  @override
  Widget build(BuildContext context) => Text(
    title,
    style: getBoldTextStyle(
      color: ColorManager.black101828,
      fontSize: FontSizeManager.s16.sp,
    ),
  );
}

class _HelperText extends StatelessWidget {
  final String text;
  const _HelperText({required this.text});
  @override
  Widget build(BuildContext context) => Text(
    text,
    style: getRegularTextStyle(
      color: ColorManager.grey6A7282,
      fontSize: FontSizeManager.s12.sp,
    ),
  );
}
