import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/domain/model/delivery_options_model.dart';
import 'package:basic_diet/domain/model/subscription_quote_model.dart';
import 'package:basic_diet/presentation/main/home/delivery/bloc/delivery_options_bloc.dart';
import 'package:basic_diet/presentation/main/home/delivery/bloc/delivery_options_event.dart';
import 'package:basic_diet/presentation/main/home/delivery/bloc/delivery_options_state.dart';
import 'package:basic_diet/presentation/main/home/subscription-details/subscription_details_screen.dart';
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

class DeliveryMethodScreen extends StatefulWidget {
  static const String deliveryMethodRoute = '/delivery_method';

  const DeliveryMethodScreen({super.key});

  @override
  State<DeliveryMethodScreen> createState() => _DeliveryMethodScreenState();
}

enum DeliveryType { home, pickup }

class _DeliveryMethodScreenState extends State<DeliveryMethodScreen> {
  DeliveryType _selectedType = DeliveryType.home;
  DeliveryAreaModel? _selectedArea;
  DeliverySlotModel? _selectedTime;
  DateTime? _selectedStartDate;
  PickupLocationModel? _selectedPickupLocation;
  bool _didApplyDefaults = false;

  final TextEditingController _streetController = TextEditingController();
  final TextEditingController _buildingController = TextEditingController();
  final TextEditingController _apartmentController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();

  bool get _isFormValid {
    if (_selectedStartDate == null) return false;

    if (_selectedType == DeliveryType.home) {
      return _selectedArea != null &&
          _selectedTime != null &&
          _streetController.text.isNotEmpty &&
          _buildingController.text.isNotEmpty;
    }
    return true;
  }

