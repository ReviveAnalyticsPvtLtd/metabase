import { useEffect, useId, useRef, useState } from "react";
import { t } from "ttag";

import { setEditingDashboard } from "metabase/dashboard/actions/core";
import {
  openAddQuestionSidebar,
  toggleSidebar,
} from "metabase/dashboard/actions/ui";
import { useDashboardContext } from "metabase/dashboard/context";
import { useNavigationExperience } from "metabase/nav/containers/PbiRail";
import { useDispatch } from "metabase/redux";
import { Box, Button, Group, Icon } from "metabase/ui";
import { PERFORMANCE_MARKS, markOnce } from "metabase/utils/performance-marks";
import type { Dashboard, IconName } from "metabase-types/api";

/**
 * Power BI-style report ribbon (part of the `pbi` navigation experience).
 *
 * Renders a tabbed command bar (Home / Insert / View) above the dashboard
 * header. Every command dispatches the same dashboard actions the classic
 * header uses, so both navigation experiences share one behavior. The
 * component returns null for the classic experience, guest embeds, and
 * fullscreen mode — it is safe to mount unconditionally.
 */

type RibbonTabId = "home" | "insert" | "view";

const RIBBON_TABS: Array<{ id: RibbonTabId; get label(): string }> = [
  {
    id: "home",
    get label() {
      return t`Home`;
    },
  },
  {
    id: "insert",
    get label() {
      return t`Insert`;
    },
  },
  {
    id: "view",
    get label() {
      return t`View`;
    },
  },
];

export function PbiReportRibbon({
  dashboard,
  onCancelEditing,
}: {
  dashboard: Dashboard;
  onCancelEditing: () => void;
}) {
  const { isGuestEmbed, isFullscreen, onFullscreenChange, selectedTabId } =
    useDashboardContext();
  const navigationExperience = useNavigationExperience();
  const [activeTab, setActiveTab] = useState<RibbonTabId>("home");
  const idPrefix = useId();
  const tabRefs = useRef<Record<RibbonTabId, HTMLButtonElement | null>>({
    home: null,
    insert: null,
    view: null,
  });

  useEffect(() => {
    if (navigationExperience === "pbi" && !isGuestEmbed && !isFullscreen) {
      markOnce(PERFORMANCE_MARKS.reportRibbonMounted);
    }
  }, [isFullscreen, isGuestEmbed, navigationExperience]);

  if (navigationExperience !== "pbi" || isGuestEmbed || isFullscreen) {
    return null;
  }

  return (
    <Box
      data-testid="pbi-report-ribbon"
      bg="background_page-tertiary"
      px="md"
      py="xs"
    >
      <Group gap="sm" align="center" wrap="wrap">
        <Group gap="xs" role="tablist" aria-label={t`Report ribbon sections`}>
          {RIBBON_TABS.map(({ id, label }) => (
            <Button
              key={id}
              role="tab"
              id={`${idPrefix}-${id}`}
              aria-controls={`${idPrefix}-commands`}
              aria-selected={activeTab === id}
              tabIndex={activeTab === id ? 0 : -1}
              ref={(element) => {
                tabRefs.current[id] = element;
              }}
              size="compact-sm"
              variant={activeTab === id ? "filled" : "transparent"}
              onClick={() => setActiveTab(id)}
              onKeyDown={(event) => {
                if (
                  event.key !== "ArrowRight" &&
                  event.key !== "ArrowLeft" &&
                  event.key !== "Home" &&
                  event.key !== "End"
                ) {
                  return;
                }
                event.preventDefault();
                const currentIndex = RIBBON_TABS.findIndex(
                  (tab) => tab.id === id,
                );
                const direction = event.key === "ArrowRight" ? 1 : -1;
                const nextTab =
                  event.key === "Home"
                    ? "home"
                    : event.key === "End"
                      ? "view"
                      : RIBBON_TABS[
                          (currentIndex + direction + RIBBON_TABS.length) %
                            RIBBON_TABS.length
                        ].id;
                setActiveTab(nextTab);
                tabRefs.current[nextTab]?.focus();
              }}
              data-testid={`${id}-ribbon-tab`}
            >
              {label}
            </Button>
          ))}
        </Group>

        <Box
          role="tabpanel"
          id={`${idPrefix}-commands`}
          aria-labelledby={`${idPrefix}-${activeTab}`}
        >
          <RibbonCommands
            tab={activeTab}
            dashboard={dashboard}
            selectedTabId={selectedTabId}
            onFullscreenChange={onFullscreenChange}
            onCancelEditing={onCancelEditing}
          />
        </Box>
      </Group>
    </Box>
  );
}

