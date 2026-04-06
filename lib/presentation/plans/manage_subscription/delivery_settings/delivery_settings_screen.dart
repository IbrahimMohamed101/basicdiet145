import 'package:flutter/material.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class DeliverySettingsScreen extends StatefulWidget {
  const DeliverySettingsScreen({super.key});

  @override
  State<DeliverySettingsScreen> createState() => _DeliverySettingsScreenState();
}

class _DeliverySettingsScreenState extends State<DeliverySettingsScreen> {
  final List<String> _timeSlots = [
    "8:00 AM - 10:00 AM",
    "10:00 AM - 12:00 PM",
    "12:00 PM - 2:00 PM",
    "2:00 PM - 4:00 PM",
    "4:00 PM - 6:00 PM",
    "6:00 PM - 8:00 PM",
  ];
  String _selectedTimeSlot = "8:00 AM - 10:00 AM";

  // Controllers for initial values (based on mock image)
  final TextEditingController _streetController = TextEditingController(text: "123 Main Street, Apt 4B");
  final TextEditingController _areaController = TextEditingController(text: "Dubai Marina");
  final TextEditingController _cityController = TextEditingController(text: "Dubai");
  final TextEditingController _instructionsController = TextEditingController();

  @override
  void dispose() {
    _streetController.dispose();
    _areaController.dispose();
    _cityController.dispose();
    _instructionsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
        titleSpacing: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.black),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          Strings.deliverySettings,
          style: getRegularTextStyle(
            color: Colors.black,
            fontSize: FontSizeManager.s20.sp,
          ),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(
            color: ColorManager.formFieldsBorderColor,
            height: 1.0,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppPadding.p16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildDeliveryAddressCard(),
            Gap(AppSize.s16.h),
            _buildDeliveryTimePreferenceCard(),
            Gap(AppSize.s16.h),
            _buildDeliveryInstructionsCard(),
            Gap(AppSize.s24.h),
            _buildActionButtons(context),
          ],
        ),
      ),
    );
  }

  Widget _buildDeliveryAddressCard() {
    return Container(
      padding: const EdgeInsets.all(AppPadding.p16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: ColorManager.formFieldsBorderColor),
        borderRadius: BorderRadius.circular(AppSize.s12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.location_on_outlined, color: ColorManager.greenPrimary, size: AppSize.s20),
              Gap(AppSize.s8.w),
              Text(
                Strings.deliveryAddress,
                style: getRegularTextStyle(
                  color: Colors.black,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
            ],
          ),
          Gap(AppSize.s16.h),
          Text(
            Strings.streetAddressLabel,
            style: getRegularTextStyle(
              color: Colors.black,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          _buildTextField(_streetController),
          Gap(AppSize.s16.h),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      Strings.areaLabel,
                      style: getRegularTextStyle(
                        color: Colors.black,
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                    Gap(AppSize.s8.h),
                    _buildTextField(_areaController),
                  ],
                ),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      Strings.cityLabel,
                      style: getRegularTextStyle(
                        color: Colors.black,
                        fontSize: FontSizeManager.s14.sp,
                      ),
                    ),
                    Gap(AppSize.s8.h),
                    _buildTextField(_cityController),
                  ],
                ),
              ),
            ],
          ),
          Gap(AppSize.s16.h),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () {},
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: AppPadding.p12),
                side: const BorderSide(color: ColorManager.greenPrimary),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSize.s12),
                ),
              ),
              child: Text(
                Strings.useCurrentLocation,
                style: getRegularTextStyle(
                  color: ColorManager.greenPrimary,
                  fontSize: FontSizeManager.s14.sp,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField(TextEditingController controller, {int maxLines = 1, String? hint}) {
    return TextFormField(
      controller: controller,
      maxLines: maxLines,
      style: getRegularTextStyle(
        color: ColorManager.grey6A7282, // slightly darker text
        fontSize: FontSizeManager.s14.sp,
      ),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: getRegularTextStyle(
          color: ColorManager.grey6A7282.withValues(alpha: 0.6),
          fontSize: FontSizeManager.s14.sp,
        ),
        filled: true,
        fillColor: ColorManager.greyF3F4F6,
        contentPadding: const EdgeInsets.symmetric(horizontal: AppPadding.p16, vertical: AppPadding.p12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSize.s8),
          borderSide: const BorderSide(color: ColorManager.formFieldsBorderColor),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSize.s8),
          borderSide: const BorderSide(color: ColorManager.formFieldsBorderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSize.s8),
          borderSide: const BorderSide(color: ColorManager.greenPrimary),
        ),
      ),
    );
  }

  Widget _buildDeliveryTimePreferenceCard() {
    return Container(
      padding: const EdgeInsets.all(AppPadding.p16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: ColorManager.formFieldsBorderColor),
        borderRadius: BorderRadius.circular(AppSize.s12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.access_time_outlined, color: ColorManager.greenPrimary, size: AppSize.s20),
              Gap(AppSize.s8.w),
              Text(
                Strings.deliveryTimePreference,
                style: getRegularTextStyle(
                  color: Colors.black,
                  fontSize: FontSizeManager.s16.sp,
                ),
              ),
            ],
          ),
          Gap(AppSize.s16.h),
          ..._timeSlots.map((slot) => _buildTimeSlotSelector(slot)),
        ],
      ),
    );
  }

  Widget _buildTimeSlotSelector(String time) {
    bool isSelected = _selectedTimeSlot == time;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppPadding.p8),
      child: InkWell(
        onTap: () {
          setState(() {
            _selectedTimeSlot = time;
          });
        },
        borderRadius: BorderRadius.circular(AppSize.s12),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(AppPadding.p16),
          decoration: BoxDecoration(
            color: isSelected ? ColorManager.greenPrimary.withValues(alpha: 0.05) : Colors.white,
            border: Border.all(
              color: isSelected ? ColorManager.greenPrimary : ColorManager.formFieldsBorderColor,
            ),
            borderRadius: BorderRadius.circular(AppSize.s12),
          ),
          child: Text(
            time,
            style: getRegularTextStyle(
              color: Colors.black,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDeliveryInstructionsCard() {
    return Container(
      padding: const EdgeInsets.all(AppPadding.p16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: ColorManager.formFieldsBorderColor),
        borderRadius: BorderRadius.circular(AppSize.s12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            Strings.deliveryInstructionsOptional,
            style: getRegularTextStyle(
              color: Colors.black,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
          Gap(AppSize.s8.h),
          _buildTextField(
            _instructionsController,
            maxLines: 4,
            hint: Strings.deliveryInstructionsHint,
          ),
        ],
      ),
    );
  }

  Widget _buildActionButtons(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton(
            onPressed: () => Navigator.of(context).pop(),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
              side: const BorderSide(color: ColorManager.formFieldsBorderColor),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s12),
              ),
            ),
            child: Text(
              Strings.cancel,
              style: getRegularTextStyle(
                color: Colors.black,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
          ),
        ),
        Gap(AppSize.s12.w),
        Expanded(
          child: ElevatedButton(
            onPressed: () {
              // TODO: Integrate endpoint
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: ColorManager.greenPrimary,
              padding: const EdgeInsets.symmetric(vertical: AppPadding.p16),
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppSize.s12),
              ),
            ),
            child: Text(
              Strings.saveChanges,
              style: getRegularTextStyle(
                color: Colors.white,
                fontSize: FontSizeManager.s16.sp,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
