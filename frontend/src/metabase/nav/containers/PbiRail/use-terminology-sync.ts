import { useEffect } from "react";

import { useUserSetting } from "metabase/settings";
import { reload } from "metabase/utils/dom";
import {
  getPowerBITerminologyFlag,
  setPowerBITerminologyFlag,
} from "metabase/utils/i18n";

/**
 * Keeps the terminology pack in sync with the user's `navigation-experience`
 * setting.
 *
 * Terminology must be installed while the i18n module bootstraps (before any
 * component renders), but the setting is only available after the session
 * properties have loaded. The hook therefore hard-reloads once when the flag
 * the pack was applied for no longer matches the setting, mirroring the
 * existing hard-reload flow for locale changes (`REFRESH_LOCALE`).
 *
 * Two guards keep this from turning into a reload loop:
 *
 * 1. An `undefined` setting is treated as "unknown" (still loading, or never
 *    set) and never triggers a reload. Only an explicit `classic`/`pbi` value
 *    is authoritative — otherwise the brief pre-fetch window reads as
 *    `classic`, which flips the flag back and forth forever.
 * 2. The flag is read back after being written. If it did not persist
 *    (`sessionStorage` is unavailable in private mode), reloading could never
 *    converge, so the reload is skipped.
 */
export function usePowerBITerminologySync(): void {
  const [navigationExperience] = useUserSetting("navigation-experience");

  useEffect(() => {
    if (navigationExperience === undefined) {
      return;
    }

    const appliedExperience = getPowerBITerminologyFlag();

    if (appliedExperience === navigationExperience) {
      return;
    }

    setPowerBITerminologyFlag(navigationExperience);

    if (getPowerBITerminologyFlag() !== navigationExperience) {
      // The flag could not be persisted; reloading would loop forever.
      return;
    }

    reload();
  }, [navigationExperience]);
}
