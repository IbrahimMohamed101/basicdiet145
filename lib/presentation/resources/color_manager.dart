import 'package:flutter/material.dart';

class ColorManager {
  const ColorManager._();

  // Brand Colors
  static const Color brandPrimary = Color(0xFF10B981);
  static const Color brandPrimaryPressed = Color(0xFF16664A);
  static const Color brandPrimaryHover = Color(0xFF2E9C75);
  static const Color brandPrimaryTint = Color(0xFFEAF7F1);
  static const Color brandAccent = Color(0xFFFF6900);
  static const Color brandAccentPressed = Color(0xFFFF5A00);
  static const Color brandAccentSoft = Color(0xFFFFF0E8);
  static const Color brandAccentBorder = Color(0xFFFFA577);

  // Text Colors
  static const Color textPrimary = Color(0xFF111827);
  static const Color textSecondary = Color(0xFF6B7280);
  static const Color textInverse = Color(0xFFFFFFFF);
  static const Color textMuted = Color(0xFF9CA3AF);

  // Background Colors
  static const Color backgroundApp = Color(0xFFF8FAF9);
  static const Color backgroundSurface = Color(0xFFFFFFFF);
  static const Color backgroundSubtle = Color(0xFFF3F4F6);
  static const Color backgroundOverlayStrong = Color(0xCC111827);

  // Border Colors
  static const Color borderDefault = Color(0xFFE5E7EB);
  static const Color borderSubtle = Color(0xFFF2F4F7);
  static const Color borderAccent = Color(0xFFFFA577);

  // Icon Colors
  static const Color iconPrimary = Color(0xFF111827);
  static const Color iconSecondary = Color(0xFF6B7280);
  static const Color iconInverse = Color(0xFFFFFFFF);
  static const Color iconAccent = Color(0xFFFF6900);
  static const Color iconSuccess = Color(0xFF16664A);

  // State Colors
  static const Color stateSuccess = Color(0xFF10B981);
  static const Color stateSuccessEmphasis = Color(0xFF16664A);
  static const Color stateSuccessSurface = Color(0xFFEAF7F1);
  static const Color stateWarning = Color(0xFFFF6900);
  static const Color stateWarningEmphasis = Color(0xFFFF5A00);
  static const Color stateWarningSurface = Color(0xFFFFF0E8);
  static const Color stateWarningBorder = Color(0xFFFFA577);
  static const Color stateError = Color(0xFFED1B24);
  static const Color stateErrorSurface = Color(0xFFFEF2F2);
  static const Color stateErrorBorder = Color(0xFFFECACA);
  static const Color stateErrorEmphasis = Color(0xFF991B1B);
  static const Color stateInfo = Color(0xFFEAF7F1);
  static const Color stateInfoEmphasis = Color(0xFF16664A);
  static const Color stateActive = Color(0xFF10B981);
  static const Color stateSelected = Color(0xFFEAF7F1);
  static const Color stateDisabled = Color(0xFF9CA3AF);
  static const Color stateDisabledSurface = Color(0xFFF3F4F6);

  // Blue Colors (for Frozen state)
  static const Color bluePrimary = Color(0xFF3B82F6);
  static const Color blueSurface = Color(0xFFEFF6FF);
  static const Color blueBorder = Color(0xFFBFDBFE);
  static const Color blueEmphasis = Color(0xFF1E40AF);

  static const Color transparent = Color(0x00000000);

  // Glow/Shadow helpers (10% alpha brand colors, safe for const use)
  static const Color brandPrimaryGlow = Color(0x1A10B981);
  static const Color brandAccentGlow = Color(0x1AFF6900);

  // Legacy Aliases (Deprecated)
  @Deprecated('Use brandPrimary')
  static const Color greenPrimary = brandPrimary;
  @Deprecated('Use brandPrimaryPressed')
  static const Color greenPressed = brandPrimaryPressed;
  @Deprecated('Use brandPrimaryHover')
  static const Color greenHover = brandPrimaryHover;
  @Deprecated('Use brandPrimaryTint')
  static const Color greenLight = brandPrimaryTint;
  @Deprecated('Use stateSuccessEmphasis')
  static const Color greenDark = stateSuccessEmphasis;

  @Deprecated('Use brandAccent')
  static const Color orangePrimary = brandAccent;
  @Deprecated('Use brandAccentPressed')
  static const Color orangePressed = brandAccentPressed;
  @Deprecated('Use stateWarningSurface')
  static const Color orangeHover = stateWarningSurface;
  @Deprecated('Use borderAccent')
  static const Color orangeLight = stateWarningBorder;
  @Deprecated('Use brandAccent')
  static const Color orangeF54900 = brandAccent;
  @Deprecated('Use brandAccentSoft')
  static const Color orangeFFF5EC = brandAccentSoft;

  @Deprecated('Use textInverse')
  static const Color whiteColor = textInverse;
  @Deprecated('Use brandPrimaryTint')
  static const Color whiteF0FDF4 = brandPrimaryTint;
  @Deprecated('Use textPrimary')
  static const Color blackColor = textPrimary;
  @Deprecated('Use textPrimary')
  static const Color black101828 = textPrimary;
  @Deprecated('Use textSecondary')
  static const Color grayColor = textSecondary;
  @Deprecated('Use textSecondary')
  static const Color grey6A7282 = textSecondary;
  @Deprecated('Use textSecondary')
  static const Color grey4A5565 = Color(0xFF4B5563);
  @Deprecated('Use textPrimary')
  static const Color grey364153 = Color(0xFF374151);
  @Deprecated('Use textMuted')
  static const Color grey9CA3AF = textMuted;
  @Deprecated('Use backgroundSubtle')
  static const Color greyF3F4F6 = backgroundSubtle;

  @Deprecated('Use borderDefault')
  static const Color formFieldsBorderColor = borderDefault;
  @Deprecated('Use stateError')
  static const Color errorColor = stateError;

  @Deprecated('Use brandPrimary')
  static const Color greenFA76F = brandPrimary;
}
