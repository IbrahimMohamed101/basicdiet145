import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class CustomPremiumMealBuilderResult {
  final String proteinId;
  final String carbId;
  final String presetKey;
  final List<String> vegetables;
  final List<String> addons;
  final List<String> fruits;
  final List<String> nuts;
  final List<String> sauce;

  const CustomPremiumMealBuilderResult({
    required this.proteinId,
    required this.carbId,
    required this.presetKey,
    this.vegetables = const [],
    this.addons = const [],
    this.fruits = const [],
    this.nuts = const [],
    this.sauce = const [],
  });
}

class CustomPremiumMealBuilderScreen extends StatefulWidget {
  final CustomPremiumSaladModel config;
  final List<BuilderProteinModel> premiumProteins;
  final String? initialProteinId;

  const CustomPremiumMealBuilderScreen({
    super.key,
    required this.config,
    required this.premiumProteins,
    this.initialProteinId,
  });

  @override
  State<CustomPremiumMealBuilderScreen> createState() =>
      _CustomPremiumMealBuilderScreenState();
}

class _CustomPremiumMealBuilderScreenState
    extends State<CustomPremiumMealBuilderScreen> {
  late String? _selectedProteinId;
  final Map<String, List<String>> _selectedByGroup = {};
  late final List<String> _groupOrder;
  int _stepIndex = 0;

  @override
  void initState() {
    super.initState();
    _selectedProteinId = widget.initialProteinId;
    _groupOrder = widget.config.preset.groups.map((group) => group.key).toList();
    for (final key in _groupOrder) {
      _selectedByGroup[key] = <String>[];
    }
  }

  @override
  Widget build(BuildContext context) {
    final isLastStep = _stepIndex == _totalSteps - 1;
    final canContinue = isLastStep ? _isFormValid : _isCurrentStepValid;
    final price = (widget.config.extraFeeHalala / 100.0).toStringAsFixed(2);

    return Scaffold(
      backgroundColor: ColorManager.backgroundSurface,
      appBar: AppBar(
        title: Text(Strings.customMealBuilder.tr()),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.symmetric(
                horizontal: AppPadding.p16.w,
                vertical: AppPadding.p12.h,
              ),
              child: _WizardProgress(
                currentStep: _stepIndex + 1,
                totalSteps: _totalSteps,
              ),
            ),
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 200),
                child: _stepIndex == _totalSteps - 1
                    ? _buildReviewStep(price)
                    : _buildSelectionStep(),
              ),
            ),
            Padding(
              padding: EdgeInsets.all(AppPadding.p16.w),
              child: Row(
                children: [
                  if (_stepIndex > 0) ...[
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => setState(() => _stepIndex--),
                        style: OutlinedButton.styleFrom(
                          minimumSize: Size.fromHeight(52.h),
                        ),
                        child: Text(Strings.back.tr()),
                      ),
                    ),
                    Gap(AppSize.s10.w),
                  ],
                  Expanded(
                    child: ElevatedButton(
                      onPressed: canContinue ? _onContinue : null,
                      style: ElevatedButton.styleFrom(
                        minimumSize: Size.fromHeight(52.h),
                        backgroundColor: ColorManager.brandPrimary,
                        disabledBackgroundColor: ColorManager.stateDisabledSurface,
                      ),
                      child: Text(
                        isLastStep ? Strings.confirm.tr() : Strings.continueText.tr(),
                        style: getBoldTextStyle(
                          color:
                              canContinue
                                  ? ColorManager.textInverse
                                  : ColorManager.stateDisabled,
                          fontSize: FontSizeManager.s14.sp,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSelectionStep() {
    return ListView(
      key: ValueKey<int>(_stepIndex),
      padding: EdgeInsets.all(AppPadding.p16.w),
      children: [
        Text(
          widget.config.name,
          style: getBoldTextStyle(
            color: ColorManager.textPrimary,
            fontSize: FontSizeManager.s20.sp,
          ),
        ),
        Gap(AppSize.s12.h),
        if (_stepIndex == 0) _buildProteinSelector() else _buildCurrentGroupSection(),
      ],
    );
  }

  Widget _buildProteinSelector() {
    final selectedId = _selectedProteinId;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          Strings.selectProtein.tr(),
          style: getBoldTextStyle(
            color: ColorManager.textPrimary,
            fontSize: FontSizeManager.s15.sp,
          ),
        ),
        Gap(AppSize.s8.h),
        Wrap(
          spacing: AppSize.s8.w,
          runSpacing: AppSize.s8.h,
          children:
              widget.premiumProteins.map((protein) {
                final isSelected = selectedId == protein.id;
                return _SelectionChip(
                  label: protein.name,
                  selected: isSelected,
                  onTap: () => setState(() => _selectedProteinId = protein.id),
                );
              }).toList(),
        ),
      ],
    );
  }

  Widget _buildCurrentGroupSection() {
    final groupKey = _groupOrder[_stepIndex - 1];
    final group = widget.config.preset.groups.firstWhere((g) => g.key == groupKey);
    final normalizedGroupKey = _normalizedGroupKey(group.key);
    final ingredients = widget.config.ingredients.where((ingredient) {
      final normalized = _normalizedGroupKey(ingredient.groupKey);
      return normalized == normalizedGroupKey;
    }).toList();

    if (ingredients.isEmpty) {
      return const SizedBox.shrink();
    }

    final selected = _selectedByGroup[group.key] ?? const [];
    final helper = _groupRuleText(group);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _groupTitle(group.key),
          style: getBoldTextStyle(
            color: ColorManager.textPrimary,
            fontSize: FontSizeManager.s16.sp,
          ),
        ),
        if (helper.isNotEmpty) ...[
          Gap(AppSize.s4.h),
          Text(
            helper,
            style: getRegularTextStyle(
              color: ColorManager.textSecondary,
              fontSize: FontSizeManager.s12.sp,
            ),
          ),
        ],
        Gap(AppSize.s12.h),
        Wrap(
          spacing: AppSize.s8.w,
          runSpacing: AppSize.s8.h,
          children:
              ingredients.map((item) {
                final isSelected = selected.contains(item.id);
                return _SelectionChip(
                  label: item.name,
                  selected: isSelected,
                  onTap:
                      () => _toggleIngredient(
                        group: group,
                        ingredientId: item.id,
                        isSelected: isSelected,
                      ),
                );
              }).toList(),
        ),
      ],
    );
  }

  Widget _buildReviewStep(String price) {
    return ListView(
      key: const ValueKey<String>('review_step'),
      padding: EdgeInsets.all(AppPadding.p16.w),
      children: [
        Text(
          Strings.summary.tr(),
          style: getBoldTextStyle(
            color: ColorManager.textPrimary,
            fontSize: FontSizeManager.s18.sp,
          ),
        ),
        Gap(AppSize.s12.h),
        _ReviewRow(
          label: Strings.selectProtein.tr(),
          value: _proteinNameById(_selectedProteinId),
        ),
        ..._groupOrder.map((groupKey) {
          final names = _selectedNamesForGroup(groupKey);
          return _ReviewRow(
            label: _groupTitle(groupKey),
            value: names.isEmpty ? '-' : names.join(', '),
          );
        }),
        Gap(AppSize.s16.h),
        Container(
          padding: EdgeInsets.all(AppPadding.p12.w),
          decoration: BoxDecoration(
            color: ColorManager.brandAccentSoft,
            borderRadius: BorderRadius.circular(AppSize.s12.r),
            border: Border.all(color: ColorManager.brandAccentBorder),
          ),
          child: Text(
            '${Strings.totalAmount.tr()}: $price ${Strings.sar.tr()}',
            style: getBoldTextStyle(
              color: ColorManager.brandAccent,
              fontSize: FontSizeManager.s14.sp,
            ),
          ),
        ),
      ],
    );
  }

  void _toggleIngredient({
    required CustomPremiumSaladGroupRuleModel group,
    required String ingredientId,
    required bool isSelected,
  }) {
    final current = List<String>.from(_selectedByGroup[group.key] ?? const []);

    if (isSelected) {
      current.remove(ingredientId);
    } else {
      if (group.maxSelect == 1) {
        current
          ..clear()
          ..add(ingredientId);
      } else if (group.maxSelect <= 0 || current.length < group.maxSelect) {
        current.add(ingredientId);
      }
    }

    setState(() {
      _selectedByGroup[group.key] = current;
    });
  }

  String _groupTitle(String key) {
    switch (_normalizedGroupKey(key)) {
      case 'vegetables':
        return 'Vegetables';
      case 'addons':
        return 'Add-ons';
      case 'fruits':
        return 'Fruits';
      case 'nuts':
        return 'Nuts';
      case 'sauce':
        return 'Sauce';
      default:
        return key;
    }
  }

  String _groupRuleText(CustomPremiumSaladGroupRuleModel group) {
    if (group.minSelect == 1 && group.maxSelect == 1) {
      return Strings.chooseOneRequired.tr();
    }
    if (group.minSelect > 0) {
      return '${Strings.chooseAtLeast.tr()} ${group.minSelect}';
    }
    return '';
  }

  String _normalizedGroupKey(String input) {
    final key = input.toLowerCase().replaceAll('_', '').replaceAll(' ', '');
    if (key == 'nutscheese') return 'nuts';
    if (key == 'addon' || key == 'addons' || key == 'additions') return 'addons';
    if (key == 'vegetable' || key == 'vegetables') return 'vegetables';
    if (key == 'fruit' || key == 'fruits') return 'fruits';
    if (key == 'nut' || key == 'nuts') return 'nuts';
    if (key == 'sauce' || key == 'sauces') return 'sauce';
    return key;
  }

  bool get _isFormValid {
    if (_selectedProteinId == null || _selectedProteinId!.isEmpty) return false;

    for (final group in widget.config.preset.groups) {
      final selected = _selectedByGroup[group.key] ?? const [];
      if (selected.length < group.minSelect) return false;
      if (group.maxSelect > 0 && selected.length > group.maxSelect) return false;
    }
    return true;
  }

  bool get _isCurrentStepValid {
    if (_stepIndex == 0) {
      return _selectedProteinId != null && _selectedProteinId!.isNotEmpty;
    }

    if (_stepIndex == _totalSteps - 1) {
      return _isFormValid;
    }

    final groupKey = _groupOrder[_stepIndex - 1];
    final group = widget.config.preset.groups.firstWhere((g) => g.key == groupKey);
    final selected = _selectedByGroup[groupKey] ?? const [];
    if (selected.length < group.minSelect) return false;
    if (group.maxSelect > 0 && selected.length > group.maxSelect) return false;
    return true;
  }

  int get _totalSteps => 1 + _groupOrder.length + 1;

  String _proteinNameById(String? id) {
    if (id == null) return '-';
    for (final protein in widget.premiumProteins) {
      if (protein.id == id) return protein.name;
    }
    return '-';
  }

  List<String> _selectedNamesForGroup(String groupKey) {
    final selectedIds = _selectedByGroup[groupKey] ?? const [];
    if (selectedIds.isEmpty) return const [];
    final names = <String>[];
    final normalizedGroupKey = _normalizedGroupKey(groupKey);
    for (final ingredient in widget.config.ingredients) {
      if (_normalizedGroupKey(ingredient.groupKey) != normalizedGroupKey) continue;
      if (selectedIds.contains(ingredient.id)) {
        names.add(ingredient.name);
      }
    }
    return names;
  }

  void _onContinue() {
    if (_stepIndex == _totalSteps - 1) {
      _onApply();
      return;
    }
    setState(() {
      _stepIndex++;
    });
  }

  void _onApply() {
    final result = CustomPremiumMealBuilderResult(
      proteinId: _selectedProteinId!,
      carbId: widget.config.carbId,
      presetKey: widget.config.preset.key,
      vegetables: _selectedCanonicalGroup('vegetables'),
      addons: _selectedCanonicalGroup('addons'),
      fruits: _selectedCanonicalGroup('fruits'),
      nuts: _selectedCanonicalGroup('nuts'),
      sauce: _selectedCanonicalGroup('sauce'),
    );
    Navigator.of(context).pop(result);
  }

  List<String> _selectedCanonicalGroup(String target) {
    final out = <String>[];
    for (final entry in _selectedByGroup.entries) {
      if (_normalizedGroupKey(entry.key) == target) {
        out.addAll(entry.value);
      }
    }
    return out;
  }
}

