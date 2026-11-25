import {
  createMockDashboardState,
  createMockState,
  createMockStoreDashboard,
} from "__support__/state";
import { act, renderHookWithProviders, waitFor } from "__support__/ui";
import { getReportCrossFilters } from "metabase/dashboard/click-behavior/report-cross-filter";
import { dashboardReducers } from "metabase/dashboard/reducers";
import type { ClickObject } from "metabase/visualizations/types";
import { PULSE_PARAM_EMPTY } from "metabase-lib/v1/parameters/utils/parameter-values";
import {
  createMockCard,
  createMockColumn,
  createMockDashboard,
  createMockDashboardCard,
  createMockParameter,
} from "metabase-types/api/mocks";

import { useClickBehaviorData } from "./use-click-behavior-data";

const TARGET_DASHBOARD = createMockDashboard({ id: 2, name: "Target" });
const TARGET_CARD = createMockCard({ id: 3, name: "Target question" });

const DASHCARD_ID = 1;

function setup({ clicked }: { clicked: ClickObject }) {
  const state = createMockState({
    dashboard: createMockDashboardState({
      dashboardId: 1,
      dashcards: {
        [DASHCARD_ID]: createMockDashboardCard({ id: DASHCARD_ID }),
      },
      linkTargets: {
        questions: { [TARGET_CARD.id]: TARGET_CARD },
        dashboards: { [TARGET_DASHBOARD.id]: TARGET_DASHBOARD },
      },
    }),
  });

  const { result } = renderHookWithProviders(
    () => useClickBehaviorData({ dashcardId: DASHCARD_ID }),
    { storeInitialState: state },
  );

  return result.current.getExtraDataForClick(clicked);
}

function clickWithLinkTo(
  linkType: "dashboard" | "question",
  targetId: number,
): ClickObject {
  // A ClickObject carries column and row data the link behaviour never reads,
  // so the settings alone are enough to exercise the target lookup.
  return {
    settings: {
      click_behavior: { type: "link", linkType, targetId },
    },
  } as ClickObject;
}

describe("useClickBehaviorData", () => {
  it("applies and clears a report cross-filter through the dashboard store", async () => {
    const column = createMockColumn({ name: "CATEGORY" });
    const parameter = createMockParameter({ id: "category" });
    const { result, store } = renderHookWithProviders(
      () => useClickBehaviorData({ dashcardId: DASHCARD_ID }),
      {
        customReducers: { dashboard: dashboardReducers },
        storeInitialState: createMockState({
          dashboard: createMockDashboardState({
            dashboardId: 1,
            dashboards: {
              1: createMockStoreDashboard({
                id: 1,
                parameters: [parameter],
                auto_apply_filters: true,
              }),
            },
            dashcards: {
              [DASHCARD_ID]: createMockDashboardCard({ id: DASHCARD_ID }),
            },
          }),
        }),
      },
    );
    const clicked: ClickObject = {
      column,
      value: "Gadget",
      data: [{ value: "Gadget", col: column }],
      settings: {
        column_settings: {},
        click_behavior: {
          type: "crossfilter",
          parameterMapping: {
            category: {
              id: "category",
              source: { type: "column", id: "CATEGORY", name: "Category" },
              target: { type: "parameter", id: "category" },
            },
          },
        },
      },
    };
    const apply = () =>
      result.current
        .getExtraDataForClick(clicked)
        .setReportCrossFilters(clicked);
    expect(getReportCrossFilters(clicked)).toEqual([
      { parameterId: "category", value: "Gadget" },
    ]);
    act(apply);
    await waitFor(() =>
      expect(store.getState().dashboard.parameterValues.category).toBe(
        "Gadget",
      ),
    );
    act(apply);
    await waitFor(() =>
      expect(store.getState().dashboard.parameterValues.category).toBe(
        PULSE_PARAM_EMPTY,
      ),
    );
  });

  it("resolves a dashboard link target from dashboard state", () => {
    const extraData = setup({ clicked: clickWithLinkTo("dashboard", 2) });

    expect(extraData.dashboards).toEqual({ 2: TARGET_DASHBOARD });
  });

  it("resolves a question link target from dashboard state", () => {
    const extraData = setup({ clicked: clickWithLinkTo("question", 3) });

    expect(extraData.questions).toEqual({ 3: TARGET_CARD });
  });

  it("omits a target the dashboard did not load", () => {
    const extraData = setup({ clicked: clickWithLinkTo("dashboard", 99) });

    expect(extraData.dashboards).toBeUndefined();
  });
});
