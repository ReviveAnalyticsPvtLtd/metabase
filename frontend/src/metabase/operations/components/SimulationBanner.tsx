import { t } from "ttag";

import { Badge, Box, Flex, Group, Text } from "metabase/ui";

import type { OperationsDisclosures, OperationsRunSummary } from "../types";

export function SimulationBanner({
  run,
  disclosures,
}: {
  run?: OperationsRunSummary | null;
  disclosures?: OperationsDisclosures | null;
}) {
  return (
    <Box
      p="sm"
      mb="md"
      style={{
        borderRadius: 8,
        border: "1px solid var(--mb-color-border)",
        backgroundColor: "var(--mb-color-background-secondary)",
      }}
      data-testid="simulation-banner"
    >
      <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="xs" wrap="wrap">
          <Badge color="blue" variant="light" size="sm">
            {t`Simulated scenario`}
          </Badge>
          <Badge color="yellow" variant="light" size="sm">
            {t`Proposed plan — not a booking`}
          </Badge>
          {run?.as_of_date && (
            <Text size="xs" c="text-secondary">
              {t`Plan as of ${String(run.as_of_date).slice(0, 10)}`}
            </Text>
          )}
          {run && (
            <Text size="xs" c="text-secondary">
              {t`Showing the current planning horizon: ${run.horizon_orders.toLocaleString()} orders of ${run.total_open_orders.toLocaleString()} open orders.`}
            </Text>
          )}
        </Group>
        {disclosures?.summary && (
          <Text size="xs" c="text-secondary">
            {disclosures.summary}
          </Text>
        )}
      </Flex>
    </Box>
  );
}
