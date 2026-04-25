import 'package:basic_diet/domain/model/meal_planner_menu_model.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_bloc.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_event.dart';
import 'package:basic_diet/presentation/plans/timeline/meal_planner/bloc/meal_planner_state.dart';
import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class ProteinPickerSheet extends StatefulWidget {
  final MealPlannerLoaded state;
  final int slotIndex;
  final String? selectedProteinId;
  final int availablePremiumCredits;

  const ProteinPickerSheet({
    super.key,
    required this.state,
    required this.slotIndex,
    required this.selectedProteinId,
    required this.availablePremiumCredits,
  });

  @override
  State<ProteinPickerSheet> createState() => _ProteinPickerSheetState();
}

class _ProteinPickerSheetState extends State<ProteinPickerSheet> {
  late String _activeTabKey;

  @override
  void initState() {
    super.initState();
    _activeTabKey = 'premium';
    final selectedProtein = widget.selectedProteinId == null
        ? null
        : _proteinById(widget.selectedProteinId!);

    if (selectedProtein != null && selectedProtein.isPremium) {
      _activeTabKey = 'premium';
    } else if (selectedProtein != null) {
      _activeTabKey = selectedProtein.displayCategoryKey;
    }
  }

  BuilderProteinModel? _proteinById(String id) {
    for (final protein in widget.state.menu.builderCatalog.proteins) {
      if (protein.id == id) return protein;
    }
    return null;
  }

  String _iconForTabKey(String key) {
    switch (key.toLowerCase()) {
      case 'chicken':
        return '🍗';
      case 'beef':
        return '🥩';
      case 'seafood':
        return '🦐';
      case 'egg':
        return '🥚';
      case 'premium':
        return '⭐';
      default:
        return '🍽️';
    }
  }

  List<BuilderProteinModel> _filteredProteins(String tabKey) {
    final proteins = widget.state.menu.builderCatalog.proteins;
    final filtered = tabKey == 'premium'
        ? proteins.where((p) => p.isPremium).toList()
        : proteins
              .where((p) => !p.isPremium && p.displayCategoryKey == tabKey)
              .toList();
    filtered.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return filtered;
  }

