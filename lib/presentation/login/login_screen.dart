import 'package:basic_diet/presentation/register/register_screen.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/verify/verify_screen.dart';
import 'package:basic_diet/presentation/widgets/button_widget.dart';
import 'package:basic_diet/presentation/widgets/custom_text_field_style.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

class LoginScreen extends StatefulWidget {
  static const String loginRoute = "/login";
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  late final TextEditingController _phoneController;

  @override
  void initState() {
    super.initState();
    _phoneController = TextEditingController();
  }

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorManager.whiteColor,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsetsDirectional.symmetric(horizontal: AppSize.s24.w),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Gap(AppSize.s100.h),
              _buildHeader(),
              Gap(AppSize.s105.h),
              _buildForm(context),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          Strings.welcomeBack,
          style: getBoldTextStyle(
            color: ColorManager.blackColor,
            fontSize: FontSizeManager.s30.sp,
          ),
        ),
        Gap(AppSize.s10.h),
        Text(
          Strings.signInToContinueYourHealthyJourney,
          style: getRegularTextStyle(
            color: ColorManager.grayColor,
            fontSize: FontSizeManager.s16.sp,
          ),
        ),
      ],
    );
  }

  Widget _buildForm(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          Strings.phone,
          style: getRegularTextStyle(
            color: ColorManager.blackColor,
            fontSize: FontSizeManager.s16.sp,
          ),
        ),
        Gap(AppSize.s8.h),
        AppTextField.phone(controller: _phoneController),
        Gap(AppSize.s16.h),
        ButtonWidget(
          text: Strings.sendOtp,
          textColor: ColorManager.whiteColor,
          color: ColorManager.greenDark,
          width: double.infinity,
          radius: AppSize.s12.r,
          onTap: () => context.push(
            VerifyScreen.verifyRoute,
            extra: _phoneController.text,
          ),
        ),
      ],
    );
  }
}

// StreamBuilder<bool>(
//   stream: viewModel.outShowPhoneError,
//   builder: (_, snapshot) {
//     return AppTextField.phone(
//       controller: phoneController,
//       errorText: snapshot.data == true
//           ? "Phone is required"
//           : null,
//     );
//   },
// );




/*

🎯 New Clean Flow with BLoC

Instead of:

ViewModel
  ↓
Streams
  ↓
StreamBuilder
  ↓
PhoneField


You’ll have:

Bloc
  ↓
BlocBuilder
  ↓
AppTextField

*/