function RibbonCommands({
  tab,
  dashboard,
  selectedTabId,
  onFullscreenChange,
  onCancelEditing,
}: {
  tab: RibbonTabId;
  dashboard: Dashboard;
  selectedTabId: number | null;
  onFullscreenChange: (
    value: boolean,
    openInBrowserFullscreen?: boolean,
  ) => void;
  onCancelEditing: () => void;
}) {
  const dispatch = useDispatch();
  const {
    isEditing,
    addMarkdownDashCardToDashboard,
    addHeadingDashCardToDashboard,
    addLinkDashCardToDashboard,
  } = useDashboardContext();
  const enterFullscreen = () => onFullscreenChange(true);

  if (tab === "home") {
    return (
      <Group gap="xs">
        {dashboard.can_write && !isEditing && (
          <RibbonCommand
            icon="pencil"
            label={t`Edit report`}
            testId="ribbon-edit"
            onClick={() => dispatch(setEditingDashboard(dashboard))}
          />
        )}
        {isEditing && (
          <RibbonCommand
            icon="close"
            label={t`Cancel editing`}
            testId="ribbon-cancel-editing"
            onClick={onCancelEditing}
          />
        )}
        <RibbonCommand
          icon="filter"
          label={t`Filters`}
          testId="ribbon-filters"
          onClick={() => dispatch(toggleSidebar("filters"))}
        />
        <RibbonCommand
          icon="share"
          label={t`Share`}
          testId="ribbon-share"
          onClick={() => dispatch(toggleSidebar("sharing"))}
        />
        <RibbonCommand
          icon="expand"
          label={t`Fullscreen`}
          testId="ribbon-fullscreen"
          onClick={enterFullscreen}
        />
      </Group>
    );
  }

  if (tab === "insert") {
    if (!dashboard.can_write) {
      return null;
    }
    // Insert commands work in Editing view (as in Power BI): entering edit
    // mode first is idempotent and safe.
    const startEditing = () => {
      if (!isEditing) {
        dispatch(setEditingDashboard(dashboard));
      }
    };
    const addDashCard = (
      add: (opts: { dashId: Dashboard["id"]; tabId: number | null }) => void,
    ) => {
      startEditing();
      add({ dashId: dashboard.id, tabId: selectedTabId });
    };

    return (
      <Group gap="xs">
        <RibbonCommand
          icon="dashboard"
          label={t`Add report item`}
          testId="ribbon-add-report-item"
          onClick={() => {
            startEditing();
            dispatch(openAddQuestionSidebar());
          }}
        />
        <RibbonCommand
          icon="text_bold"
          label={t`Text`}
          testId="ribbon-add-text"
          onClick={() => addDashCard(addMarkdownDashCardToDashboard)}
        />
        <RibbonCommand
          icon="string"
          label={t`Heading`}
          testId="ribbon-add-heading"
          onClick={() => addDashCard(addHeadingDashCardToDashboard)}
        />
        <RibbonCommand
          icon="link"
          label={t`Link`}
          testId="ribbon-add-link"
          onClick={() => addDashCard(addLinkDashCardToDashboard)}
        />
      </Group>
    );
  }

  return (
    <Group gap="xs">
      <RibbonCommand
        icon="expand"
        label={t`Enter fullscreen`}
        testId="ribbon-enter-fullscreen"
        onClick={enterFullscreen}
      />
    </Group>
  );
}

function RibbonCommand({
  icon,
  label,
  testId,
  onClick,
}: {
  icon: IconName;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <Button
      size="compact-sm"
      variant="default"
      leftSection={<Icon name={icon} size={14} />}
      onClick={onClick}
      data-testid={testId}
      aria-label={label}
    >
      {label}
    </Button>
  );
}
