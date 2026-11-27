import { useState } from "react";
import { t } from "ttag";

import { Box, Button, Flex, Group, Text } from "metabase/ui";

import type { OperationsDisclosures, OperationsRunSummary } from "../types";

export function SimulationBanner({
  run,
  disclosures,
}: {
  run?: OperationsRunSummary | null;
  disclosures?: OperationsDisclosures | null;
}) {
  const [showAbout, setShowAbout] = useState(false);

  const asOfStr = run?.as_of_date ? String(run.as_of_date).slice(0, 10) : null;
  const pubStr = run?.created_at ? String(run.created_at).slice(0, 10) : null;

  return (
    <Box
      px="sm"
      py={6}
      mb="sm"
      style={{
        borderRadius: 6,
        border: "1px solid var(--mb-color-border)",
        backgroundColor: "var(--mb-color-background-secondary)",
      }}
      data-testid="simulation-banner"
    >
      <Flex justify="space-between" align="center" wrap="wrap" gap="xs">
        <Group gap="sm" wrap="wrap">
          <Text size="xs" fw={600}>
            {run?.source_policy_label || t`Service-First Fallback — Facility > Distributor > Brewer`}
          </Text>
          <Text size="xs" c="text-secondary">
            {t`Planning proposal — confirm before dispatch`}
            {asOfStr ? t` · Simulated as of ${asOfStr}` : ""}
            {pubStr ? t` · Published ${pubStr}` : ""}
            {run ? t` · ${run.horizon_orders.toLocaleString()} of ${run.total_open_orders.toLocaleString()} open orders` : ""}
          </Text>
        </Group>
        <Button size="xs" variant="subtle" onClick={() => setShowAbout((v) => !v)}>
          {showAbout ? t`Hide plan details` : t`About this plan`}
        </Button>
      </Flex>
      {showAbout && (
        <Box mt="xs" pt="xs" style={{ borderTop: "1px solid var(--mb-color-border)" }}>
          <Text size="xs" c="text-secondary">
            {disclosures?.summary ||
              t`Simulated India demonstration. Proposed plan only — inventory is not reserved and carriers are not booked.`}
          </Text>
          <Text size="xs" c="text-secondary" mt={4}>
            {t`Missing source tables: Truck fleet / trip schedules and InventoryReservation. Distances use modeled synthetic road proxies.`}
          </Text>
        </Box>
      )}
    </Box>
  );
}
