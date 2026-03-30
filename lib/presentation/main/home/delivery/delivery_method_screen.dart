import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/widgets/button_widget.dart';
import 'package:basic_diet/presentation/widgets/custom_text_field_style.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class AreaModel {
  final String name;
  final double? price;
  final bool isAvailable;

  AreaModel({required this.name, this.price, this.isAvailable = true});
}

class DeliveryMethodScreen extends StatefulWidget {
  static const String deliveryMethodRoute = '/delivery_method';

  const DeliveryMethodScreen({super.key});

  @override
  State<DeliveryMethodScreen> createState() => _DeliveryMethodScreenState();
}

enum DeliveryType { home, pickup }

class _DeliveryMethodScreenState extends State<DeliveryMethodScreen> {
  DeliveryType _selectedType = DeliveryType.home;
  AreaModel? _selectedArea;
  String? _selectedTime;

  final TextEditingController _streetController = TextEditingController();
  final TextEditingController _buildingController = TextEditingController();
  final TextEditingController _apartmentController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();

  final List<AreaModel> _areas = [
    AreaModel(name: "Al Malqa", price: 15),
    AreaModel(name: "Al Yasmin", price: 20),
    AreaModel(name: "Al Narjis", price: 18),
    AreaModel(name: "Al Olaya", price: 25),
    AreaModel(name: "Al Sahafa", price: 22),
    AreaModel(name: "Al Kharj", isAvailable: false),
  ];

  final List<String> _times = [
    "9 AM - 11 AM",
    "11 AM - 1 PM",
    "1 PM - 3 PM",
    "3 PM - 5 PM",
    "5 PM - 7 PM",
    "7 PM - 9 PM",
  ];