class _WizardProgress extends StatelessWidget {
  final int currentStep;
  final int totalSteps;

  const _WizardProgress({
    required this.currentStep,
    required this.totalSteps,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            Text(
              '$currentStep / $totalSteps',
              style: getRegularTextStyle(
                color: ColorManager.textSecondary,
                fontSize: FontSizeManager.s12.sp,
              ),
            ),
          ],
        ),
        Gap(AppSize.s8.h),
        ClipRRect(
          borderRadius: BorderRadius.circular(AppSize.s8.r),
          child: LinearProgressIndicator(
            minHeight: 6.h,
            value: currentStep / totalSteps,
            color: ColorManager.brandPrimary,
            backgroundColor: ColorManager.backgroundSubtle,
          ),
        ),
      ],
    );
  }
}

class _ReviewRow extends StatelessWidget {
  final String label;
  final String value;

  const _ReviewRow({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: EdgeInsets.only(bottom: AppSize.s10.h),
      padding: EdgeInsets.all(AppPadding.p12.w),
      decoration: BoxDecoration(
        border: Border.all(color: ColorManager.borderDefault),
        borderRadius: BorderRadius.circular(AppSize.s10.r),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: getBoldTextStyle(
                color: ColorManager.textPrimary,
                fontSize: FontSizeManager.s14.sp,
              ),
            ),
          ),
          Gap(AppSize.s10.w),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: getRegularTextStyle(
                color: ColorManager.textSecondary,
                fontSize: FontSizeManager.s12.sp,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SelectionChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _SelectionChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: EdgeInsets.symmetric(
              horizontal: AppPadding.p12.w,
              vertical: AppPadding.p10.h,
            ),
            decoration: BoxDecoration(
              color:
                  selected
                      ? ColorManager.brandPrimary.withValues(alpha: 0.14)
                      : ColorManager.backgroundSurface,
              borderRadius: BorderRadius.circular(AppSize.s12.r),
              border: Border.all(
                color: selected ? ColorManager.brandPrimary : ColorManager.borderDefault,
              ),
            ),
            child: Text(
              label,
              style: getBoldTextStyle(
                color: selected ? ColorManager.brandPrimary : ColorManager.textPrimary,
                fontSize: FontSizeManager.s12.sp,
              ),
            ),
          ),
          if (selected)
            PositionedDirectional(
              top: -6.h,
              end: -6.w,
              child: Container(
                height: 18.w,
                width: 18.w,
                decoration: const BoxDecoration(
                  color: ColorManager.brandPrimary,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.check,
                  color: ColorManager.textInverse,
                  size: 12.w,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
