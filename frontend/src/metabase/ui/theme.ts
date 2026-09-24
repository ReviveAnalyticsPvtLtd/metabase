import type { MantineThemeOverride } from "@mantine/core";
import { rem } from "@mantine/core";

import type { ColorSettings } from "metabase-types/api";

import Styles from "./Theme.module.css";
import { DEFAULT_METABASE_COMPONENT_THEME } from "./component-theme";
import {
  accordionOverrides,
  actionIconOverrides,
  alertOverrides,
  anchorOverrides,
  autocompleteOverrides,
  avatarOverrides,
  badgeOverrides,
  breadcrumbsOverrides,
  buttonOverrides,
  calendarOverrides,
  cardOverrides,
  checkboxOverrides,
  chipOverrides,
  codeOverrides,
  comboboxOverrides,
  dateInputOverrides,
  datePickerOverrides,
  dateTimePickerOverrides,
  dialogOverrides,
  dividerOverrides,
  drawerOverrides,
  fileInputOverrides,
  gridOverrides,
  groupOverrides,
  hoverCardOverrides,
  inputOverrides,
  kbdOverrides,
  listOverrides,
  loaderOverrides,
  menuOverrides,
  modalOverrides,
  monthPickerOverrides,
  multiSelectOverrides,
  nativeSelectOverrides,
  navLinkOverrides,
  notificationOverrides,
  numberInputOverrides,
  overlayOverrides,
  paperOverrides,
  passwordInputOverrides,
  pillOverrides,
  pillsInputOverrides,
  popoverOverrides,
  portalOverrides,
  progressOverrides,
  radioOverrides,
  ringProgressOverrides,
  scrollAreaOverrides,
  segmentedControlOverrides,
  selectOverrides,
  simpleGridOverrides,
  skeletonOverrides,
  sliderOverrides,
  stackOverrides,
  switchOverrides,
  tabsOverrides,
  textareaOverrides,
  textInputOverrides,
  textOverrides,
  timeInputOverrides,
  timelineOverrides,
  titleOverrides,
  tooltipOverrides,
} from "./components";
import { getMantineThemeColors } from "./utils/colors";

// Elevation tokens from Vercel Geist design system.
/* eslint-disable metabase/no-color-literals */
const LIGHT_SHADOWS = {
  xs: "0 1px 2px rgba(0, 0, 0, 0.05)",
  xs_outline:
    "0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
  sm: "0 0 0 1px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)",
  sm_outline:
    "0 0 0 1px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.05)",
  lg_outline:
    "0 0 0 1px rgba(0, 0, 0, 0.08), 0 16px 32px rgba(0, 0, 0, 0.08)",
};

const DARK_SHADOWS = {
  xs: "0 0 0 1px #262626",
  xs_outline:
    "0 0 0 1px #262626, 0 1px 2px rgba(0, 0, 0, 0.4)",
  sm: "0 0 0 1px #262626, 0 8px 16px -4px rgba(0, 0, 0, 0.5)",
  sm_outline:
    "0 0 0 1px #333333, 0 8px 24px -4px rgba(0, 0, 0, 0.6)",
  lg_outline:
    "0 0 0 1px #333333, 0 24px 48px -12px rgba(0, 0, 0, 0.8)",
};
/* eslint-enable metabase/no-color-literals */

export type ShadowScaleKey = keyof typeof LIGHT_SHADOWS;

// Spacing tokens from the design system.
const SPACING_SCALE = {
  xxxs: rem(2),
  xxs: rem(4),
  xs: rem(6),
  sm: rem(8),
  md: rem(12),
  lg: rem(16),
  xl: rem(24),
  xxl: rem(32),
  xxxl: rem(40),
};

export type SpacingScaleKey = keyof typeof SPACING_SCALE;

// Vercel Geist disciplined tight radius scale
const RADIUS_SCALE = {
  xxxs: rem(2),
  xxs: rem(4),
  xs: rem(6),
  sm: rem(6),
  md: rem(8),
  lg: rem(12),
  xl: rem(16),
};

