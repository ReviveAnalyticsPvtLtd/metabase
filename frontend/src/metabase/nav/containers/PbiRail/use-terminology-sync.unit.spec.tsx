import { renderHookWithProviders } from "__support__/ui";
import { reload } from "metabase/utils/dom";
import {
  getPowerBITerminologyFlag,
  setPowerBITerminologyFlag,
} from "metabase/utils/i18n";

import { usePowerBITerminologySync } from "./use-terminology-sync";

jest.mock("metabase/utils/dom", () => ({
  reload: jest.fn(),
}));

jest.mock("metabase/utils/i18n", () => ({
  getPowerBITerminologyFlag: jest.fn(),
  setPowerBITerminologyFlag: jest.fn(),
}));

const useUserSettingMock = jest.fn();

jest.mock("metabase/settings", () => {
  const actual = jest.requireActual("metabase/settings");
  return {
    ...actual,
    useUserSetting: (...args: unknown[]) => useUserSettingMock(...args),
  };
});

const getReloadMock = () => jest.mocked(reload);
const getFlagMock = () => jest.mocked(getPowerBITerminologyFlag);
const setFlagMock = () => jest.mocked(setPowerBITerminologyFlag);

/** sessionStorage stand-in: absent by default, writable unless overridden. */
let storedFlag: string | undefined;

function setup({
  navigationExperience,
  canPersistFlag = true,
}: {
  navigationExperience?: "classic" | "pbi";
  canPersistFlag?: boolean;
}) {
  useUserSettingMock.mockReturnValue([navigationExperience, jest.fn()]);

  if (!canPersistFlag) {
    setFlagMock().mockImplementation(() => undefined);
  }

  return renderHookWithProviders(() => usePowerBITerminologySync(), {});
}

describe("usePowerBITerminologySync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    storedFlag = undefined;
    getFlagMock().mockImplementation(() => storedFlag);
    setFlagMock().mockImplementation((experience: string) => {
      storedFlag = experience;
    });
  });

  it("does not reload while the setting is unknown", () => {
    // Regression: before the session properties load the value is undefined,
    // which used to read as "classic" and ping-pong against an applied "pbi"
    // flag — reloading the page forever.
    storedFlag = "pbi";

    setup({ navigationExperience: undefined });

    expect(setFlagMock()).not.toHaveBeenCalled();
    expect(getReloadMock()).not.toHaveBeenCalled();
  });

  it("does not reload when the applied flag matches the setting", () => {
    storedFlag = "pbi";

    setup({ navigationExperience: "pbi" });

    expect(getReloadMock()).not.toHaveBeenCalled();
  });

  it("does not reload when neither flag nor setting is set", () => {
    setup({ navigationExperience: undefined });

    expect(getReloadMock()).not.toHaveBeenCalled();
  });

  it("reloads once when the flag mismatches the loaded setting", () => {
    storedFlag = "classic";

    setup({ navigationExperience: "pbi" });

    expect(setFlagMock()).toHaveBeenCalledWith("pbi");
    expect(getReloadMock()).toHaveBeenCalledTimes(1);
  });

  it("switches back to classic when the setting is flipped off", () => {
    storedFlag = "pbi";

    setup({ navigationExperience: "classic" });

    expect(setFlagMock()).toHaveBeenCalledWith("classic");
    expect(getReloadMock()).toHaveBeenCalledTimes(1);
  });

  it("does not reload when the flag cannot be persisted", () => {
    // Private mode / blocked storage: sessionStorage writes silently no-op,
    // so the flag can never match. Reloading here would loop forever.
    setup({ navigationExperience: "pbi", canPersistFlag: false });

    expect(getReloadMock()).not.toHaveBeenCalled();
  });
});
