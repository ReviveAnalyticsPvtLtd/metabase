import { useMemo } from "react";
import { t } from "ttag";

import { Sidebar } from "metabase/common/components/Sidebar";
import { DashboardChartSettings } from "metabase/dashboard/components/DashboardChartSettings";
import { DASHBOARD_SLOW_TIMEOUT } from "metabase/dashboard/constants";
import { useDashboardContext } from "metabase/dashboard/context";
import { getDashCardById, getDashcardData } from "metabase/dashboard/selectors";
import { useNavigationExperience } from "metabase/nav/containers/PbiRail";
import { useSelector } from "metabase/redux";
import { Text } from "metabase/ui";
import { isQuestionDashCard } from "metabase/utils/dashboard";
import { extendCardWithDashcardSettings } from "metabase/viz-core";
import type { DashCardSeries, Series } from "metabase-types/api";

/**
 * Power BI-style "Format visual" pane (part of the `pbi` navigation
 * experience). Hosts the existing `DashboardChartSettings` controls in the
 * dashboard's right pane stack instead of a full-screen modal, with changes
 * applied live to the card on the canvas.
 *
 * The series is resolved the same way `DashCard` resolves it (extended card +
 * per-card dataset rows), so the pane renders exactly the card that was
 * clicked — computed here rather than persisted in redux sidebar props.
 */
export function PbiFormatPane() {
  const navigationExperience = useNavigationExperience();
  const {
    dashboard,
    sidebar,
    slowCards,
    closeSidebar,
    onReplaceAllDashCardVisualizationSettings,
    onUpdateDashCardVisualizationSettings,
  } = useDashboardContext();

  const dashcardId = sidebar.props.dashcardId;
  const dashcardFromState = useSelector((state) =>
    dashcardId != null ? getDashCardById(state, dashcardId) : undefined,
  );
  const dashcardData = useSelector((state) =>
    dashcardId != null ? getDashcardData(state, dashcardId) : undefined,
  );

  const dashcard = useMemo(
    () =>
      dashboard?.dashcards.find((dashcard) => dashcard.id === dashcardId) ??
      dashcardFromState,
    [dashboard, dashcardId, dashcardFromState],
  );

  const series: DashCardSeries | undefined = useMemo(() => {
    if (!dashcard) {
      return undefined;
    }

    const mainCard = extendCardWithDashcardSettings(
      dashcard.card,
      dashcard.visualization_settings,
    );
    const cards =
      isQuestionDashCard(dashcard) && Array.isArray(dashcard.series)
        ? [mainCard, ...dashcard.series]
        : [mainCard];

    return cards.map((card) => {
      const isSlow = card.id ? slowCards[card.id] : false;
      const isUsuallyFast =
        card.query_average_duration != null &&
        card.query_average_duration < DASHBOARD_SLOW_TIMEOUT;

      if (!card.id) {
        return { card, isSlow, isUsuallyFast };
      }

      return {
        ...dashcardData?.[card.id],
        card,
        isSlow,
        isUsuallyFast,
      };
    });
  }, [dashcard, dashcardData, slowCards]);

  if (navigationExperience !== "pbi" || !series || !dashcard) {
    return null;
  }

  return (
    <Sidebar
      onClose={closeSidebar}
      data-testid="pbi-format-pane"
      aria-label={t`Format visual`}
    >
      <Text px="lg" pt="md" fw="bold" component="h2">
        {t`Format`}
      </Text>
      <DashboardChartSettings
        layout="pane"
        // TODO: all of the settings code assumes a Series with a non-optional
        // `data` property, but virtual dashcards don't have data (same cast as
        // the classic modal in ChartSettingsButton).
        series={series as unknown as Series}
        dashcard={dashcard}
        onChange={(settings) =>
          onReplaceAllDashCardVisualizationSettings(dashcard.id, settings)
        }
        onChangeLive={(settings) =>
          onUpdateDashCardVisualizationSettings(dashcard.id, settings)
        }
        onClose={closeSidebar}
      />
    </Sidebar>
  );
}
