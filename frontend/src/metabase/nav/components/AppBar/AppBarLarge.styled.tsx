// eslint-disable-next-line no-restricted-imports
import styled from "@emotion/styled";

import { APP_BAR_HEIGHT } from "metabase/nav/constants";

interface AppBarRootProps {
  hasSidebarOpen?: boolean;
}

export const AppBarRoot = styled.div<AppBarRootProps>`
  display: flex;
  align-items: center;
  gap: 1rem;
  height: ${APP_BAR_HEIGHT};
  padding-left: 1.325rem;
  padding-right: 1rem;
  position: relative;
  border-bottom: 1px solid
    ${(props) =>
      props.hasSidebarOpen
        ? "var(--mb-color-border-neutral)"
        : "var(--mb-color-border-subtle)"};
  background-color: color-mix(
    in srgb,
    var(--mb-color-background_page-primary) 82%,
    transparent
  );
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.08);
  transition: border-bottom-color 200ms ease;

  /* Executive laser horizon gradient fade along bottom edge */
  &::after {
    content: "";
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, var(--mb-color-core-brand) 30%, transparent) 25%,
      color-mix(in srgb, var(--mb-color-core-brand) 65%, transparent) 50%,
      color-mix(in srgb, var(--mb-color-core-brand) 30%, transparent) 75%,
      transparent 100%
    );
    opacity: 0.65;
    pointer-events: none;
  }
`;

interface AppBarInfoContainerProps {
  isVisible?: boolean;
}

export const AppBarInfoContainer = styled.div<AppBarInfoContainerProps>`
  display: flex;
  min-width: 0;
  opacity: ${(props) => (props.isVisible ? 1 : 0)};
  visibility: ${(props) => (props.isVisible ? "visible" : "hidden")};
  transition: ${(props) =>
    props.isVisible ? `opacity 0.5s` : `opacity 0.5s, visibility 0s`};
`;
