import { createMockState } from "__support__/state";
import { renderWithProviders, screen } from "__support__/ui";
import { PbiFiltersPane } from "metabase/dashboard/components/PbiDashboardPanes/PbiFiltersPane";
import { PbiFormatPane } from "metabase/dashboard/components/PbiDashboardPanes/PbiFormatPane";
import { MockDashboardContext } from "metabase/dashboard/context/mock-context";
import { useNavigationExperience } from "metabase/nav/containers/PbiRail";
import type { DashboardSidebarState } from "metabase/redux/store";
import type { UiParameter } from "metabase-lib/v1/parameters/types";
import type {
  DashCardId,
  Dashboard,
  NavigationExperience,
} from "metabase-types/api";
import {
  createMockCard,
  createMockDashboard,
  createMockDashboardCard,
  createMockParameter,
} from "metabase-types/api/mocks";

jest.mock("metabase/nav/containers/PbiRail", () => ({
  useNavigationExperience: jest.fn(),
}));

// The module import doubles as the mock handle in tests.
const mockUseNavigationExperience = useNavigationExperience as jest.Mock;

function setupPane(
  pane: React.ReactElement,
  {
    experience = "pbi",
    isEditing = false,
    parameters = [],
    sidebar = undefined,
    dashboard = undefined,
  }: {
    experience?: NavigationExperience;
    isEditing?: boolean;
    parameters?: UiParameter[];
    sidebar?: DashboardSidebarState | undefined;
    dashboard?: Dashboard | undefined;
  } = {},
) {
  mockUseNavigationExperience.mockReturnValue(experience);

  return renderWithProviders(
    <MockDashboardContext
      dashboard={dashboard}
      parameters={parameters}
      isEditing={isEditing}
      sidebar={sidebar}
    >
      {pane}
    </MockDashboardContext>,
    {
      storeInitialState: createMockState(),
      withRouter: true,
    },
  );
}

describe("PbiFiltersPane", () => {
  beforeEach(() => {
    mockUseNavigationExperience.mockReset();
  });

  it("lists report filters as pane rows in the pbi experience", () => {
    setupPane(<PbiFiltersPane />, {
      parameters: [createMockParameter()],
    });

    expect(screen.getByTestId("pbi-filters-pane")).toBeInTheDocument();
  });

  it("does not render in the classic experience", () => {
    setupPane(<PbiFiltersPane />, {
      experience: "classic",
      parameters: [createMockParameter()],
    });

    expect(screen.queryByTestId("pbi-filters-pane")).not.toBeInTheDocument();
  });

  it("offers filter management rows and Add a filter in edit mode", async () => {
    const parameter = createMockParameter();
    setupPane(<PbiFiltersPane />, {
      isEditing: true,
      parameters: [parameter],
    });

    expect(
      screen.getByTestId(`pbi-filter-settings-${parameter.id}`),
    ).toBeInTheDocument();
    expect(screen.getByText(/add a filter/i)).toBeInTheDocument();
  });
});

describe("PbiFormatPane", () => {
  beforeEach(() => {
    mockUseNavigationExperience.mockReset();
  });

  const dashcardId: DashCardId = 11;

  function setupFormat({
    experience = "pbi",
  }: { experience?: NavigationExperience } = {}) {
    const card = createMockCard({ id: 22, name: "Revenue" });
    const dashcard = createMockDashboardCard({
      id: dashcardId,
      card_id: card.id,
    });
    const dashboard = createMockDashboard({
      dashcards: [dashcard],
    });

    setupPane(<PbiFormatPane />, {
      experience,
      sidebar: { name: "chartSettings", props: { dashcardId } },
      dashboard,
    });
  }

  it("renders the Format pane with the card's chart settings", async () => {
    setupFormat();

    expect(await screen.findByTestId("pbi-format-pane")).toBeInTheDocument();
  }, 15000);

  it("does not render in the classic experience", () => {
    setupFormat({ experience: "classic" });

    expect(screen.queryByTestId("pbi-format-pane")).not.toBeInTheDocument();
  });
});