  bool get _isFormValid {
    if (_selectedType == DeliveryType.home) {
      return _selectedArea != null &&
          _selectedTime != null &&
          _streetController.text.isNotEmpty &&
          _buildingController.text.isNotEmpty;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
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
      body: SingleChildScrollView(
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
              SizedBox(height: AppSize.s16.h),

              // Delivery Type Selection
              _buildSelectionCard(
                type: DeliveryType.home,
                title: Strings.homeDelivery,
                subtitle: Strings.getYourMealsDeliveredToYourAddress,
                footer: Strings.deliveryFeeDependsOnYourArea,
                icon: Icons.local_shipping_outlined,
              ),
              SizedBox(height: AppSize.s16.h),
              _buildSelectionCard(
                type: DeliveryType.pickup,
                title: Strings.pickup,
                subtitle: Strings.pickUpFromOurBranch,
                footer: Strings.free,
                icon: Icons.location_on_outlined,
              ),

              if (_selectedType == DeliveryType.home) ...[
                SizedBox(height: AppSize.s24.h),
                Text(
                  Strings.deliveryArea,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                SizedBox(height: AppSize.s12.h),
                _buildAreaSelector(),
                SizedBox(height: AppSize.s8.h),
                Text(
                  Strings.deliveryFeeDependsOnYourArea,
                  style: getRegularTextStyle(
                    color: ColorManager.grey6A7282,
                    fontSize: FontSizeManager.s12.sp,
                  ),
                ),
                SizedBox(height: AppSize.s24.h),
                Text(
                  Strings.deliveryAddress,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                SizedBox(height: AppSize.s16.h),
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
                SizedBox(height: AppSize.s24.h),
                Text(
                  Strings.deliverySchedule,
                  style: getBoldTextStyle(
                    color: ColorManager.black101828,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                SizedBox(height: AppSize.s12.h),
                _buildTimeSelector(),
                SizedBox(height: AppSize.s16.h),
                _buildLabelledField(
                  Strings.notesOptional,
                  Strings.notesHint,
                  _notesController,
                ),
              ] else ...[
                SizedBox(height: AppSize.s24.h),
                _buildBranchCard(),
                SizedBox(height: AppSize.s16.h),
                _buildLabelledField(
                  Strings.notesOptional,
                  Strings.notesHint,
                  _notesController,
                ),
              ],

              SizedBox(height: AppSize.s24.h),
              // _buildSummary(),
              // SizedBox(height: AppSize.s24.h),
              ButtonWidget(
                radius: AppSize.s12.r,
                text: Strings.getYourPrice,
                color: _isFormValid
                    ? ColorManager.greenPrimary
                    : ColorManager.greyF3F4F6,
                textColor: _isFormValid
                    ? Colors.white
                    : ColorManager.grey6A7282,
                onTap: _isFormValid
                    ? () {
                        // TODO: Navigate to next screen
                      }
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSelectionCard({
    required DeliveryType type,
    required String title,
    required String subtitle,
    required String footer,
    required IconData icon,
  }) {
    bool isSelected = _selectedType == type;
    return InkWell(
      onTap: () => setState(() => _selectedType = type),
      child: Container(
        padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
        decoration: BoxDecoration(
          color: isSelected
              ? ColorManager.greenPrimary.withOpacity(0.05)
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
            SizedBox(width: AppSize.s16.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: getBoldTextStyle(
                      color: ColorManager.black101828,
                      fontSize: FontSizeManager.s18.sp,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: getRegularTextStyle(
                      color: ColorManager.grey6A7282,
                      fontSize: FontSizeManager.s14.sp,
                    ),
                  ),
                  SizedBox(height: AppSize.s8.h),
                  Text(
                    footer,
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

  Widget _buildAreaSelector() {
    return InkWell(
      onTap: _showAreaSelectionModal,
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
                _selectedArea?.name ?? Strings.selectYourArea,
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

  Widget _buildTimeSelector() {
    return InkWell(
      onTap: _showTimeSelectionModal,
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
                _selectedTime ?? Strings.selectPreferredTime,
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

  void _showTimeSelectionModal() {
    String? tempSelected = _selectedTime;

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
                      children: _times
                          .map(
                            (time) =>
                                _buildTimeTile(time, tempSelected, (selected) {
                                  setModalState(() => tempSelected = selected);
                                }),
                          )
                          .toList(),
                    ),
                    SizedBox(height: AppSize.s24.h),
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
    String time,
    String? currentSelected,
    ValueChanged<String> onSelected,
  ) {
    bool isSelected = currentSelected == time;

    return Padding(
      padding: EdgeInsetsDirectional.only(bottom: AppPadding.p12.h),
      child: InkWell(
        onTap: () => onSelected(time),
        child: Container(
          padding: EdgeInsetsDirectional.all(AppPadding.p14.w),
          decoration: BoxDecoration(
            color: isSelected
                ? ColorManager.greenPrimary.withOpacity(0.05)
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
              SizedBox(width: AppSize.s12.w),
              Expanded(
                child: Text(
                  time,
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
              SizedBox(width: 4.w),
              Text("*", style: TextStyle(color: ColorManager.errorColor)),
            ],
          ],
        ),
        SizedBox(height: AppSize.s8.h),
        AppTextField.normal(
          hintText: hint,
          controller: controller,
          onChanged: (_) => setState(() {}),
        ),
        SizedBox(height: AppSize.s16.h),
      ],
    );
  }

  Widget _buildBranchCard() {
    return Container(
      padding: EdgeInsetsDirectional.all(AppPadding.p16.w),
      decoration: BoxDecoration(
        color: ColorManager.greenPrimary.withOpacity(0.05),
        borderRadius: BorderRadius.circular(AppSize.s12.r),
        border: Border.all(color: ColorManager.greenPrimary.withOpacity(0.2)),
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsetsDirectional.all(AppPadding.p8.w),
            decoration: BoxDecoration(
              color: ColorManager.greenPrimary.withOpacity(0.1),
              borderRadius: BorderRadius.circular(AppSize.s8.r),
            ),
            child: Icon(Icons.location_on, color: ColorManager.greenPrimary),
          ),
          SizedBox(width: AppSize.s12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  Strings.pickupFromBranch,
                  style: getBoldTextStyle(
                    color: ColorManager.greenDark,
                    fontSize: FontSizeManager.s16.sp,
                  ),
                ),
                Text(
                  Strings.pickUpAnytimeFromBranch,
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

  void _showAreaSelectionModal() {
    AreaModel? tempSelected = _selectedArea;

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
                      children: _areas
                          .map(
                            (area) =>
                                _buildAreaTile(area, tempSelected, (selected) {
                                  setModalState(() => tempSelected = selected);
                                }),
                          )
                          .toList(),
                    ),
                    SizedBox(height: AppSize.s24.h),
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
    AreaModel area,
    AreaModel? currentSelected,
    ValueChanged<AreaModel> onSelected,
  ) {
    bool isSelected = currentSelected?.name == area.name;
    bool isAvailable = area.isAvailable;

    return Padding(
      padding: EdgeInsetsDirectional.only(bottom: AppPadding.p12.h),
      child: InkWell(
        onTap: isAvailable ? () => onSelected(area) : null,
        child: Container(
          padding: EdgeInsetsDirectional.all(AppPadding.p14.w),
          decoration: BoxDecoration(
            color: isSelected
                ? ColorManager.greenPrimary.withOpacity(0.05)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(AppSize.s12.r),
            border: Border.all(
              color: isSelected
                  ? ColorManager.greenPrimary
                  : ColorManager.formFieldsBorderColor.withOpacity(
                      isAvailable ? 1 : 0.5,
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
                    : ColorManager.formFieldsBorderColor.withOpacity(
                        isAvailable ? 1 : 0.5,
                      ),
              ),
              SizedBox(width: AppSize.s12.w),
              Expanded(
                child: Text(
                  area.name,
                  style: getBoldTextStyle(
                    color: isAvailable
                        ? ColorManager.black101828
                        : ColorManager.grey6A7282.withOpacity(0.5),
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
                    color: ColorManager.errorColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(AppSize.s12.r),
                  ),
                  child: Text(
                    Strings.notAvailable,
                    style: getRegularTextStyle(
                      color: ColorManager.errorColor,
                      fontSize: FontSizeManager.s10.sp,
                    ),
                  ),
                )
              else if (area.price != null)
                Text(
                  "${area.price} ${Strings.sar}",
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
