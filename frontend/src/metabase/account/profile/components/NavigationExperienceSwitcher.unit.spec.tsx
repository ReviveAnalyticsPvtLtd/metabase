import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import { setupUpdateSettingEndpoint } from "__support__/server-mocks";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderWithProviders, screen, waitFor } from "__support__/ui";
import type { NavigationExperience } from "metabase-types/api";

import { NavigationExperienceSwitcher } from "./NavigationExperienceSwitcher";

function setup(experience?: NavigationExperience) {
  return renderWithProviders(<NavigationExperienceSwitcher />, {
    storeInitialState: createMockState({
      settings: mockSettings({ "navigation-experience": experience }),
    }),
    withRouter: true,
  });
}

describe("NavigationExperienceSwitcher", () => {
  afterEach(() => {
    fetchMock.removeRoutes();
  });

  it("renders the current navigation experience", () => {
    setup("pbi");

    expect(
      screen.getByTestId("navigation-experience-switcher"),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Power BI");
  });

  it("falls back to Classic when the setting is unset", () => {
    setup(undefined);

    expect(screen.getByRole("textbox")).toHaveValue("Classic");
  });

  it("saves the selection as a user-local setting", async () => {
    setupUpdateSettingEndpoint();
    setup("classic");

    // open the dropdown and pick the Power BI option
    const combobox = screen.getByRole("textbox");
    await userEvent.click(combobox);
    await userEvent.click(screen.getByRole("option", { name: /power bi/i }));

    await waitFor(() =>
      expect(
        fetchMock.callHistory.calls("path:/api/setting/navigation-experience"),
      ).toHaveLength(1),
    );
  });
});
