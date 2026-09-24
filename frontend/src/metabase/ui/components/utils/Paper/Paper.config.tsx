import { type MantineThemeOverride, Paper } from "@mantine/core";

import PaperStyles from "./Paper.module.css";

export const paperOverrides: MantineThemeOverride["components"] = {
  Paper: Paper.extend({
    defaultProps: {
      radius: "xs",
      shadow: "xs_outline",
    },
    classNames: {
      root: PaperStyles.root,
    },
  }),
};
