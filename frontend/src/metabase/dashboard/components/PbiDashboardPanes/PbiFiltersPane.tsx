import { useMemo } from "react";
import { t } from "ttag";

import { Sidebar } from "metabase/common/components/Sidebar";
import { AddFilterParameterMenu } from "metabase/dashboard/components/AddFilterParameterMenu";
import { DashboardParameterList } from "metabase/dashboard/components/DashboardParameterList";
import { SIDEBAR_NAME } from "metabase/dashboard/constants";
import { useDashboardContext } from "metabase/dashboard/context";
import { useNavigationExperience } from "metabase/nav/containers/PbiRail";
import {
  Box,
  Button,
  Divider,
  Group,
  Icon,
  Stack,
  Text,
  UnstyledButton,
} from "metabase/ui";
import { getValuePopulatedParameters } from "metabase-lib/v1/parameters/utils/parameter-values";

/**
 * Power BI-style Filters pane (part of the `pbi` navigation experience).
 *
 * Replaces the top parameter bar's placement with a persistent right pane,
 * listing the report's filters the way Power BI lists page-level filters.
 * Readers set values from the pane's widgets; authors open a filter's
 * mapping/settings from the gear row and add new filters from the footer.
 */
export function PbiFiltersPane() {
  const navigationExperience = useNavigationExperience();
  const {
    isEditing,
    closeSidebar,
    setSidebar,
    addParameter,
    parameters: dashboardParameters,
    parameterValues,
  } = useDashboardContext();
  const parameters = useMemo(
    () =>
      getValuePopulatedParameters({
        parameters: dashboardParameters,
        values: parameterValues,
      }),
    [dashboardParameters, parameterValues],
  );

  if (navigationExperience !== "pbi") {
    return null;
  }

  return (
    <Sidebar
      onClose={closeSidebar}
      data-testid="pbi-filters-pane"
      aria-label={t`Report filters`}
    >
      <Text px="lg" pt="md" fw="bold" component="h2">
        {t`Filters`}
      </Text>

      <Box px="lg" py="sm" style={{ overflowY: "auto" }}>
        <DashboardParameterList
          parameters={parameters}
          vertical
          isSortable={false}
          widgetsWithinPortal={false}
        />

        {isEditing && parameters.length > 0 && (
          <>
            <Divider mt="sm" />
            <Stack gap="xs" mt="sm" data-testid="pbi-filters-manage-list">
              {parameters.map((parameter) => (
                <UnstyledButton
                  key={parameter.id}
                  w="100%"
                  onClick={() =>
                    setSidebar({
                      name: SIDEBAR_NAME.editParameter,
                      props: { parameterId: parameter.id },
                    })
                  }
                  data-testid={`pbi-filter-settings-${parameter.id}`}
                  aria-label={t`Edit filter ${parameter.name}`}
                >
                  <Group
                    justify="space-between"
                    wrap="nowrap"
                    aria-label={t`Edit filter`}
                  >
                    <Text c="text-secondary" size="sm" truncate="end">
                      {parameter.name}
                    </Text>
                    <Icon name="gear" size={14} />
                  </Group>
                </UnstyledButton>
              ))}
            </Stack>
          </>
        )}
      </Box>

      {isEditing && (
        <AddFilterParameterMenu
          onAdd={(options) => addParameter({ options })}
          position="bottom-start"
        >
          <Box px="lg" pb="md">
            <Button
              variant="default"
              w="100%"
              leftSection={<Icon name="add" />}
            >
              {t`Add a filter`}
            </Button>
          </Box>
        </AddFilterParameterMenu>
      )}
      {!isEditing && <Box pb="md" />}
    </Sidebar>
  );
}
