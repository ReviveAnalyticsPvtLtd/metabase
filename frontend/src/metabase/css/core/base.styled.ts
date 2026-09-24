// eslint-disable-next-line no-restricted-imports
import { css } from "@emotion/react";

export const rootStyle = css`
  font-family: var(--mb-default-font-family);
  font-weight: 400;
  font-style: normal;
  color: var(--mb-color-text-primary);
  margin: 0;
  height: 100%; /* ensure the entire page will fill the window */
  display: flex;
  flex-direction: column;
  background-color: var(--mb-color-background_page-secondary);

  /* Vercel Geist Signature Ambient Cone & Precision Grid */
  background-image:
    /* Top ambient cone spotlight (Vercel signature) */
    radial-gradient(
      ellipse 80% 50% at 50% -20%,
      color-mix(in srgb, var(--mb-color-core-brand) 12%, transparent),
      transparent 70%
    ),
    /* Secondary subtle blue horizon beam */
    radial-gradient(
      1000px 500px at 80% -10%,
      rgba(0, 112, 243, 0.06),
      transparent 60%
    ),
    /* Vercel 24px precision dot matrix */
    radial-gradient(
      circle at 1px 1px,
      color-mix(in srgb, var(--mb-color-text-primary) 3.5%, transparent) 1px,
      transparent 0
    );
  background-size: 100% 100%, 100% 100%, 24px 24px;
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
`;

export const baseStyle = css`
  html {
    height: 100%; /* ensure the entire page will fill the window */
    width: 100%;
  }

  @media print and (orientation: portrait) {
    html {
      width: 8.5in;
    }
  }

  @media print and (orientation: landscape) {
    html {
      width: 11in;
    }
  }

  ul,
  ol {
    padding: 0;
    margin: 0;
    list-style-type: none;
  }

  @supports (-webkit-touch-callout: none) {
    textarea:disabled,
    input:disabled {
      opacity: 1;
    }
  }
`;
