import { useCallback, useMemo, useState } from "react";
import _ from "underscore";

import { useDashboardContext } from "metabase/dashboard/context";
import { Divider, Flex } from "metabase/ui";
import { BaseChartSettings } from "metabase/visualizations/components/ChartSettings/BaseChartSettings";
import { ChartSettingsVisualization } from "metabase/visualizations/components/ChartSettings/ChartSettingsVisualization";
import {
  useChartSettingsState,
  useSettingsWidgets,
} from "metabase/visualizations/components/ChartSettings/hooks";
import {
  getClickBehaviorSettings,
  getVisualizationRaw,
  sanitizeDashcardSettings,
} from "metabase/viz-core";
import type { VisualizationSettings } from "metabase-types/api";

import type { DashboardChartSettingsProps } from "./types";

export const DashboardChartSettings = ({
  dashcard,
  onChange,
  series,
  onClose,
  settings,
  layout = "modal",
  onChangeLive,
}: DashboardChartSettingsProps) => {
  const { dashboard } = useDashboardContext();
  const withPreview = layout === "modal";

  const [tempSettings, setTempSettings] = useState<
    VisualizationSettings | undefined
  >(settings);

  const {
    chartSettings,
    handleChangeSettings,
    chartSettingsRawSeries,
    transformedSeries,
  } = useChartSettingsState({
    series,
    settings: tempSettings,
    onChange: setTempSettings,
  });

  const handleDone = useCallback(() => {
    const allSettings = chartSettings ?? tempSettings ?? {};

    // Filter out settings with dashboard: false to avoid persisting
    // settings that are hidden from dashboard UI
    const visualization = getVisualizationRaw(series);
    const vizSettingsDefs = visualization?.settings ?? {};
    const settingsToSave = sanitizeDashcardSettings(
      allSettings,
      vizSettingsDefs,
    );

    onChange?.(settingsToSave);
    onClose?.();
  }, [chartSettings, onChange, onClose, tempSettings, series]);

  const handleResetSettings = useCallback(() => {
    const originalCardSettings = dashcard?.card.visualization_settings;
    const clickBehaviorSettings = getClickBehaviorSettings(chartSettings);

    onChange?.({
      ...originalCardSettings,
      ...clickBehaviorSettings,
    });
  }, [chartSettings, dashcard?.card.visualization_settings, onChange]);

  const onResetToDefault =
    // resetting virtual cards wipes the text and broke the UI (metabase#14644)
    !_.isEqual(chartSettings, {}) && (chartSettings || {}).virtual_card == null
      ? handleResetSettings
      : null;

  const extra = useMemo(
    () => ({ dashboardId: dashboard?.id }),
    [dashboard?.id],
  );

  const handleChangeSettingsWithLive = useCallback(
    (next: VisualizationSettings) => {
      handleChangeSettings(next);
      if (!withPreview) {
        // Pane layout: the dashboard card on the canvas is the live preview.
        onChangeLive?.(next);
      }
    },
    [handleChangeSettings, withPreview, onChangeLive],
  );

  const widgets = useSettingsWidgets({
    series,
    transformedSeries,
    handleChangeSettings: handleChangeSettingsWithLive,
    isDashboard: true,
    extra,
  });

  return (
    <Flex justify="unset" align="unset" wrap="nowrap" h="100%">
      <BaseChartSettings
        flex={withPreview ? "0 0 400px" : "1 1 0%"}
        series={series}
        onChange={setTempSettings}
        chartSettings={chartSettings}
        widgets={widgets}
        transformedSeries={transformedSeries}
      />
      {withPreview && (
        <>
          <Divider orientation="vertical"></Divider>
          {dashboard && (
            <ChartSettingsVisualization
              flex="2 0 0"
              rawSeries={chartSettingsRawSeries}
              dashboard={dashboard}
              dashcard={dashcard}
              onUpdateVisualizationSettings={handleChangeSettingsWithLive}
              onDone={handleDone}
              onCancel={() => onClose?.()}
              onReset={onResetToDefault}
            />
          )}
        </>
      )}
    </Flex>
  );
};
