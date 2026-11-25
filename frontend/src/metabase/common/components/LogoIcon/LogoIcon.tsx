import logoUrl from "assets/img/logo.svg";
import { PLUGIN_LOGO_ICON_COMPONENTS } from "metabase/plugins";

interface LogoIconProps {
  width?: number;
  height?: number;
  dark?: boolean;
  fill?: string;
}

export const DefaultLogoIcon = ({
  height = 32,
  width,
}: LogoIconProps) => {
  return (
    <img
      className="Icon"
      src={logoUrl}
      width={width}
      height={height}
      style={{ objectFit: "contain" }}
      alt="NubrixAI"
      data-testid="main-logo"
    />
  );
};

export function LogoIcon(props: LogoIconProps) {
  const [Component = DefaultLogoIcon] = PLUGIN_LOGO_ICON_COMPONENTS;
  return <Component {...props} />;
}
