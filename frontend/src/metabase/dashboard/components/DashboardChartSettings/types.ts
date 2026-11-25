import type { CommonChartSettingsProps } from "metabase/visualizations/components/ChartSettings/types";
import type {
  Dashboard,
  DashboardCard,
  VisualizationSettings,
} from "metabase-types/api";

export type DashboardChartSettingsProps = {
  className?: string;
  dashboard?: Dashboard;
  dashcard?: DashboardCard;
  isDashboard?: boolean;
  onClose?: () => void;
  /**
   * Pane layout (Power BI-style format pane): controls fill the pane and the
   * wide live-preview column is omitted — the canvas itself is the preview.
   * Defaults to the classic modal layout.
   */
  layout?: "modal" | "pane";
  /**
   * Only in pane layout: called on every settings change so the host can apply
   * the change to the dashboard card immediately (live preview on canvas).
   */
  onChangeLive?: (settings: VisualizationSettings) => void;
} & CommonChartSettingsProps;
