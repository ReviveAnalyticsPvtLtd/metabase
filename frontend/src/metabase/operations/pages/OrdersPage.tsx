import { useCallback, useEffect, useState } from "react";
import { t } from "ttag";

import { useNavigate, useSearchParams } from "metabase/router";
import {
  Box,
  Button,
  Checkbox,
  Flex,
  Group,
  Select,
  Text,
  TextInput,
  Title,
} from "metabase/ui";

import { fetchOperationsOrders } from "../api";
import { SimulationBanner } from "../components/SimulationBanner";
import { StatusBadge } from "../components/StatusBadge";
import type { OrdersListResponse } from "../types";

export function OrdersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get("q") || "";
  const status = searchParams.get("status") || "";
  const region = searchParams.get("region") || "";
  const kegSize = searchParams.get("keg_size") || "";
  const exceptionsOnly = searchParams.get("exceptions_only") === "true";

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<OrdersListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOperationsOrders({
      q: q || undefined,
      status: status || undefined,
      region: region || undefined,
      keg_size: kegSize || undefined,
      exceptions_only: exceptionsOnly,
      cursor,
      limit: 50,
    })
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t`Unable to load orders.`);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [q, status, region, kegSize, exceptionsOnly, cursor]);

  const updateFilter = useCallback(
    (key: string, value: string | boolean) => {
      const next = new URLSearchParams(searchParams);
      if (value === "" || value === false) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
      setCursor(undefined);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      updateFilter("q", searchInput.trim());
    },
    [searchInput, updateFilter],
  );

  return (
    <Box p="lg" maw={1440} mx="auto">
      <Flex justify="space-between" align="center" mb="sm" wrap="wrap" gap="sm">
        <div>
          <Title order={2}>{t`Order Fulfillment Queue`}</Title>
          <Text size="sm" c="text-secondary">
            {t`Inspect proposed fulfillment plans, uncovered quantities, and candidate evidence per order.`}
          </Text>
        </div>
        <Group gap="xs">
          <Button variant="default" onClick={() => navigate("/dashboard/23")}>
            {t`Control Tower Overview`}
          </Button>
          <Button variant="light" color="red" onClick={() => navigate("/operations/exceptions")}>
            {t`View Exceptions`}
          </Button>
        </Group>
      </Flex>

      <SimulationBanner run={data?.run} disclosures={data?.disclosures} />

      <form onSubmit={handleSearchSubmit}>
        <Flex gap="sm" mb="md" wrap="wrap" align="flex-end">
          <TextInput
            label={t`Search order or Brewer`}
            placeholder={t`e.g. ORD-008116 or Bhubaneswar`}
            value={searchInput}
            onChange={(e) => setSearchInput(e.currentTarget.value)}
            style={{ minWidth: 240 }}
          />
          <Button type="submit" variant="filled">
            {t`Search`}
          </Button>
          <Select
            label={t`Status`}
            placeholder={t`All statuses`}
            clearable
            value={status || null}
            onChange={(val) => updateFilter("status", val || "")}
            data={[
              { value: "Fully covered", label: t`Fully covered` },
              { value: "Partially covered", label: t`Partially covered` },
              { value: "Needs attention", label: t`Needs attention` },
            ]}
          />
          <Select
            label={t`Region`}
            placeholder={t`All regions`}
            clearable
            value={region || null}
            onChange={(val) => updateFilter("region", val || "")}
            data={["North", "South", "East", "West"]}
          />
          <Select
            label={t`Keg size`}
            placeholder={t`All sizes`}
            clearable
            value={kegSize || null}
            onChange={(val) => updateFilter("keg_size", val || "")}
            data={["20L", "30L", "50L"]}
          />
          <Checkbox
            label={t`Needs attention only`}
            checked={exceptionsOnly}
            onChange={(e) => updateFilter("exceptions_only", e.currentTarget.checked)}
            mb={6}
          />
        </Flex>
      </form>

      {error && (
        <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-error)", borderRadius: 8 }}>
          <Text c="error" fw={600}>
            {error}
          </Text>
        </Box>
      )}

      {loading ? (
        <Box p="xl">
          <Text size="sm" c="text-secondary">
            {t`Loading proposed fulfillment queue...`}
          </Text>
        </Box>
      ) : !data || data.data.length === 0 ? (
        <Box p="xl" style={{ border: "1px dashed var(--mb-color-border)", borderRadius: 8 }}>
          <Text size="sm" c="text-secondary">
            {t`No orders match the selected filters in the current planning horizon.`}
          </Text>
        </Box>
      ) : (
        <>
          <Text size="xs" c="text-secondary" mb="xs">
            {t`Showing ${data.data.length} orders (${data.total_matching.toLocaleString()} matching in current horizon)`}
          </Text>
          <Box style={{ overflowX: "auto", border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--mb-color-border)", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px" }}>{t`Order ID`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Brewer`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Region`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Size`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Needed by`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Ordered`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Pending`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Proposed`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Uncovered`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Status`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Proposed carrier`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Estimated freight`}</th>
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
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{row.ordered_units.toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{row.pending_units.toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{row.allocated_units.toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: row.uncovered_units > 0 ? 700 : 400 }}>
                      {row.uncovered_units.toLocaleString()}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <StatusBadge status={row.status} />
                    </td>
                    <td style={{ padding: "8px 10px" }}>{row.allocated_units > 0 ? row.carrier : "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>
                      {row.allocated_units > 0
                        ? `₹${Number(row.freight_cost_inr).toLocaleString()}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>

          <Flex justify="space-between" align="center" mt="md">
            <Button
              variant="default"
              disabled={!cursor}
              onClick={() => setCursor(undefined)}
            >
              {t`Back to first page`}
            </Button>
            <Button
              variant="default"
              disabled={!data.has_more || !data.next_cursor}
              onClick={() => data.next_cursor && setCursor(data.next_cursor)}
            >
              {t`Next page`}
            </Button>
          </Flex>
        </>
      )}
    </Box>
  );
}
