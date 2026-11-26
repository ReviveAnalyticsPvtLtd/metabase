import { useEffect, useState } from "react";
import { t } from "ttag";

import { useNavigate } from "metabase/router";
import { Box, Button, Flex, Text, Title } from "metabase/ui";

import { fetchOperationsExceptions } from "../api";
import { SimulationBanner } from "../components/SimulationBanner";
import { StatusBadge } from "../components/StatusBadge";
import type { OrdersListResponse } from "../types";

export function ExceptionsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<OrdersListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOperationsExceptions({ limit: 100 })
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t`Unable to load exceptions.`);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box p="lg" maw={1440} mx="auto">
      <Flex justify="space-between" align="center" mb="sm" wrap="wrap" gap="sm">
        <div>
          <Title order={2}>{t`Exceptions & Shortfall Triage`}</Title>
          <Text size="sm" c="text-secondary">
            {t`Orders with uncovered quantity, partial coverage, or deadline shortfalls. Click any order to inspect alternatives.`}
          </Text>
        </div>
        <Button variant="default" onClick={() => navigate("/operations/orders")}>
          {t`All Orders`}
        </Button>
      </Flex>

      <SimulationBanner run={data?.run} disclosures={data?.disclosures} />

      {error && (
        <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-error)", borderRadius: 8 }}>
          <Text c="error" fw={600}>{error}</Text>
        </Box>
      )}

      {loading ? (
        <Text size="sm" c="text-secondary">{t`Loading exceptions...`}</Text>
      ) : !data || data.data.length === 0 ? (
        <Text size="sm" c="text-secondary">{t`No exceptions in the current planning horizon.`}</Text>
      ) : (
        <Box style={{ overflowX: "auto", border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--mb-color-border)", textAlign: "left" }}>
                <th style={{ padding: "8px 10px" }}>{t`Order ID`}</th>
                <th style={{ padding: "8px 10px" }}>{t`Brewer`}</th>
                <th style={{ padding: "8px 10px" }}>{t`Region`}</th>
                <th style={{ padding: "8px 10px" }}>{t`Size`}</th>
                <th style={{ padding: "8px 10px" }}>{t`Needed by`}</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Pending`}</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Proposed`}</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Uncovered`}</th>
                <th style={{ padding: "8px 10px" }}>{t`Status`}</th>
                <th style={{ padding: "8px 10px" }}>{t`Reason`}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((row) => (
                <tr
                  key={row.allocation_id}
                  onClick={() => navigate(`/operations/orders/${encodeURIComponent(row.order_id)}`)}
                  style={{ cursor: "pointer", borderBottom: "1px solid var(--mb-color-border)" }}
                >
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>{row.order_id}</td>
                  <td style={{ padding: "8px 10px" }}>{row.destination_brewer}</td>
                  <td style={{ padding: "8px 10px" }}>{row.region}</td>
                  <td style={{ padding: "8px 10px" }}>{row.keg_size}</td>
                  <td style={{ padding: "8px 10px" }}>{String(row.needed_by).slice(0, 10)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{row.pending_units.toLocaleString()}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{row.allocated_units.toLocaleString()}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>{row.uncovered_units.toLocaleString()}</td>
                  <td style={{ padding: "8px 10px" }}><StatusBadge status={row.status} /></td>
                  <td style={{ padding: "8px 10px" }}>{row.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </Box>
  );
}
