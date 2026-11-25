import userEvent from "@testing-library/user-event";

import { createMockState } from "__support__/state";
import { renderWithProviders, screen, within } from "__support__/ui";
import { PbiReportRibbon } from "metabase/dashboard/components/PbiReportRibbon/PbiReportRibbon";
import { MockDashboardContext } from "metabase/dashboard/context/mock-context";
import { useNavigationExperience } from "metabase/nav/containers/PbiRail";
import { createMockDashboard } from "metabase-types/api/mocks";

jest.mock("metabase/nav/containers/PbiRail", () => ({
  useNavigationExperience: jest.fn(),
}));

// The module import doubles as the mock handle in tests.
const mockUseNavigationExperience = useNavigationExperience as jest.Mock;

function setup({
  experience = "pbi",
  isFullscreen = false,
  isEditing = false,
  canWrite = true,
} = {}) {
  mockUseNavigationExperience.mockReturnValue(experience);
  const onCancelEditing = jest.fn();
  const addMarkdownDashCardToDashboard = jest.fn();
  const addHeadingDashCardToDashboard = jest.fn();
  const addLinkDashCardToDashboard = jest.fn();

  renderWithProviders(
    <MockDashboardContext
      isFullscreen={isFullscreen}
      isEditing={isEditing}
      selectedTabId={42}
      addMarkdownDashCardToDashboard={addMarkdownDashCardToDashboard}
      addHeadingDashCardToDashboard={addHeadingDashCardToDashboard}
      addLinkDashCardToDashboard={addLinkDashCardToDashboard}
    >
      <PbiReportRibbon
        dashboard={createMockDashboard({ can_write: canWrite })}
        onCancelEditing={onCancelEditing}
      />
    </MockDashboardContext>,
    {
      storeInitialState: createMockState(),
      withRouter: true,
    },
  );
  return {
    onCancelEditing,
    addMarkdownDashCardToDashboard,
    addHeadingDashCardToDashboard,
    addLinkDashCardToDashboard,
  };
}

describe("PbiReportRibbon", () => {
  beforeEach(() => {
    mockUseNavigationExperience.mockReset();
  });

  it("renders the ribbon with Home / Insert / View tabs in the pbi experience", async () => {
    setup();

    expect(await screen.findByTestId("pbi-report-ribbon")).toBeInTheDocument();
    expect(screen.getByTestId("home-ribbon-tab")).toBeInTheDocument();
    expect(screen.getByTestId("insert-ribbon-tab")).toBeInTheDocument();
    expect(screen.getByTestId("view-ribbon-tab")).toHaveAttribute(
      "role",
      "tab",
    );
    expect(screen.getByTestId("home-ribbon-tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await userEvent.click(screen.getByTestId("home-ribbon-tab"));
    await userEvent.keyboard("{ARROWRIGHT}");
    expect(screen.getByTestId("insert-ribbon-tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("does not render in the classic experience", () => {
    setup({ experience: "classic" });

    expect(screen.queryByTestId("pbi-report-ribbon")).not.toBeInTheDocument();
  });

  it("does not render in fullscreen mode", () => {
    setup({ isFullscreen: true });

    expect(screen.queryByTestId("pbi-report-ribbon")).not.toBeInTheDocument();
  });

  it("shows Home commands by default and Insert commands on the Insert tab", async () => {
    setup({ experience: "pbi" });

    expect(await screen.findByTestId("ribbon-edit")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("insert-ribbon-tab"));
    expect(
      await screen.findByTestId("ribbon-add-report-item"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ribbon-add-text")).toBeInTheDocument();
    expect(screen.getByTestId("ribbon-add-heading")).toBeInTheDocument();
    expect(screen.getByTestId("ribbon-add-link")).toBeInTheDocument();
  });

  it("uses the header's unsaved-change confirmation when cancelling", async () => {
    const { onCancelEditing } = setup({ isEditing: true });
    expect(
      screen.queryByRole("button", { name: "Edit report" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Cancel editing" }),
    );
    expect(onCancelEditing).toHaveBeenCalledTimes(1);
  });

  it("does not offer mutation commands to a read-only viewer", async () => {
    setup({ canWrite: false });
    expect(
      screen.queryByRole("button", { name: "Edit report" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel editing" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("insert-ribbon-tab"));
    expect(
      screen.queryByRole("button", { name: "Add report item" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Text" }),
    ).not.toBeInTheDocument();
  });

  it("inserts narrative content into the selected report page", async () => {
    const {
      addMarkdownDashCardToDashboard,
      addHeadingDashCardToDashboard,
      addLinkDashCardToDashboard,
    } = setup({ isEditing: true });
    await userEvent.click(screen.getByRole("tab", { name: "Insert" }));
    const commands = within(screen.getByRole("tabpanel", { name: "Insert" }));
    await userEvent.click(commands.getByRole("button", { name: "Text" }));
    await userEvent.click(commands.getByRole("button", { name: "Heading" }));
    await userEvent.click(commands.getByRole("button", { name: "Link" }));
    const destination = { dashId: createMockDashboard().id, tabId: 42 };
    expect(addMarkdownDashCardToDashboard).toHaveBeenCalledWith(destination);
    expect(addHeadingDashCardToDashboard).toHaveBeenCalledWith(destination);
    expect(addLinkDashCardToDashboard).toHaveBeenCalledWith(destination);
  });

  it("moves keyboard focus with wraparound and Home/End navigation", async () => {
    setup();
    const home = screen.getByRole("tab", { name: "Home" });
    const view = screen.getByRole("tab", { name: "View" });
    await userEvent.click(home);
    await userEvent.keyboard("{ArrowLeft}");
    expect(view).toHaveFocus();
    expect(view).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Home}");
    expect(home).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(view).toHaveFocus();
    const panel = screen.getByRole("tabpanel", { name: "View" });
    expect(view).toHaveAttribute("aria-controls", panel.id);
  });
});
