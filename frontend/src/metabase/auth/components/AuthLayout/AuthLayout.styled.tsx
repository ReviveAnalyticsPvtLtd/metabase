// eslint-disable-next-line no-restricted-imports
import styled from "@emotion/styled";

import { breakpointMinSmall } from "metabase/styled-components/theme";

export const LayoutRoot = styled.div`
  position: relative;
  min-height: 100vh;
  background-color: var(--mb-color-background_page-secondary);
  background-image:
    radial-gradient(
      1200px 650px at 50% -80px,
      color-mix(in srgb, var(--mb-color-core-brand) 18%, transparent),
      transparent 70%
    ),
    radial-gradient(
      800px 500px at 90% 100%,
      rgba(99, 102, 241, 0.1),
      transparent 60%
    ),
    radial-gradient(
      circle at 1px 1px,
      color-mix(in srgb, var(--mb-color-text-primary) 4%, transparent) 1px,
      transparent 0
    );
  background-size: 100% 100%, 100% 100%, 28px 28px;
`;

export const LayoutBody = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  position: relative;
  padding: 1.5rem 1rem 3rem;
  min-height: 100vh;
`;

export const LayoutCard = styled.div`
  width: 100%;
  margin-top: 1.5rem;
  padding: 2.5rem 1.5rem;
  background-color: color-mix(
    in srgb,
    var(--mb-color-background_page-primary) 88%,
    transparent
  );
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--mb-color-border-subtle, rgba(255, 255, 255, 0.1));
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.1),
    0 20px 48px -8px rgba(0, 0, 0, 0.35);
  border-radius: 18px;

  ${breakpointMinSmall} {
    width: 30.875rem;
    padding: 2.5rem 3.5rem;
  }
`;

export const LayoutIllustration = styled.div<{
  backgroundImageSrc: string;
}>`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-image: ${({ backgroundImageSrc }) =>
    `url("${backgroundImageSrc}")`};
  background-size: 100% auto;
  background-repeat: no-repeat;
  background-position: right bottom;
`;