  @override
  Widget build(BuildContext context) {
    final allCategories =
        widget.state.menu.builderCatalog.categories
            .where((c) => c.dimension == 'protein')
            .toList()
          ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

    if (allCategories.isEmpty) {
      return _EmptySheet();
    }

    final selectedProtein = widget.selectedProteinId == null
        ? null
        : _proteinById(widget.selectedProteinId!);

    final beefRule = widget.state.menu.builderCatalog.rules.beef;
    final slots =
        widget.state.selectedSlotsPerDay[widget.state.selectedDayIndex] ?? [];

    var beefCount = 0;
    for (final slot in slots) {
      final proteinId = slot.proteinId;
      if (proteinId == null) continue;
      final protein = _proteinById(proteinId);
      if (protein != null &&
          !protein.isPremium &&
          protein.proteinFamilyKey == beefRule.proteinFamilyKey) {
        beefCount++;
      }
    }

    final currentIsBeef =
        selectedProtein != null &&
        !selectedProtein.isPremium &&
        selectedProtein.proteinFamilyKey == beefRule.proteinFamilyKey;

    final isBeefDisabled =
        beefRule.maxSlotsPerDay > 0 &&
        beefCount >= beefRule.maxSlotsPerDay &&
        !currentIsBeef;

    final tabs = [
      _ProteinTab(key: 'premium', label: Strings.premium.tr()),
      ...allCategories.map((c) => _ProteinTab(key: c.key, label: c.name)),
    ];

    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: ColorManager.backgroundSurface,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(AppSize.s24.r),
            ),
          ),
          child: Column(
            children: [
              Gap(AppSize.s10.h),
              _SheetHandle(),
              Gap(AppSize.s12.h),
              _SheetHeader(title: Strings.selectProtein.tr()),
              Gap(AppSize.s4.h),
              _CategoryTabs(
                tabs: tabs,
                activeTabKey: _activeTabKey,
                beefRuleKey: beefRule.proteinFamilyKey,
                isBeefDisabled: isBeefDisabled,
                iconForTabKey: _iconForTabKey,
                onTabSelected: (key) => setState(() => _activeTabKey = key),
              ),
              Gap(AppSize.s12.h),
              Expanded(
                child: _ProteinList(
                  proteins: _filteredProteins(_activeTabKey),
                  selectedProteinId: widget.selectedProteinId,
                  slotIndex: widget.slotIndex,
                  isBeefDisabled: isBeefDisabled,
                  beefFamilyKey: beefRule.proteinFamilyKey,
                  currentIsBeef: currentIsBeef,
                  scrollController: scrollController,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _CategoryTabs extends StatelessWidget {
  final List<_ProteinTab> tabs;
  final String activeTabKey;
  final String beefRuleKey;
  final bool isBeefDisabled;
  final String Function(String) iconForTabKey;
  final void Function(String) onTabSelected;

  const _CategoryTabs({
    required this.tabs,
    required this.activeTabKey,
    required this.beefRuleKey,
    required this.isBeefDisabled,
    required this.iconForTabKey,
    required this.onTabSelected,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 88.h,
      child: ListView.separated(
        padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
        scrollDirection: Axis.horizontal,
        itemCount: tabs.length,
        separatorBuilder: (_, __) => Gap(AppSize.s12.w),
        itemBuilder: (context, index) {
          final tab = tabs[index];
          final isSelected = tab.key == activeTabKey;
          final isPremiumTab = tab.key == 'premium';
          final isBeefTab = tab.key == beefRuleKey && !isPremiumTab;
          final isTabDisabled = isBeefTab && isBeefDisabled;
          final activeCardColor = isPremiumTab
              ? ColorManager.brandAccent
              : ColorManager.brandPrimary;

          return GestureDetector(
            onTap: isTabDisabled ? null : () => onTabSelected(tab.key),
            child: Opacity(
              opacity: isTabDisabled ? 0.4 : 1.0,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    width: 56.w,
                    height: 56.w,
                    decoration: BoxDecoration(
                      color: isSelected
                          ? activeCardColor
                          : ColorManager.backgroundSurface,
                      borderRadius: BorderRadius.circular(AppSize.s16.r),
                      border: isSelected
                          ? null
                          : Border.all(
                              color: isPremiumTab
                                  ? ColorManager.brandAccentBorder
                                  : ColorManager.borderDefault,
                            ),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      iconForTabKey(tab.key),
                      style: TextStyle(fontSize: 26.sp),
                    ),
                  ),
                  Gap(6.h),
                  Text(
                    tab.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: getBoldTextStyle(
                      color: isSelected
                          ? (isPremiumTab
                                ? ColorManager.brandAccent
                                : ColorManager.brandPrimary)
                          : ColorManager.textSecondary,
                      fontSize: FontSizeManager.s10.sp,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ProteinList extends StatelessWidget {
  final List<BuilderProteinModel> proteins;
  final String? selectedProteinId;
  final int slotIndex;
  final bool isBeefDisabled;
  final String beefFamilyKey;
  final bool currentIsBeef;
  final ScrollController scrollController;

  const _ProteinList({
    required this.proteins,
    required this.selectedProteinId,
    required this.slotIndex,
    required this.isBeefDisabled,
    required this.beefFamilyKey,
    required this.currentIsBeef,
    required this.scrollController,
  });

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      controller: scrollController,
      padding: EdgeInsets.only(
        left: AppPadding.p16.w,
        right: AppPadding.p16.w,
        bottom: 24.h,
      ),
      itemCount: proteins.length,
      separatorBuilder: (_, __) => Gap(AppSize.s10.h),
      itemBuilder: (context, index) {
        final protein = proteins[index];
        final isSelected = selectedProteinId == protein.id;
        final isItemDisabled =
            !protein.isPremium &&
            isBeefDisabled &&
            protein.proteinFamilyKey == beefFamilyKey &&
            !currentIsBeef;

        return _ProteinItem(
          protein: protein,
          isSelected: isSelected,
          isDisabled: isItemDisabled,
          slotIndex: slotIndex,
        );
      },
    );
  }
}

class _ProteinItem extends StatelessWidget {
  final BuilderProteinModel protein;
  final bool isSelected;
  final bool isDisabled;
  final int slotIndex;

  const _ProteinItem({
    required this.protein,
    required this.isSelected,
    required this.isDisabled,
    required this.slotIndex,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isDisabled
          ? null
          : () {
              context.read<MealPlannerBloc>().add(
                SetMealSlotProteinEvent(
                  slotIndex: slotIndex,
                  proteinId: protein.id,
                ),
              );
              Navigator.pop(context);
            },
      child: Opacity(
        opacity: isDisabled ? 0.4 : 1.0,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: EdgeInsets.all(AppPadding.p12.w),
          decoration: BoxDecoration(
            color: isSelected
                ? ColorManager.brandPrimaryTint
                : ColorManager.backgroundSurface,
            borderRadius: BorderRadius.circular(AppSize.s16.r),
            border: Border.all(
              color: isSelected
                  ? ColorManager.brandPrimary
                  : ColorManager.borderDefault,
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            protein.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: getBoldTextStyle(
                              color: ColorManager.textPrimary,
                              fontSize: FontSizeManager.s14.sp,
                            ),
                          ),
                        ),
                        if (protein.isPremium) ...[
                          Gap(AppSize.s8.w),
                          _PremiumTag(),
                        ],
                      ],
                    ),
                    if (protein.description.isNotEmpty) ...[
                      Gap(4.h),
                      Text(
                        protein.description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: getRegularTextStyle(
                          color: ColorManager.textSecondary,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Gap(AppSize.s8.w),
              Icon(
                isSelected ? Icons.check_circle : Icons.radio_button_unchecked,
                color: isSelected
                    ? ColorManager.brandPrimary
                    : ColorManager.stateDisabled,
                size: 22.w,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PremiumTag extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
      decoration: BoxDecoration(
        color: ColorManager.brandAccentSoft,
        borderRadius: BorderRadius.circular(99.r),
        border: Border.all(color: ColorManager.brandAccentBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.workspace_premium,
            color: ColorManager.brandAccent,
            size: 12.w,
          ),
          Gap(3.w),
          Text(
            Strings.premium.tr(),
            style: getBoldTextStyle(
              color: ColorManager.brandAccent,
              fontSize: FontSizeManager.s10.sp,
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptySheet extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: ColorManager.backgroundSurface,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppSize.s24.r),
        ),
      ),
      padding: EdgeInsets.all(AppPadding.p16.w),
      child: SafeArea(
        child: Text(
          Strings.noContent.tr(),
          style: getRegularTextStyle(
            color: ColorManager.textSecondary,
            fontSize: FontSizeManager.s14.sp,
          ),
        ),
      ),
    );
  }
}

class _SheetHandle extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 48.w,
      height: 5.h,
      decoration: BoxDecoration(
        color: ColorManager.backgroundSubtle,
        borderRadius: BorderRadius.circular(99.r),
      ),
    );
  }
}

class _SheetHeader extends StatelessWidget {
  final String title;

  const _SheetHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: AppPadding.p16.w),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: getBoldTextStyle(
                color: ColorManager.textPrimary,
                fontSize: FontSizeManager.s18.sp,
              ),
            ),
          ),
          IconButton(
            onPressed: () => Navigator.pop(context),
            icon: Icon(
              Icons.close,
              color: ColorManager.iconSecondary,
              size: 20.w,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProteinTab {
  final String key;
  final String label;
  const _ProteinTab({required this.key, required this.label});
}