  @override
  void dispose() {
    _streetController.dispose();
    _buildingController.dispose();
    _apartmentController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    initDeliveryOptionsModule();
    return BlocProvider(
      create: (_) =>
          instance<DeliveryOptionsBloc>()..add(const GetDeliveryOptionsEvent()),
      child: MultiBlocListener(
        listeners: [
          BlocListener<SubscriptionBloc, SubscriptionState>(
            listenWhen: (previous, current) {
              final previousStatus = previous is SubscriptionSuccess
                  ? previous.quoteStatus
                  : SubscriptionQuoteStatus.initial;
              final currentStatus = current is SubscriptionSuccess
                  ? current.quoteStatus
                  : SubscriptionQuoteStatus.initial;
              return previousStatus != currentStatus;
            },
            listener: (context, state) {
              if (state is! SubscriptionSuccess) return;

              if (state.quoteStatus == SubscriptionQuoteStatus.failure &&
                  state.quoteErrorMessage != null &&
                  state.quoteErrorMessage!.isNotEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(state.quoteErrorMessage!)),
                );
              }

              if (state.quoteStatus == SubscriptionQuoteStatus.success &&
                  state.subscriptionQuote != null) {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) =>
                        SubscriptionDetails(quote: state.subscriptionQuote!),
                  ),
                );
              }
            },
          ),
          BlocListener<DeliveryOptionsBloc, DeliveryOptionsState>(
            listener: (context, state) {
              if (state is DeliveryOptionsSuccess) {
                _applyDeliveryOptionsDefaults(state.deliveryOptionsModel);
              }
            },
          ),
        ],
        child: Scaffold(
          backgroundColor: Colors.white,
          appBar: AppBar(
            title: Text(
              Strings.deliveryMethod,
              style: getBoldTextStyle(
                color: ColorManager.black101828,
                fontSize: FontSizeManager.s20.sp,
              ),
            ),
            bottom: PreferredSize(
              preferredSize: Size.fromHeight(40.h),
              child: Padding(
                padding: EdgeInsetsDirectional.only(
                  start: AppPadding.p16.w,
                  bottom: AppPadding.p16.h,
                ),
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Text(
                    Strings.howWouldYouLikeToReceiveYourMeals,
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                ),
              ),
            ),
            elevation: 0,
            backgroundColor: Colors.white,
            leading: const BackButton(color: Colors.black),
          ),
          body: BlocBuilder<DeliveryOptionsBloc, DeliveryOptionsState>(
            builder: (context, deliveryState) {
              if (deliveryState is DeliveryOptionsLoading ||
                  deliveryState is DeliveryOptionsInitial) {
                return const Center(
                  child: CircularProgressIndicator(
                    color: ColorManager.greenPrimary,
                  ),
                );
              }

              if (deliveryState is DeliveryOptionsError) {
                return Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(deliveryState.message),
                      Gap(AppSize.s16.h),
                      ElevatedButton(
                        onPressed: () => context
                            .read<DeliveryOptionsBloc>()
                            .add(const GetDeliveryOptionsEvent()),
                        child: const Text(Strings.tryAgain),
                      ),
                    ],
                  ),
                );
              }

              final deliveryOptions = (deliveryState as DeliveryOptionsSuccess)
                  .deliveryOptionsModel;
              final selectedMethod = _getSelectedMethod(deliveryOptions);

              return SingleChildScrollView(
                child: Padding(
                  padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        Strings.chooseDeliveryType,
                        style: getBoldTextStyle(
                          color: ColorManager.black101828,
                          fontSize: FontSizeManager.s16.sp,
                        ),
                      ),
                      Gap(AppSize.s16.h),
                      ...deliveryOptions.methods.map(
                        (method) => Padding(
                          padding: EdgeInsetsDirectional.only(
                            bottom: AppSize.s16.h,
                          ),
                          child: _buildSelectionCard(
                            method: method,
                            icon: method.type == 'pickup'
                                ? Icons.location_on_outlined
                                : Icons.local_shipping_outlined,
                          ),
                        ),
                      ),
                      Gap(AppSize.s8.h),
                      Text(
                        Strings.subscriptionStartDate,
                        style: getBoldTextStyle(
                          color: ColorManager.black101828,
                          fontSize: FontSizeManager.s16.sp,
                        ),
                      ),
                      Gap(AppSize.s12.h),
                      _buildStartDateSelector(),
                      if (_selectedType == DeliveryType.home &&
                          selectedMethod != null) ...[
                        Gap(AppSize.s24.h),
                        Text(
                          Strings.deliveryArea,
                          style: getBoldTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s16.sp,
                          ),
                        ),
                        Gap(AppSize.s12.h),
                        _buildAreaSelector(deliveryOptions.areas),
                        Gap(AppSize.s8.h),
                        Text(
                          selectedMethod.helperText,
                          style: getRegularTextStyle(
                            color: ColorManager.grey6A7282,
                            fontSize: FontSizeManager.s12.sp,
                          ),
                        ),
                        Gap(AppSize.s24.h),
                        Text(
                          Strings.deliveryAddress,
                          style: getBoldTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s16.sp,
                          ),
                        ),
                        Gap(AppSize.s16.h),
                        _buildLabelledField(
                          Strings.streetName,
                          Strings.streetHint,
                          _streetController,
                          isRequired: true,
                        ),
                        _buildLabelledField(
                          Strings.buildingNumber,
                          Strings.buildingHint,
                          _buildingController,
                          isRequired: true,
                        ),
                        _buildLabelledField(
                          Strings.apartmentOptional,
                          Strings.apartmentHint,
                          _apartmentController,
                        ),
                        Gap(AppSize.s24.h),
                        Text(
                          Strings.deliverySchedule,
                          style: getBoldTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s16.sp,
                          ),
                        ),
                        Gap(AppSize.s12.h),
                        _buildTimeSelector(selectedMethod.slots),
                        Gap(AppSize.s16.h),
                        _buildLabelledField(
                          Strings.notesOptional,
                          Strings.notesHint,
                          _notesController,
                        ),
                      ] else ...[
                        Gap(AppSize.s24.h),
                        _buildBranchCard(_selectedPickupLocation),
                        Gap(AppSize.s16.h),
                        _buildLabelledField(
                          Strings.notesOptional,
                          Strings.notesHint,
                          _notesController,
                        ),
                      ],
                      Gap(AppSize.s24.h),
                      BlocBuilder<SubscriptionBloc, SubscriptionState>(
                        builder: (context, state) {
                          final successState = state is SubscriptionSuccess
                              ? state
                              : null;
                          final isQuoteLoading =
                              successState?.quoteStatus ==
                              SubscriptionQuoteStatus.loading;
                          final hasPlanSelection =
                              successState?.selectedPlan != null &&
                              successState?.selectedGramOption != null &&
                              successState?.selectedMealOption != null;
                          final isEnabled =
                              _isFormValid &&
                              hasPlanSelection &&
                              !isQuoteLoading;

                          return ButtonWidget(
                            radius: AppSize.s12.r,
                            text: isQuoteLoading
                                ? Strings.loading
                                : Strings.getYourPrice,
                            color: isEnabled || isQuoteLoading
                                ? ColorManager.greenPrimary
                                : ColorManager.greyF3F4F6,
                            textColor: isEnabled || isQuoteLoading
                                ? Colors.white
                                : ColorManager.grey6A7282,
                            onTap: isEnabled && successState != null
                                ? () => _submitQuote(context, successState)
                                : null,
                          );
                        },
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  void _applyDeliveryOptionsDefaults(DeliveryOptionsModel deliveryOptions) {
    if (_didApplyDefaults) return;

    final defaultType = deliveryOptions.defaults.type;
    final defaultMethod = deliveryOptions.methods
        .where((method) => method.type == defaultType)
        .cast<DeliveryMethodModel?>()
        .firstWhere(
          (method) => method != null,
          orElse: () => deliveryOptions.methods.isNotEmpty
              ? deliveryOptions.methods.first
              : null,
        );

    final defaultArea = deliveryOptions.areas
        .where(
          (area) =>
              area.id == deliveryOptions.defaults.areaId ||
              area.zoneId == deliveryOptions.defaults.zoneId,
        )
        .cast<DeliveryAreaModel?>()
        .firstWhere((area) => area != null, orElse: () => null);

    final methodSlots = defaultMethod?.slots ?? [];
    final defaultSlot = methodSlots
        .where((slot) => slot.id == deliveryOptions.defaults.slotId)
        .cast<DeliverySlotModel?>()
        .firstWhere(
          (slot) => slot != null,
          orElse: () => methodSlots.isNotEmpty ? methodSlots.first : null,
        );

    final defaultPickupLocation = deliveryOptions.pickupLocations
        .where(
          (location) =>
              location.id == deliveryOptions.defaults.pickupLocationId,
        )
        .cast<PickupLocationModel?>()
        .firstWhere(
          (location) => location != null,
          orElse: () => deliveryOptions.pickupLocations.isNotEmpty
              ? deliveryOptions.pickupLocations.first
              : null,
        );

    setState(() {
      _selectedType = defaultMethod?.type == 'pickup'
          ? DeliveryType.pickup
          : DeliveryType.home;
      _selectedArea = defaultArea;
      _selectedTime = defaultSlot;
      _selectedPickupLocation = defaultPickupLocation;
      _didApplyDefaults = true;
    });
  }

  DeliveryMethodModel? _getSelectedMethod(
    DeliveryOptionsModel deliveryOptions,
  ) {
    final selectedType = _selectedType == DeliveryType.home
        ? 'delivery'
        : 'pickup';
    return deliveryOptions.methods
        .where((method) => method.type == selectedType)
        .cast<DeliveryMethodModel?>()
        .firstWhere((method) => method != null, orElse: () => null);
  }

  String _formatRequestDate(DateTime date) {
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '${date.year}-$month-$day';
  }

  String _formatMonthTitle(DateTime date) {
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return '${months[date.month - 1]} ${date.year}';
  }

  String _formatShortWeekday(DateTime date) {
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return weekdays[date.weekday - 1];
  }

  List<DateTime> _getSelectableDatesForMonth(
    DateTime monthDate,
    DateTime firstSelectableDate,
    DateTime lastSelectableDate,
  ) {
    final monthStart = DateTime(monthDate.year, monthDate.month, 1);
    final monthEnd = DateTime(monthDate.year, monthDate.month + 1, 0);

    final startDay =
        monthStart.year == firstSelectableDate.year &&
            monthStart.month == firstSelectableDate.month
        ? firstSelectableDate.day
        : 1;

    final endDay =
        monthEnd.year == lastSelectableDate.year &&
            monthEnd.month == lastSelectableDate.month
        ? lastSelectableDate.day
        : monthEnd.day;

    if (startDay > endDay) return [];

    return List<DateTime>.generate(
      endDay - startDay + 1,
      (index) => DateTime(monthDate.year, monthDate.month, startDay + index),
    );
  }

  Future<void> _showStartDatePicker() async {
    final now = DateTime.now();
    final firstSelectableDate = DateTime(now.year, now.month, now.day);
    final lastSelectableDate = DateTime(now.year + 1, now.month, now.day);
    DateTime? tempSelected = _selectedStartDate ?? firstSelectableDate;

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Container(
              height: 0.8.sh,
              decoration: BoxDecoration(
                color: ColorManager.whiteColor,
                borderRadius: BorderRadius.vertical(
                  top: Radius.circular(AppSize.s24.r),
                ),
              ),
              child: Padding(
                padding: EdgeInsetsDirectional.fromSTEB(
                  AppPadding.p20.w,
                  AppPadding.p20.h,
                  AppPadding.p20.w,
                  AppPadding.p20.h + MediaQuery.of(context).viewPadding.bottom,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          Strings.chooseStartDate,
                          style: getBoldTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s18.sp,
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.close),
                          onPressed: () => Navigator.pop(context),
                        ),
                      ],
                    ),
                    Divider(color: ColorManager.formFieldsBorderColor),
                    Expanded(
                      child: ListView.builder(
                        itemCount: 13,
                        itemBuilder: (context, index) {
                          final monthDate = DateTime(
                            firstSelectableDate.year,
                            firstSelectableDate.month + index,
                            1,
                          );

                          if (monthDate.isAfter(lastSelectableDate)) {
                            return const SizedBox.shrink();
                          }

                          final selectableDates = _getSelectableDatesForMonth(
                            monthDate,
                            firstSelectableDate,
                            lastSelectableDate,
                          );

                          if (selectableDates.isEmpty) {
                            return const SizedBox.shrink();
                          }

                          return Padding(
                            padding: EdgeInsetsDirectional.only(
                              bottom: AppSize.s20.h,
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _formatMonthTitle(monthDate),
                                  style: getBoldTextStyle(
                                    color: ColorManager.black101828,
                                    fontSize: FontSizeManager.s16.sp,
                                  ),
                                ),
                                Gap(AppSize.s12.h),
                                Wrap(
                                  spacing: AppSize.s8.w,
                                  runSpacing: AppSize.s8.h,
                                  children: selectableDates.map((date) {
                                    final isSelected =
                                        tempSelected != null &&
                                        date.year == tempSelected!.year &&
                                        date.month == tempSelected!.month &&
                                        date.day == tempSelected!.day;

                                    return InkWell(
                                      onTap: () {
                                        setModalState(() {
                                          tempSelected = date;
                                        });
                                      },
                                      borderRadius: BorderRadius.circular(
                                        AppSize.s12.r,
                                      ),
                                      child: Container(
                                        width: AppSize.s74.w,
                                        padding:
                                            EdgeInsetsDirectional.symmetric(
                                              horizontal: AppPadding.p8.w,
                                              vertical: AppPadding.p12.h,
                                            ),
                                        decoration: BoxDecoration(
                                          color: isSelected
                                              ? ColorManager.greenPrimary
                                              : ColorManager.whiteColor,
                                          borderRadius: BorderRadius.circular(
                                            AppSize.s12.r,
                                          ),
                                          border: Border.all(
                                            color: isSelected
                                                ? ColorManager.greenPrimary
                                                : ColorManager
                                                      .formFieldsBorderColor,
                                          ),
                                        ),
                                        child: Column(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Text(
                                              date.day.toString(),
                                              style: getBoldTextStyle(
                                                color: isSelected
                                                    ? ColorManager.whiteColor
                                                    : ColorManager.black101828,
                                                fontSize:
                                                    FontSizeManager.s18.sp,
                                              ),
                                            ),
                                            Gap(AppSize.s4.h),
                                            Text(
                                              _formatShortWeekday(date),
                                              style: getRegularTextStyle(
                                                color: isSelected
                                                    ? ColorManager.whiteColor
                                                    : ColorManager.grey6A7282,
                                                fontSize:
                                                    FontSizeManager.s12.sp,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    );
                                  }).toList(),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
                    Gap(AppSize.s12.h),
                    ButtonWidget(
                      radius: AppSize.s12,
                      text: Strings.confirm,
                      color: tempSelected != null
                          ? ColorManager.greenPrimary
                          : ColorManager.greyF3F4F6,
                      textColor: tempSelected != null
                          ? ColorManager.whiteColor
                          : ColorManager.grey6A7282,
                      onTap: tempSelected != null
                          ? () {
                              setState(() => _selectedStartDate = tempSelected);
                              Navigator.pop(context);
                            }
                          : null,
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildStartDateSelector() {
    final hasValue = _selectedStartDate != null;
    return InkWell(
      onTap: _showStartDatePicker,
      child: Container(
        padding: EdgeInsetsDirectional.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: AppPadding.p16.h,
        ),
        decoration: BoxDecoration(
          color: ColorManager.whiteColor,
          border: Border.all(color: ColorManager.formFieldsBorderColor),
          borderRadius: BorderRadius.circular(AppSize.s12.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.02),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: AppSize.s40.w,
              height: AppSize.s40.w,
              decoration: BoxDecoration(
                color: hasValue
                    ? ColorManager.greenPrimary.withValues(alpha: 0.12)
                    : ColorManager.greyF3F4F6,
                borderRadius: BorderRadius.circular(AppSize.s10.r),
              ),
              child: Icon(
                Icons.calendar_today_outlined,
                color: hasValue
                    ? ColorManager.greenPrimary
                    : ColorManager.grey6A7282,
                size: AppSize.s18.w,
              ),
            ),
            Gap(AppSize.s12.w),
            Expanded(
              child: Text(
                hasValue
                    ? _formatRequestDate(_selectedStartDate!)
                    : Strings.selectStartDate,
                style: getRegularTextStyle(
                  color: hasValue
                      ? ColorManager.black101828
                      : ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
            ),
            Icon(
              Icons.arrow_forward_ios,
              size: AppSize.s16.w,
              color: hasValue
                  ? ColorManager.greenPrimary
                  : ColorManager.grey6A7282,
            ),
          ],
        ),
      ),
    );
  }

  void _submitQuote(BuildContext context, SubscriptionSuccess state) {
    if (_selectedType == DeliveryType.home && _selectedArea == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please choose a delivery area first.')),
      );
      return;
    }

    final request = SubscriptionQuoteRequestModel(
      planId: state.selectedPlan!.id,
      grams: state.selectedGramOption!.grams,
      mealsPerDay: state.selectedMealOption!.mealsPerDay,
      startDate: _formatRequestDate(_selectedStartDate!),
      premiumItems: state.selectedPremiumMealCounters.entries
          .map(
            (entry) => SubscriptionQuotePremiumItemRequestModel(
              premiumMealId: entry.key,
              qty: entry.value,
            ),
          )
          .toList(),
      addons: state.selectedAddOns.map((addOn) => addOn.id).toList(),
      delivery: _selectedType == DeliveryType.home
          ? SubscriptionQuoteDeliveryRequestModel(
              type: 'delivery',
              zoneId: _selectedArea!.zoneId,
              slotId: _selectedTime!.id,
              address: SubscriptionAddressModel(
                street: _streetController.text.trim(),
                building: _buildingController.text.trim(),
                apartment: _apartmentController.text.trim(),
                notes: _notesController.text.trim(),
                district: _selectedArea!.label,
                city: _selectedPickupLocation?.address.city.isNotEmpty == true
                    ? _selectedPickupLocation!.address.city
                    : 'Riyadh',
              ),
            )
          : SubscriptionQuoteDeliveryRequestModel(type: 'pickup'),
    );

    context.read<SubscriptionBloc>().add(GetSubscriptionQuoteEvent(request));
  }

  Widget _buildSelectionCard({
    required DeliveryMethodModel method,
    required IconData icon,
  }) {
    final type = method.type == 'pickup'
        ? DeliveryType.pickup
        : DeliveryType.home;
    bool isSelected = _selectedType == type;
    return InkWell(
      onTap: () => setState(() => _selectedType = type),
      child: Container(
        padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
        decoration: BoxDecoration(
          color: isSelected
              ? ColorManager.greenPrimary.withValues(alpha: 0.05)
              : Colors.white,
          borderRadius: BorderRadius.circular(AppSize.s16.r),
          border: Border.all(
            color: isSelected
                ? ColorManager.greenPrimary
                : ColorManager.formFieldsBorderColor,
            width: 1.5,
          ),
        ),
        child: Row(
          children: [
            Container(
              padding: EdgeInsetsDirectional.all(AppPadding.p12.w),
              decoration: BoxDecoration(
                color: isSelected
                    ? ColorManager.greenPrimary
                    : ColorManager.greyF3F4F6,
                borderRadius: BorderRadius.circular(AppSize.s12.r),
              ),
              child: Icon(
                icon,
                color: isSelected ? Colors.white : ColorManager.grey6A7282,
              ),
            ),
            Gap(AppSize.s16.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    method.title,
                    style: getBoldTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s18.sp,
                    ),
                  ),
                  Text(
                    method.subtitle,
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                  Gap(AppSize.s8.h),
                  Text(
                    method.feeLabel.isNotEmpty
                        ? method.feeLabel
                        : method.helperText,
                    style: getRegularTextStyle(
                      color: isSelected
                          ? ColorManager.greenPrimary
                          : ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s12.sp,
                    ),
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(Icons.check_circle, color: ColorManager.greenPrimary),
          ],
        ),
      ),
    );
  }

  Widget _buildAreaSelector(List<DeliveryAreaModel> areas) {
    return InkWell(
      onTap: () => _showAreaSelectionModal(areas),
      child: Container(
        padding: EdgeInsetsDirectional.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: AppPadding.p16.h,
        ),
        decoration: BoxDecoration(
          border: Border.all(color: ColorManager.formFieldsBorderColor),
          borderRadius: BorderRadius.circular(AppSize.s12.r),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                _selectedArea?.label ?? Strings.selectYourArea,
                style: getRegularTextStyle(
                  color: _selectedArea != null
                      ? ColorManager.black101828
                      : ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
            ),
            Icon(
              Icons.arrow_forward_ios,
              size: AppSize.s16.w,
              color: ColorManager.grey6A7282,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTimeSelector(List<DeliverySlotModel> slots) {
    return InkWell(
      onTap: () => _showTimeSelectionModal(slots),
      child: Container(
        padding: EdgeInsetsDirectional.symmetric(
          horizontal: AppPadding.p16.w,
          vertical: AppPadding.p16.h,
        ),
        decoration: BoxDecoration(
          border: Border.all(color: ColorManager.formFieldsBorderColor),
          borderRadius: BorderRadius.circular(AppSize.s12.r),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                _selectedTime?.window ?? Strings.selectPreferredTime,
                style: getRegularTextStyle(
                  color: _selectedTime != null
                      ? ColorManager.black101828
                      : ColorManager.grey6A7282,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
            ),
            Icon(
              Icons.arrow_forward_ios,
              size: AppSize.s16.w,
              color: ColorManager.grey6A7282,
            ),
          ],
        ),
      ),
    );
  }

  void _showTimeSelectionModal(List<DeliverySlotModel> slots) {
    DeliverySlotModel? tempSelected = _selectedTime;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppSize.s24.r),
        ),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsetsDirectional.only(
                bottom: MediaQuery.of(context).viewInsets.bottom,
              ),
              child: Container(
                padding: EdgeInsetsDirectional.all(AppPadding.p20.w),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          Strings.chooseDeliveryTime,
                          style: getBoldTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s18.sp,
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.close),
                          onPressed: () => Navigator.pop(context),
                        ),
                      ],
                    ),
                    Divider(color: ColorManager.formFieldsBorderColor),
                    Column(
                      children: slots
                          .map(
                            (time) =>
                                _buildTimeTile(time, tempSelected, (selected) {
                                  setModalState(() => tempSelected = selected);
                                }),
                          )
                          .toList(),
                    ),
                    Gap(AppSize.s24.h),
                    ButtonWidget(
                      radius: AppSize.s12,
                      text: Strings.confirm,
                      color: tempSelected != null
                          ? ColorManager.greenPrimary
                          : ColorManager.greyF3F4F6,
                      textColor: tempSelected != null
                          ? Colors.white
                          : ColorManager.grey6A7282,
                      onTap: tempSelected != null
                          ? () {
                              setState(() => _selectedTime = tempSelected);
                              Navigator.pop(context);
                            }
                          : null,
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildTimeTile(
    DeliverySlotModel time,
    DeliverySlotModel? currentSelected,
    ValueChanged<DeliverySlotModel> onSelected,
  ) {
    bool isSelected = currentSelected?.id == time.id;

    return Padding(
      padding: EdgeInsetsDirectional.only(bottom: AppPadding.p12.h),
      child: InkWell(
        onTap: () => onSelected(time),
        child: Container(
          padding: EdgeInsetsDirectional.all(AppPadding.p14.w),
          decoration: BoxDecoration(
            color: isSelected
                ? ColorManager.greenPrimary.withValues(alpha: 0.05)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(AppSize.s12.r),
            border: Border.all(
              color: isSelected
                  ? ColorManager.greenPrimary
                  : ColorManager.formFieldsBorderColor,
            ),
          ),
          child: Row(
            children: [
              Icon(
                isSelected
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked,
                color: isSelected
                    ? ColorManager.greenPrimary
                    : ColorManager.formFieldsBorderColor,
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Text(
                  time.window,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLabelledField(
    String label,
    String hint,
    TextEditingController controller, {
    bool isRequired = false,
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
            if (isRequired) ...[
              Gap(4.w),
              Text("*", style: TextStyle(color: ColorManager.errorColor)),
            ],
          ],
        ),
        Gap(AppSize.s8.h),
        AppTextField.normal(
          hintText: hint,
          controller: controller,
          onChanged: (_) => setState(() {}),
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
          Container(
            padding: EdgeInsetsDirectional.all(AppPadding.p8.w),
            decoration: BoxDecoration(
              color: ColorManager.greenPrimary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(AppSize.s8.r),
            ),
            child: Icon(Icons.location_on, color: ColorManager.greenPrimary),
          ),
          Gap(AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  pickupLocation?.label.isNotEmpty == true
                      ? pickupLocation!.label
                      : Strings.pickupFromBranch,
                  style: getBoldTextStyle(
                    color: ColorManager.greenDark,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                Text(
                  pickupLocation?.address.line1.isNotEmpty == true
                      ? pickupLocation!.address.line1
                      : Strings.pickUpAnytimeFromBranch,
                  style: getRegularTextStyle(
                    color: ColorManager.greenPrimary,
                    fontSize: FontSizeManager.s12.sp,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _showAreaSelectionModal(List<DeliveryAreaModel> areas) {
    DeliveryAreaModel? tempSelected = _selectedArea;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppSize.s24.r),
        ),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsetsDirectional.only(
                bottom: MediaQuery.of(context).viewInsets.bottom,
              ),
              child: Container(
                padding: EdgeInsetsDirectional.all(AppPadding.p20.w),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          Strings.selectYourArea,
                          style: getBoldTextStyle(
                            color: ColorManager.black101828,
                            fontSize: FontSizeManager.s18.sp,
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.close),
                          onPressed: () => Navigator.pop(context),
                        ),
                      ],
                    ),
                    Divider(color: ColorManager.formFieldsBorderColor),
                    Column(
                      children: areas
                          .map(
                            (area) =>
                                _buildAreaTile(area, tempSelected, (selected) {
                                  setModalState(() => tempSelected = selected);
                                }),
                          )
                          .toList(),
                    ),
                    Gap(AppSize.s24.h),
                    ButtonWidget(
                      radius: AppSize.s12,
                      text: Strings.confirm,
                      color: tempSelected != null
                          ? ColorManager.greenPrimary
                          : ColorManager.greyF3F4F6,
                      textColor: tempSelected != null
                          ? Colors.white
                          : ColorManager.grey6A7282,
                      onTap: tempSelected != null
                          ? () {
                              setState(() => _selectedArea = tempSelected);
                              Navigator.pop(context);
                            }
                          : null,
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildAreaTile(
    DeliveryAreaModel area,
    DeliveryAreaModel? currentSelected,
    ValueChanged<DeliveryAreaModel> onSelected,
  ) {
    bool isSelected = currentSelected?.id == area.id;
    bool isAvailable = area.isAvailable;

    return Padding(
      padding: EdgeInsetsDirectional.only(bottom: AppPadding.p12.h),
      child: InkWell(
        onTap: isAvailable ? () => onSelected(area) : null,
        child: Container(
          padding: EdgeInsetsDirectional.all(AppPadding.p14.w),
          decoration: BoxDecoration(
            color: isSelected
                ? ColorManager.greenPrimary.withValues(alpha: 0.05)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(AppSize.s12.r),
            border: Border.all(
              color: isSelected
                  ? ColorManager.greenPrimary
                  : ColorManager.formFieldsBorderColor.withValues(
                      alpha: isAvailable ? 1 : 0.5,
                    ),
            ),
          ),
          child: Row(
            children: [
              Icon(
                isSelected
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked,
                color: isSelected
                    ? ColorManager.greenPrimary
                    : ColorManager.formFieldsBorderColor.withValues(
                        alpha: isAvailable ? 1 : 0.5,
                      ),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Text(
                  area.label,
                  style: getBoldTextStyle(
                    color: isAvailable
                        ? ColorManager.black101828
                        : ColorManager.grey6A7282.withValues(alpha: 0.5),
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
              ),
              if (!isAvailable)
                Container(
                  padding: EdgeInsetsDirectional.symmetric(
                    horizontal: AppPadding.p8.w,
                    vertical: AppPadding.p4.h,
                  ),
                  decoration: BoxDecoration(
                    color: ColorManager.errorColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(AppSize.s12.r),
                  ),
                  child: Text(
                    area.availabilityLabel.isNotEmpty
                        ? area.availabilityLabel
                        : Strings.notAvailable,
                    style: getRegularTextStyle(
                      color: ColorManager.errorColor,
                      fontSize: FontSizeManager.s10.sp,
                    ),
                  ),
                )
              else if (area.feeLabel.isNotEmpty)
                Text(
                  area.feeLabel,
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s14.sp,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
