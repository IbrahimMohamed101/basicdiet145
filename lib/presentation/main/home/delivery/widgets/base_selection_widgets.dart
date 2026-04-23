import 'package:basic_diet/presentation/resources/color_manager.dart';
import 'package:basic_diet/presentation/resources/font_manager.dart';
import 'package:basic_diet/presentation/resources/strings_manager.dart';
import 'package:basic_diet/presentation/resources/styles_manager.dart';
import 'package:basic_diet/presentation/resources/values_manager.dart';
import 'package:basic_diet/presentation/widgets/button_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:gap/gap.dart';

class SelectionModal<T> extends StatefulWidget {
  final String title;
  final List<T> items;
  final T? initialSelection;
  final Widget Function(T item, T? currentSelection, ValueChanged<T> onSelected)
  itemBuilder;
  final void Function(T selected) onConfirm;

  const SelectionModal({
    super.key,
    required this.title,
    required this.items,
    this.initialSelection,
    required this.itemBuilder,
    required this.onConfirm,
  });

  @override
  State<SelectionModal<T>> createState() => _SelectionModalState<T>();
}

class _SelectionModalState<T> extends State<SelectionModal<T>> {
  late T? _tempSelected;

  @override
  void initState() {
    super.initState();
    _tempSelected = widget.initialSelection;
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsetsDirectional.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Container(
        padding: EdgeInsetsDirectional.all(AppPadding.p20.w),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _buildHeader(context),
            const Divider(),
            Flexible(
              child: SingleChildScrollView(
                child: Column(
                  children: widget.items
                      .map(
                        (item) => widget.itemBuilder(
                          item,
                          _tempSelected,
                          (selected) =>
                              setState(() => _tempSelected = selected),
                        ),
                      )
                      .toList(),
                ),
              ),
            ),
            Gap(AppSize.s24.h),
            ButtonWidget(
              radius: AppSize.s12,
              text: Strings.confirm,
              color: _tempSelected != null
                  ? ColorManager.brandPrimary
                  : ColorManager.backgroundSubtle,
              textColor: _tempSelected != null
                  ? ColorManager.backgroundSurface
                  : ColorManager.textSecondary,
              onTap: _tempSelected != null
                  ? () {
                      widget.onConfirm(_tempSelected!);
                      Navigator.pop(context);
                    }
                  : null,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          widget.title,
          style: getBoldTextStyle(
            color: ColorManager.textPrimary,
            fontSize: FontSizeManager.s18.sp,
          ),
        ),
        IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.pop(context),
        ),
      ],
    );
  }
}

class RadioSelectionTile extends StatelessWidget {
  final String label;
  final bool isSelected;
  final bool isAvailable;
  final String? subtitle;
  final String? trailing;
  final VoidCallback onTap;

  const RadioSelectionTile({
    super.key,
    required this.label,
    required this.isSelected,
    this.isAvailable = true,
    this.subtitle,
    this.trailing,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = isAvailable
        ? (isSelected ? ColorManager.brandPrimary : ColorManager.textPrimary)
        : ColorManager.textSecondary.withValues(alpha: 0.5);

    return Padding(
      padding: EdgeInsetsDirectional.only(bottom: AppPadding.p12.h),
      child: InkWell(
        onTap: isAvailable ? onTap : null,
        child: Container(
          padding: EdgeInsetsDirectional.all(AppPadding.p14.w),
          decoration: BoxDecoration(
            color: isSelected
                ? ColorManager.brandPrimary.withValues(alpha: 0.05)
                : ColorManager.transparent,
            borderRadius: BorderRadius.circular(AppSize.s12.r),
            border: Border.all(
              color: isSelected
                  ? ColorManager.brandPrimary
                  : ColorManager.borderDefault.withValues(
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
                    ? ColorManager.brandPrimary
                    : ColorManager.borderDefault.withValues(
                        alpha: isAvailable ? 1 : 0.5,
                      ),
              ),
              Gap(AppSize.s12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: getBoldTextStyle(
                        color: color,
                        fontSize: FontSizeManager.s16.sp,
                      ),
                    ),
                    if (subtitle != null)
                      Text(
                        subtitle!,
                        style: getRegularTextStyle(
                          color: ColorManager.textSecondary,
                          fontSize: FontSizeManager.s12.sp,
                        ),
                      ),
                  ],
                ),
              ),
              if (trailing != null)
                Text(
                  trailing!,
                  style: getRegularTextStyle(
                    color: ColorManager.textSecondary,
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
