import 'package:basic_diet/app/app_pref.dart';
import 'package:basic_diet/app/dependency_injection.dart';
import 'package:basic_diet/presentation/onboarding/on_boarding_screen.dart';
import 'package:basic_diet/presentation/resources/assets_manager.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/language_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';
import 'package:go_router/go_router.dart';

class LanguageSelectionScreen extends StatefulWidget {
  static const String languageSelectionRoute = '/language-selection';
  const LanguageSelectionScreen({super.key});

  @override
  State<LanguageSelectionScreen> createState() =>
      _LanguageSelectionScreenState();
}

class _LanguageSelectionScreenState extends State<LanguageSelectionScreen> {
  final AppPreferences _appPreferences = instance<AppPreferences>();
  String? _selectedLanguage = arabic;

  @override
  void initState() {
    super.initState();
    _initSelectedLanguage();
  }

  Future<void> _initSelectedLanguage() async {
    final savedLanguage = await _appPreferences.getAppLanguage();
    if (!mounted) return;
    setState(() {
      _selectedLanguage = savedLanguage;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColorManager.backgroundSurface,
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: AppPadding.p24.w),
          child: Column(
            children: [
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _buildLogo(),
                    Gap(AppSize.s60.h),
                    _buildTitle(),
                    Gap(AppSize.s16.h),
                    _buildSubtitle(),
                    Gap(AppSize.s48.h),
                    _buildLanguageOptions(),
                  ],
                ),
              ),
              _buildContinueButton(),
              Gap(AppSize.s24.h),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLogo() {
    return Image.asset(
      ImageAssets.splashLogo,
      height: AppSize.s120.h,
      fit: BoxFit.contain,
    );
  }

  Widget _buildTitle() {
    return Text(
      Strings.chooseLanguage.tr(),
      textAlign: TextAlign.center,
      style: Theme.of(context).textTheme.headlineMedium?.copyWith(
            fontWeight: FontWeight.bold,
            color: ColorManager.textPrimary,
            fontSize: FontSizeManager.s24.sp,
          ),
    );
  }

  Widget _buildSubtitle() {
    return Text(
      Strings.selectYourLanguage.tr(),
      textAlign: TextAlign.center,
      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: ColorManager.textSecondary,
            fontSize: FontSizeManager.s16.sp,
          ),
    );
  }

  Widget _buildLanguageOptions() {
    return Column(
      children: [
        _buildLanguageOption(
          languageCode: english,
          languageName: Strings.english.tr(),
          locale: englishLocale,
        ),
        Gap(AppSize.s16.h),
        _buildLanguageOption(
          languageCode: arabic,
          languageName: Strings.arabic.tr(),
          locale: arabicLocale,
        ),
      ],
    );
  }

  Widget _buildLanguageOption({
    required String languageCode,
    required String languageName,
    required Locale locale,
  }) {
    final isSelected = _selectedLanguage == languageCode;

    return GestureDetector(
      onTap: () => _selectLanguage(languageCode, locale),
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.symmetric(
          horizontal: AppPadding.p20.w,
          vertical: AppPadding.p18.h,
        ),
        decoration: BoxDecoration(
          color: isSelected
              ? ColorManager.brandPrimary.withOpacity(0.1)
              : ColorManager.backgroundSubtle,
          borderRadius: BorderRadius.circular(AppSize.s12.r),
          border: Border.all(
            color: isSelected
                ? ColorManager.brandPrimary
                : ColorManager.borderDefault,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: AppSize.s24.w,
              height: AppSize.s24.h,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: isSelected
                      ? ColorManager.brandPrimary
                      : ColorManager.textSecondary,
                  width: 2,
                ),
              ),
              child: isSelected
                  ? Center(
                      child: Container(
                        width: AppSize.s12.w,
                        height: AppSize.s12.h,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: ColorManager.brandPrimary,
                        ),
                      ),
                    )
                  : null,
            ),
            Gap(AppSize.s16.w),
            Text(
              languageName,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: isSelected
                        ? ColorManager.brandPrimary
                        : ColorManager.textPrimary,
                    fontWeight:
                        isSelected ? FontWeight.bold : FontWeight.normal,
                    fontSize: FontSizeManager.s16.sp,
                  ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _selectLanguage(String languageCode, Locale locale) async {
    if (_selectedLanguage == languageCode) return;
    setState(() {
      _selectedLanguage = languageCode;
    });

    await _appPreferences.setAppLanguage(languageCode);
    if (!mounted) return;
    await context.setLocale(locale);
  }

  Widget _buildContinueButton() {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: _selectedLanguage != null ? _handleContinue : null,
        style: ElevatedButton.styleFrom(
          backgroundColor: ColorManager.brandPrimary,
          disabledBackgroundColor: ColorManager.backgroundSubtle,
          padding: EdgeInsets.symmetric(vertical: AppPadding.p18.h),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSize.s12.r),
          ),
          elevation: 0,
        ),
        child: Text(
          Strings.continue_.tr(),
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: _selectedLanguage != null
                    ? ColorManager.backgroundSurface
                    : ColorManager.textSecondary,
                fontWeight: FontWeight.bold,
                fontSize: FontSizeManager.s16.sp,
              ),
        ),
      ),
    );
  }

  Future<void> _handleContinue() async {
    if (_selectedLanguage == null) return;

    await _appPreferences.setLanguageSelected();

    if (mounted) {
      context.go(OnboardingScreen.routeName);
    }
  }
}
