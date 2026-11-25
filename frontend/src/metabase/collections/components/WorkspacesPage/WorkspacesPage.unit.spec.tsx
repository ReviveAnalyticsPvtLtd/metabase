import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import {
  setupCardsEndpoints,
  setupCollectionByIdEndpoint,
  setupCollectionsEndpoints,
  setupDashboardsEndpoints,
  setupDatabasesEndpoints,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen } from "__support__/ui";
import { ROOT_COLLECTION } from "metabase/common/collections/constants";
import { Route } from "metabase/router";
import type { Card, Collection, Dashboard } from "metabase-types/api";
import {
  createMockCard,
  createMockCollection,
  createMockDashboard,
  createMockUser,
} from "metabase-types/api/mocks";

import { WorkspacesPage } from "./WorkspacesPage";

const TEST_WORKSPACE = createMockCollection({
  id: 2,
  name: "Logistics Workspace",
});

const PERSONAL_COLLECTION = createMockCollection({
  id: 1,
  name: "John's Personal Collection",
  personal_owner_id: 1234,
});

const REPORT = createMockDashboard({
  id: 10,
  name: "Monthly Operations Report",
});

const SEMANTIC_MODEL = createMockCard({
  id: 20,
  name: "Shipments Semantic Model",
  type: "model",
});

const QUERY = createMockCard({
  id: 21,
  name: "Late Deliveries Query",
  type: "question",
});

const METRIC = createMockCard({
  id: 22,
  name: "On-time Delivery Metric",
  type: "metric",
});

type SetupOpts = {
  reports?: Dashboard[];
  cards?: Card[];
  workspaces?: Collection[];
};

function setup({
  reports = [REPORT],
  cards = [SEMANTIC_MODEL, QUERY, METRIC],
  workspaces = [TEST_WORKSPACE, PERSONAL_COLLECTION],
}: SetupOpts = {}) {
  const user = createMockUser({ id: 1234, personal_collection_id: 1 });

  const ourAnalytics = createMockCollection({
    ...ROOT_COLLECTION,
    can_write: true,
  });

  setupCollectionsEndpoints({
    collections: workspaces,
    rootCollection: ourAnalytics,
    currentUserId: user.id,
  });
  setupCollectionByIdEndpoint({ collections: workspaces });
  setupDatabasesEndpoints([]);
  setupDashboardsEndpoints(reports);
  setupCardsEndpoints(cards);
  fetchMock.get("path:/api/bookmark", []);

  const storeInitialState = createMockState({
    currentUser: user,
    settings: mockSettings({
      "application-name": "NubrixAI",
      "metabot-enabled?": false,
    }),
  });

  renderWithProviders(<Route path="*" element={<WorkspacesPage />} />, {
    storeInitialState,
    initialRoute: "/workspaces",
    withRouter: true,
    withDND: true,
  });
}

describe("WorkspacesPage", () => {
  afterEach(() => {
    fetchMock.removeRoutes();
  });

  it("renders the workspace tabs and workspace cards", async () => {
    setup();

    expect(
      await screen.findByRole("button", { name: /reports/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /semantic models/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /queries/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /automations/i }),
    ).toBeInTheDocument();

    // workspace cards for displayable + personal collections
    expect(await screen.findByText(/Logistics Workspace/i)).toBeInTheDocument();
    expect(
      screen
        .getByRole("link", { name: /personal collection/i })
        .getAttribute("href")
        ?.startsWith("/collection/1"),
    ).toBe(true);
  });

  it("shows reports (dashboards) on the default tab", async () => {
    setup();

    expect(
      await screen.findByText(/Monthly Operations Report/i),
    ).toBeInTheDocument();
  });

  it("shows semantic models on the semantic models tab", async () => {
    setup();

    await userEvent.click(
      await screen.findByRole("button", { name: /semantic models/i }),
    );

    expect(
      await screen.findByText(/Shipments Semantic Model/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Late Deliveries Query/i),
    ).not.toBeInTheDocument();
  });

  it("shows queries on the queries tab", async () => {
    setup();

    await userEvent.click(
      await screen.findByRole("button", { name: /^queries$/i }),
    );

    expect(
      await screen.findByText(/Late Deliveries Query/i),
    ).toBeInTheDocument();
  });

  it("shows the automations empty state", async () => {
    setup();

    await userEvent.click(
      await screen.findByRole("button", { name: /automations/i }),
    );

    const emptyStates = await screen.findAllByTestId("empty-state");
    expect(emptyStates.length).toBeGreaterThan(0);
  });

  it("excludes metrics from the content tabs", async () => {
    setup();

    await userEvent.click(
      await screen.findByRole("button", { name: /semantic models/i }),
    );

    expect(
      screen.queryByText(/On-time Delivery Metric/i),
    ).not.toBeInTheDocument();
  });
});
