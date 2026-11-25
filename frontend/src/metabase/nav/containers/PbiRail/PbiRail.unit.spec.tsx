import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

jest.mock("kbar", () => ({
  useKBar: () => ({ query: { toggle: mockKbarToggle } }),
}));

import {
  setupCollectionByIdEndpoint,
  setupCollectionsEndpoints,
  setupDatabasesEndpoints,
} from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen } from "__support__/ui";
import { ROOT_COLLECTION } from "metabase/common/collections/constants";
import { Route } from "metabase/router";
import type { NavigationExperience } from "metabase-types/api";
import {
  createMockCollection,
  createMockUser,
  createMockUserMetabotPermissions,
} from "metabase-types/api/mocks";

import { PbiRail } from "./PbiRail";

const mockKbarToggle = jest.fn();

const TEST_COLLECTION = createMockCollection({
  id: 2,
  name: "Test collection",
});

const PERSONAL_COLLECTION = createMockCollection({
  id: 1,
  name: "John's Personal Collection",
  personal_owner_id: 999,
});

type SetupOpts = {
  pathname?: string;
  experience?: NavigationExperience;
  isSuperUser?: boolean;
  canCurateRootCollection?: boolean;
  metabotEnabled?: boolean;
};

function setup({
  pathname = "/",
  experience = "pbi",
  isSuperUser = false,
  canCurateRootCollection = false,
  metabotEnabled = false,
}: SetupOpts = {}) {
  const user = createMockUser({ is_superuser: isSuperUser });
  user.personal_collection_id = PERSONAL_COLLECTION.id;

  const ourAnalytics = createMockCollection({
    ...ROOT_COLLECTION,
    can_write: canCurateRootCollection,
  });

  setupCollectionsEndpoints({
    collections: [TEST_COLLECTION, PERSONAL_COLLECTION],
    rootCollection: ourAnalytics,
    currentUserId: user.id,
  });
  setupCollectionByIdEndpoint({
    collections: [PERSONAL_COLLECTION, TEST_COLLECTION],
  });
  setupDatabasesEndpoints([]);
  fetchMock.get("path:/api/bookmark", []);

  if (metabotEnabled) {
    fetchMock.get(
      "path:/api/metabot/permissions/user-permissions",
      createMockUserMetabotPermissions(),
    );
  }

  const storeInitialState = createMockState({
    currentUser: user,
    settings: mockSettings({
      "application-name": "NubrixAI",
      "metabot-enabled?": metabotEnabled,
      "metabot-name": "Nubrix bot",
      "navigation-experience": experience,
      "expand-collections-in-nav": true,
      "expand-bookmarks-in-nav": true,
    }),
  });

  renderWithProviders(<Route path="*" element={<PbiRail isOpen />} />, {
    storeInitialState,
    initialRoute: pathname,
    withRouter: true,
    withDND: true,
  });
}

describe("PbiRail", () => {
  afterEach(() => {
    fetchMock.removeRoutes();
    mockKbarToggle.mockClear();
  });

  it("renders the top-level navigation hub items", async () => {
    setup();

    expect(await screen.findByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /data/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /metrics/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /account settings/i }),
    ).toBeInTheDocument();
  });

  it("renders the workspaces tree with the root collection", async () => {
    setup();

    expect(
      await screen.findByRole("treeitem", { name: /Our analytics/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: /Test collection/i }),
    ).toBeInTheDocument();
  });

  it("opens the omnibox (command palette) when search is clicked", async () => {
    setup();

    await userEvent.click(
      await screen.findByRole("button", { name: /search/i }),
    );
    expect(mockKbarToggle).toHaveBeenCalledTimes(1);
  });

  it("does not show the assistant item when the assistant is disabled", async () => {
    setup();

    await screen.findByRole("link", { name: /home/i });
    expect(
      screen.queryByRole("button", { name: /Chat with Nubrix bot/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the assistant item for users with assistant access", async () => {
    setup({ metabotEnabled: true });

    await screen.findByRole("link", { name: /home/i });
    expect(screen.getByText(/Chat with Nubrix bot/i)).toBeInTheDocument();
  });

  it("shows the admin settings link for admins", async () => {
    setup({ isSuperUser: true });

    await screen.findByRole("link", { name: /home/i });
    expect(
      screen.getByRole("link", { name: /admin settings/i }),
    ).toBeInTheDocument();
  });

  it("does not show the admin settings link for regular users", async () => {
    setup({ isSuperUser: false });

    await screen.findByRole("link", { name: /home/i });
    expect(
      screen.queryByRole("link", { name: /admin settings/i }),
    ).not.toBeInTheDocument();
  });
});
