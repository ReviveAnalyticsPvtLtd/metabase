import { setupEnterprisePlugins } from "__support__/enterprise";
import { mockSettings } from "__support__/settings";
import { createMockState } from "__support__/state";
import { renderHookWithProviders } from "__support__/ui";
import type { NavigationExperience } from "metabase-types/api";

import { useNavigationExperience } from "./use-navigation-experience";

function setup({
  navigationExperience,
}: { navigationExperience?: NavigationExperience } = {}) {
  setupEnterprisePlugins();
  const storeInitialState = createMockState({
    settings: mockSettings({
      "navigation-experience": navigationExperience,
    }),
  });
  return renderHookWithProviders(() => useNavigationExperience(), {
    storeInitialState,
  });
}

describe("useNavigationExperience", () => {
  it.each([
    ["unset", undefined],
    ["legacy classic", "classic"],
    ["legacy pbi", "pbi"],
    ["unknown", "unknown"],
  ])("returns the unified experience for %s", (_, navigationExperience) => {
    const { result } = setup({
      // Include an out-of-contract value to verify compatibility fallback.
      navigationExperience: navigationExperience as NavigationExperience,
    });
    expect(result.current).toBe("pbi");
  });
});
