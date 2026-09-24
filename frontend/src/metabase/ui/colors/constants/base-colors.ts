/* eslint-disable metabase/no-color-literals */
// NOTE: DO NOT ADD COLORS WITHOUT EXTREMELY GOOD REASON AND DESIGN REVIEW

/**
 * Base color palette for NubrixAI (Vercel Geist System).
 * Pure monochrome depth with Vercel Blue (#0070F3) and high contrast.
 */
const baseColors = {
  white: "hsla(0, 0%, 100%, 1.00)",
  black: "hsla(0, 0%, 0%, 1.00)",
  gold: "hsla(50.6, 100%, 50%, 1)",
  upsellGem: "hsla(190, 100%, 50%, 1)",

  // Brand colors (dynamic based on --mb-color-core-brand).
  brand: {
    100: "color-mix(in srgb, var(--mb-color-core-brand), black 86%)",
    90: "color-mix(in srgb, var(--mb-color-core-brand), black 75%)",
    80: "color-mix(in srgb, var(--mb-color-core-brand), black 62%)",
    70: "color-mix(in srgb, var(--mb-color-core-brand), black 47%)",
    60: "color-mix(in srgb, var(--mb-color-core-brand), black 28%)",
    50: "color-mix(in srgb, var(--mb-color-core-brand), black 12%)",
    40: "var(--mb-color-core-brand)", // Base brand color (#0070F3)
    30: "color-mix(in srgb, var(--mb-color-core-brand), white 35%)",
    20: "color-mix(in srgb, var(--mb-color-core-brand), white 70%)",
    10: "color-mix(in srgb, var(--mb-color-core-brand), white 91%)",
    5: "color-mix(in srgb, var(--mb-color-core-brand), white 96%)",
  },

  filter: {
    100: "color-mix(in srgb, var(--mb-color-core-filter), black 86%)",
    90: "color-mix(in srgb, var(--mb-color-core-filter), black 75%)",
    80: "color-mix(in srgb, var(--mb-color-core-filter), black 62%)",
    70: "color-mix(in srgb, var(--mb-color-core-filter), black 47%)",
    60: "color-mix(in srgb, var(--mb-color-core-filter), black 28%)",
    50: "color-mix(in srgb, var(--mb-color-core-filter), black 12%)",
    40: "var(--mb-color-core-filter)",
    30: "color-mix(in srgb, var(--mb-color-core-filter), white 35%)",
    20: "color-mix(in srgb, var(--mb-color-core-filter), white 70%)",
    10: "color-mix(in srgb, var(--mb-color-core-filter), white 91%)",
    5: "color-mix(in srgb, var(--mb-color-core-filter), white 96%)",
  },

  // Vercel Blue & Cyan accents
  vercel: {
    blue: "#0070F3",
    cyan: "#00DFD8",
  },

  // Nubrix scale tuned to Vercel high-contrast cyan/blue
  nubrix: {
    100: "hsla(212, 100%, 8%, 1)",
    90: "hsla(212, 95%, 15%, 1)",
    80: "hsla(212, 95%, 24%, 1)",
    70: "hsla(212, 95%, 33%, 1)",
    60: "hsla(212, 96%, 42%, 1)",
    50: "hsla(212, 100%, 48%, 1)", // Vercel Blue #0070F3
    40: "hsla(212, 100%, 55%, 1)",
    30: "hsla(212, 100%, 65%, 1)",
    20: "hsla(212, 100%, 80%, 1)",
    10: "hsla(212, 100%, 92%, 1)",
    5: "hsla(212, 100%, 97%, 1)",
  },

  // Deprecated Blue
  blue: {
    100: "hsla(208, 100%, 8%, 1.00)",
    90: "hsla(208, 100%, 14%, 1.00)",
    80: "hsla(208, 100%, 20%, 1.00)",
    70: "hsla(208, 100%, 28%, 1.00)",
    60: "hsla(208, 100%, 36%, 1.00)",
    50: "hsla(208, 100%, 46%, 1.00)",
    40: "hsla(208, 77%, 60%, 1.00)",
    30: "hsla(208, 87%, 72%, 1.00)",
    20: "hsla(208, 86%, 86%, 1.00)",
    10: "hsla(208, 87%, 94%, 1.00)",
    5: "hsla(208, 75%, 98%, 1)",
  },

  // Vercel Geist Monochrome Scale (pure neutral blacks and grays)
  orion: {
    110: "hsla(0, 0%, 0%, 1)",      // #000000 Pure Black (Vercel Dark BG)
    100: "hsla(0, 0%, 4%, 1)",      // #0A0A0A (Vercel Dark BG 200)
    95: "hsla(0, 0%, 7%, 1)",       // #111111 (Vercel Dark Card/Surface)
    90: "hsla(0, 0%, 9%, 1)",       // #171717 (Vercel Dark Hover)
    80: "hsla(0, 0%, 15%, 1)",      // #262626 (Vercel Dark Border)
    70: "hsla(0, 0%, 20%, 1)",      // #333333 (Vercel Dark Border Strong)
    60: "hsla(0, 0%, 28%, 1)",      // #474747
    50: "hsla(0, 0%, 40%, 1)",      // #666666 (Vercel Light Text Secondary)
    40: "hsla(0, 0%, 53%, 1)",      // #888888 (Vercel Secondary Text)
    30: "hsla(0, 0%, 65%, 1)",      // #A6A6A6
    20: "hsla(0, 0%, 84%, 1)",      // #D6D6D6
    10: "hsla(0, 0%, 92%, 1)",      // #EAEAEA (Vercel Light Border)
    5: "hsla(0, 0%, 98%, 1)",       // #FAFAFA (Vercel Light BG 200)
  },

  orionAlpha: {
    100: "hsla(0, 0%, 0%, 1)",
    90: "hsla(0, 0%, 0%, 0.93)",
    80: "hsla(0, 0%, 0%, 0.84)",
    70: "hsla(0, 0%, 0%, 0.74)",
    60: "hsla(0, 0%, 0%, 0.62)",
    50: "hsla(0, 0%, 0%, 0.51)",
    40: "hsla(0, 0%, 0%, 0.44)",
    30: "hsla(0, 0%, 0%, 0.29)",
    20: "hsla(0, 0%, 0%, 0.17)",
    10: "hsla(0, 0%, 0%, 0.06)",
    5: "hsla(0, 0%, 0%, 0.02)",
  },

  oceanAlpha: {
    50: "hsla(212, 100%, 48%, 0.82)",
    40: "hsla(212, 100%, 48%, 0.69)",
    30: "hsla(212, 100%, 48%, 0.45)",
    20: "hsla(212, 100%, 48%, 0.21)",
    10: "hsla(212, 100%, 48%, 0.07)",
    5: "hsla(212, 100%, 48%, 0.03)",
  },

  orionAlphaInverse: {
    100: "hsla(0, 0%, 100%, 1.00)",
    90: "hsla(0, 0%, 100%, 0.95)",
    80: "hsla(0, 0%, 100%, 0.85)",
    70: "hsla(0, 0%, 100%, 0.75)",
    60: "hsla(0, 0%, 100%, 0.60)",
    50: "hsla(0, 0%, 100%, 0.45)",
    40: "hsla(0, 0%, 100%, 0.35)",
    30: "hsla(0, 0%, 100%, 0.25)",
    20: "hsla(0, 0%, 100%, 0.15)",
    10: "hsla(0, 0%, 100%, 0.08)",
    5: "hsla(0, 0%, 100%, 0.04)",
  },

  gray: {
    100: "hsla(206, 16%, 8%, 1.00)",
    90: "hsla(202, 15%, 15%, 1.00)",
    80: "hsla(205, 15%, 23%, 1.00)",
    70: "hsla(206, 14%, 32%, 1.00)",
    60: "hsla(207, 9%, 44%, 1.00)",
    50: "hsla(208, 7%, 54%, 1.00)",
    40: "hsla(208, 7%, 60%, 1.00)",
    30: "hsla(208, 11%, 74%, 1.00)",
    20: "hsla(210, 13%, 88%, 1.00)",
    10: "hsla(210, 20%, 96%, 1.00)",
    5: "hsla(210, 25%, 98%, 1.00)",
  },

  lobster: {
    100: "hsla(0, 81%, 11%, 1)",
    90: "hsla(1, 75%, 17%, 1)",
    80: "hsla(1, 71%, 26%, 1)",
    70: "hsla(1, 69%, 37%, 1)",
    60: "hsla(1, 67%, 49%, 1)",
    50: "hsla(358, 71%, 62%, 1)",
    40: "hsla(1, 84%, 69%, 1)",
    30: "hsla(1, 85%, 81%, 1)",
    20: "hsla(2, 67%, 90%, 1)",
    10: "hsla(0, 76%, 97%, 1)",
    5: "hsla(0, 56%, 98%, 1)",
  },

  flamingo: {
    100: "hsla(334, 75%, 10%, 1)",
    90: "hsla(334, 79%, 17%, 1)",
    80: "hsla(334, 72%, 26%, 1)",
    70: "hsla(334, 71%, 36%, 1)",
    60: "hsla(334, 69%, 48%, 1)",
    50: "hsla(334, 67%, 60%, 1)",
    40: "hsla(334, 80%, 68%, 1)",
    30: "hsla(334, 79%, 80%, 1)",
    20: "hsla(335, 79%, 91%, 1)",
    10: "hsla(335, 67%, 96%, 1)",
    5: "hsla(330, 67%, 99%, 1)",
  },

  mango: {
    100: "hsla(26, 89%, 7%, 1)",
    90: "hsla(26, 79%, 13%, 1)",
    80: "hsla(25, 73%, 20%, 1)",
    70: "hsla(26, 70%, 29%, 1)",
    60: "hsla(26, 69%, 39%, 1)",
    50: "hsla(26, 68%, 48%, 1)",
    40: "hsla(26, 79%, 54%, 1)",
    30: "hsla(26, 84%, 70%, 1)",
    20: "hsla(26, 88%, 87%, 1)",
    10: "hsla(25, 100%, 95%, 1)",
    5: "hsla(30, 100%, 98%, 1)",
  },

  palm: {
    100: "hsla(158, 86%, 10%, 1)",
    90: "hsla(158, 82%, 16%, 1)",
    80: "hsla(159, 78%, 23%, 1)",
    70: "hsla(158, 76%, 33%, 1)",
    60: "hsla(158, 74%, 43%, 1)",
    50: "hsla(158, 73%, 53%, 1)",
    40: "hsla(159, 81%, 64%, 1)",
    30: "hsla(158, 82%, 78%, 1)",
    20: "hsla(160, 68%, 88%, 1)",
    10: "hsla(160, 78%, 95%, 1)",
    5: "hsla(160, 55%, 98%, 1)",
  },

  seafoam: {
    100: "hsla(180, 84%, 5%, 1)",
    90: "hsla(180, 34%, 12%, 1)",
    80: "hsla(180, 80%, 14%, 1)",
    70: "hsla(180, 70%, 21%, 1)",
    60: "hsla(180, 44%, 33%, 1)",
    50: "hsla(180, 74%, 34%, 1)",
    40: "hsla(180, 42%, 46%, 1)",
    30: "hsla(180, 47%, 60%, 1)",
    20: "hsla(180, 55%, 81%, 1)",
    10: "hsla(180, 68%, 93%, 1)",
    5: "hsla(180, 69%, 97%, 1)",
  },

  dubloon: {
    100: "hsla(38, 87%, 11%, 1)",
    90: "hsla(38, 86%, 18%, 1)",
    80: "hsla(38, 83%, 26%, 1)",
    70: "hsla(37, 81%, 37%, 1)",
    60: "hsla(37, 79%, 48%, 1)",
    50: "hsla(37, 88%, 59%, 1)",
    40: "hsla(37, 92%, 69%, 1)",
    30: "hsla(37, 92%, 81%, 1)",
    20: "hsla(37, 83%, 90%, 1)",
    10: "hsla(37, 88%, 96%, 1)",
    5: "hsla(40, 67%, 98%, 1)",
  },

  ocean: {
    100: "hsla(208, 97%, 11%, 1)",
    90: "hsla(208, 97%, 17%, 1)",
    80: "hsla(208, 97%, 26%, 1)",
    70: "hsla(208, 97%, 36%, 1)",
    60: "hsla(208, 97%, 46%, 1)",
    50: "hsla(208, 95%, 57%, 1)",
    40: "hsla(208, 96%, 68%, 1)",
    30: "hsla(208, 96%, 80%, 1)",
    20: "hsla(208, 88%, 90%, 1)",
    10: "hsla(208, 92%, 96%, 1)",
    5: "hsla(208, 75%, 98%, 1)",
  },

  octopus: {
    100: "hsla(268, 71%, 14%, 1)",
    90: "hsla(268, 68%, 23%, 1)",
    80: "hsla(268, 66%, 34%, 1)",
    70: "hsla(268, 63%, 47%, 1)",
    60: "hsla(268, 76%, 60%, 1)",
    50: "hsla(268, 90%, 72%, 1)",
    40: "hsla(268, 91%, 79%, 1)",
    30: "hsla(268, 91%, 87%, 1)",
    20: "hsla(268, 78%, 93%, 1)",
    10: "hsla(268, 86%, 97%, 1)",
    5: "hsla(264, 60%, 98%, 1)",
  },
};

export const getBaseColorsForThemeDefinitionOnly = () => {
  return baseColors;
};
