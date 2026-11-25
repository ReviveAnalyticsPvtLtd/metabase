import { t } from "ttag";

import { useUserSetting } from "metabase/settings";
import { Select, Text } from "metabase/ui";

/**
 * Lets each user opt into the Power BI-style navigation experience
 * (`pbi`) or stay on the classic one. User-local setting, defined in
 * `metabase.users.settings`.
 */
export function NavigationExperienceSwitcher() {
  const [navigationExperience, setNavigationExperience] = useUserSetting(
    "navigation-experience",
  );

  return (
    <div data-testid="navigation-experience-switcher">
      <Text mt="xxs" fw="bold">
        {t`Navigation`}
      </Text>

      <Select
        mt="xs"
        mb="lg"
        w={280}
        value={navigationExperience ?? "classic"}
        data={[
          { value: "classic", label: t`Classic` },
          { value: "pbi", label: t`Power BI` },
        ]}
        onChange={(value) =>
          setNavigationExperience(value === "pbi" ? "pbi" : "classic")
        }
      />
    </div>
  );
}
