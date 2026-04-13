import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/register/register_screen.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/verify/verify_screen.dart';
import 'package:basic_diet/presentation/widgets/button_widget.dart';
import 'package:basic_diet/presentation/widgets/custom_text_field_style.dart';
import 'package:basic_diet/presentation/widgets/text_button_widget.dart';
import 'package:flutter/material.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';
import 'login_bloc.dart';
import 'login_event.dart';
import 'login_state.dart';

class LoginScreen extends StatelessWidget {
  static const String loginRoute = "/login";
  LoginScreen({super.key});

  late final TextEditingController _phoneController = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => instance<LoginBloc>(),
      child: BlocListener<LoginBloc, LoginState>(
        listener: (context, state) {
          if (state is LoginSuccessState) {
            context.push(VerifyScreen.verifyRoute, extra: state.phone);
          }
        },
        child: Scaffold(
          backgroundColor: ColorManager.whiteColor,
          body: SafeArea(
            child: SingleChildScrollView(
              padding: EdgeInsetsDirectional.symmetric(
                horizontal: AppSize.s24.w,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Gap(AppSize.s100.h),
                  _buildHeader(),
                  Gap(AppSize.s105.h),
                  _buildForm(context),
                  Gap(AppSize.s20.h),
                  _buildFooter(context),
                  Gap(AppSize.s20.h),
                ],
              ),
            ),
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
          Strings.welcomeBack.tr(),
          style: getBoldTextStyle(
            color: ColorManager.blackColor,
            fontSize: FontSizeManager.s30.sp,
          ),
        ),
        Gap(AppSize.s10.h),
        Text(
          Strings.signInToContinueYourHealthyJourney.tr(),
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
          Strings.phone.tr(),
          style: getRegularTextStyle(
            color: ColorManager.blackColor,
            fontSize: FontSizeManager.s16.sp,
          ),
        ),
        Gap(AppSize.s8.h),
        BlocBuilder<LoginBloc, LoginState>(
          buildWhen: (previous, current) =>
              previous.phoneError != current.phoneError,
          builder: (context, state) {
            return AppTextField.phone(
              controller: _phoneController,
              errorText: state.phoneError,
              onChanged: (phone) {
                context.read<LoginBloc>().add(LoginPhoneChanged(phone));
              },
            );
          },
        ),
        Gap(AppSize.s16.h),
        BlocBuilder<LoginBloc, LoginState>(
          builder: (context, state) {
            final isLoading = state is LoginLoadingState;
            final isEnabled =
                state.phoneError == null && state.phone.isNotEmpty;

            return ButtonWidget(
              text: isLoading ? Strings.loading.tr() : Strings.sendOtp.tr(),
              textColor: ColorManager.whiteColor,
              color: isEnabled
                  ? ColorManager.greenDark
                  : ColorManager.greenDark.withValues(alpha: 0.5),
              width: double.infinity,
              radius: AppSize.s12.r,
              onTap: isEnabled
                  ? () => context.read<LoginBloc>().add(const LoginSubmitted())
                  : null,
            );
          },
        ),
      ],
    );
  }

  Widget _buildFooter(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(
          Strings.dontHaveAccount.tr(),
          style: getRegularTextStyle(
            color: ColorManager.grayColor,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
        TextButtonWidget(
          Strings.signUp.tr(),
          ColorManager.greenDark,
          FontSizeManager.s14,
          () => context.push(RegisterScreen.registerRoute),
        ),
      ],
    );
  }
}