export type RadiusScaleKey = keyof typeof RADIUS_SCALE;

export const breakpoints = {
  xs: "23em",
  sm: "40em",
  md: "60em",
  lg: "80em",
  xl: "120em",
};
export type BreakpointName = keyof typeof breakpoints;

export const getThemeOverrides = (
  colorScheme: "light" | "dark" = "light",
  whitelabelColors?: ColorSettings | null,
): MantineThemeOverride => ({
  focusClassName: Styles.focus,
  breakpoints,
  colors: getMantineThemeColors(colorScheme, whitelabelColors),
  primaryColor: "core-brand",
  primaryShade: 0,
  other: {
    ...DEFAULT_METABASE_COMPONENT_THEME,
    colorScheme,
  },
  shadows: {
    ...(colorScheme === "dark" ? DARK_SHADOWS : LIGHT_SHADOWS),
  },
  spacing: { ...SPACING_SCALE },
  radius: { ...RADIUS_SCALE },
  defaultRadius: "xs",
  fontSizes: {
    xs: rem(11),
    sm: rem(12),
    md: rem(14),
    lg: rem(16),
    xl: rem(20),
  },
  lineHeights: {
    xs: "100%",
    sm: "115%",
    md: "122%",
    lg: "138%",
    xl: "150%",
  },
  headings: {
    sizes: {
      h1: {
        fontSize: rem(32),
        lineHeight: rem(38),
      },
      h2: {
        fontSize: rem(24),
        lineHeight: rem(28),
      },
      h3: {
        fontSize: rem(20),
        lineHeight: rem(24),
      },
      h4: {
        fontSize: rem(16),
        lineHeight: rem(20),
      },
      h5: {
        fontSize: rem(14),
        lineHeight: rem(16),
      },
      h6: {
        fontSize: rem(14),
        lineHeight: rem(16),
      },
    },
  },
  fontFamily: 'Geist, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  fontFamilyMonospace: '"Geist Mono", "JetBrains Mono", monospace',
  components: {
    ...accordionOverrides,
    ...actionIconOverrides,
    ...alertOverrides,
    ...anchorOverrides,
    ...autocompleteOverrides,
    ...avatarOverrides,
    ...badgeOverrides,
    ...breadcrumbsOverrides,
    ...buttonOverrides,
    ...calendarOverrides,
    ...cardOverrides,
    ...checkboxOverrides,
    ...chipOverrides,
    ...comboboxOverrides,
    ...codeOverrides,
    ...dateInputOverrides,
    ...datePickerOverrides,
    ...dateTimePickerOverrides,
    ...dialogOverrides,
    ...dividerOverrides,
    ...drawerOverrides,
    ...fileInputOverrides,
    ...gridOverrides,
    ...groupOverrides,
    ...inputOverrides,
    ...kbdOverrides,
    ...loaderOverrides,
    ...menuOverrides,
    ...modalOverrides,
    ...monthPickerOverrides,
    ...multiSelectOverrides,
    ...nativeSelectOverrides,
    ...navLinkOverrides,
    ...notificationOverrides,
    ...numberInputOverrides,
    ...radioOverrides,
    ...overlayOverrides,
    ...paperOverrides,
    ...passwordInputOverrides,
    ...pillOverrides,
    ...pillsInputOverrides,
    ...popoverOverrides,
    ...portalOverrides,
    ...progressOverrides,
    ...ringProgressOverrides,
    ...scrollAreaOverrides,
    ...segmentedControlOverrides,
    ...simpleGridOverrides,
    ...skeletonOverrides,
    ...stackOverrides,
    ...selectOverrides,
    ...sliderOverrides,
    ...switchOverrides,
    ...tabsOverrides,
    ...textareaOverrides,
    ...textInputOverrides,
    ...textOverrides,
    ...timeInputOverrides,
    ...timelineOverrides,
    ...titleOverrides,
    ...tooltipOverrides,
    ...hoverCardOverrides,
    ...listOverrides,
  },
});
