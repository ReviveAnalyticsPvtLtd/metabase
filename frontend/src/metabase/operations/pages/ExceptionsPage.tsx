import { useCallback, useEffect, useState } from "react";
import { t } from "ttag";

import { useNavigate, useSearchParams } from "metabase/router";
import { Box, Button, Flex, Group, Select, Text, TextInput, Title } from "metabase/ui";

import { fetchOperationsExceptions } from "../api";
import { SimulationBanner } from "../components/SimulationBanner";
import { StatusBadge } from "../components/StatusBadge";
import type { OrdersListResponse } from "../types";

export function ExceptionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get("q") || "";
  const region = searchParams.get("region") || "";
  const sort = searchParams.get("sort") || "severity";
  const offset = Math.max(0, Number(searchParams.get("offset") || "0") || 0);
  const limit = 50;

  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<OrdersListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOperationsExceptions({
      limit,
      offset,
      region: region || undefined,
      q: q || undefined,
      sort: sort || undefined,
    })
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
  }, [q, region, sort, offset, reloadTick]);

  const updateParam = useCallback(
    (key: string, val: string) => {
      const next = new URLSearchParams(searchParams);
      if (!val) {
        next.delete(key);
      } else {
        next.set(key, val);
      }
      if (key !== "offset") {
        next.delete("offset");
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  return (
    <Box p="lg" maw={1440} mx="auto">
      <Flex justify="space-between" align="center" mb="sm" wrap="wrap" gap="sm">
        <div>
          <Title order={2}>{t`Exceptions & Shortfall Triage`}</Title>
          <Text size="sm" c="text-secondary">
            {t`Prioritized queue of orders with uncovered demand or deadline risk. Open an order to review alternatives.`}
          </Text>
        </div>
        <Button variant="default" onClick={() => navigate("/operations/orders")}>
          {t`All Orders`}
        </Button>
      </Flex>

      <SimulationBanner run={data?.run} disclosures={data?.disclosures} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateParam("q", searchInput.trim());
        }}
      >
        <Flex gap="sm" mb="md" wrap="wrap" align="flex-end">
          <TextInput
            label={t`Search order, Brewer, or reason`}
            placeholder={t`e.g. ORD-000663 or missing lane`}
            value={searchInput}
            onChange={(e) => setSearchInput(e.currentTarget.value)}
            style={{ minWidth: 230 }}
          />
          <Button type="submit" variant="filled">
            {t`Search`}
          </Button>
          <Select
            label={t`Region`}
            placeholder={t`All regions`}
            clearable
            value={region || null}
            onChange={(val) => updateParam("region", val || "")}
            data={["North", "South", "East", "West"]}
          />
          <Select
            label={t`Sort by`}
            value={sort}
            onChange={(val) => updateParam("sort", val || "severity")}
            data={[
              { value: "severity", label: t`Severity (Uncovered first)` },
              { value: "due_asc", label: t`Due date (Earliest first)` },
              { value: "uncovered_desc", label: t`Uncovered kegs (High to low)` },
            ]}
          />
        </Flex>
      </form>

      {error && (
        <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-error)", borderRadius: 8 }}>
          <Flex justify="space-between" align="center" gap="sm" wrap="wrap">
            <Text c="error" fw={600}>{error}</Text>
            <Button size="xs" variant="default" onClick={() => setReloadTick((v) => v + 1)}>
              {t`Retry`}
            </Button>
          </Flex>
        </Box>
      )}

      {loading ? (
        <Text size="sm" c="text-secondary">{t`Loading exceptions...`}</Text>
      ) : !data || data.data.length === 0 ? (
        <Box p="xl" style={{ border: "1px dashed var(--mb-color-border)", borderRadius: 8 }}>
          <Flex justify="space-between" align="center" gap="sm" wrap="wrap">
            <Text size="sm" c="text-secondary">{t`No exceptions match the selected filters.`}</Text>
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={clearFilters}>
                {t`Clear filters`}
              </Button>
              <Button size="xs" variant="subtle" onClick={() => navigate("/operations/orders")}>
                {t`Return to Orders`}
              </Button>
            </Group>
          </Flex>
        </Box>
      ) : (
        <>
          <Text size="xs" c="text-secondary" mb="xs">
            {t`Showing ${offset + 1}–${offset + data.data.length} of ${data.total_matching.toLocaleString()} exception orders`}
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
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Pending`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Proposed`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Uncovered`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Status`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Reason`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Action`}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr
                    key={row.allocation_id}
                    style={{ borderBottom: "1px solid var(--mb-color-border)" }}
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
                    <td style={{ padding: "8px 10px" }}>
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() => navigate(`/operations/orders/${encodeURIComponent(row.order_id)}`)}
                      >
                        {t`Open order`}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
          <Flex justify="space-between" align="center" mt="md">
            <Button
              variant="default"
              disabled={offset === 0}
              onClick={() => updateParam("offset", String(Math.max(0, offset - limit)))}
            >
              {t`Previous`}
            </Button>
            <Button
              variant="default"
              disabled={offset + data.data.length >= data.total_matching}
              onClick={() => updateParam("offset", String(offset + limit))}
            >
              {t`Next`}
            </Button>
          </Flex>
        </>
      )}
    </Box>
  );
}
