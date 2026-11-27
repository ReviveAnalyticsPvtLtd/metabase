import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  FulfillmentMap,
  type MapLineSpec,
  type MapMarkerSpec,
} from "../components/FulfillmentMap";
import { OpsCopilotPanel } from "../components/OpsCopilotPanel";
import { SimulationBanner } from "../components/SimulationBanner";
import { StatusBadge } from "../components/StatusBadge";
import type { OrderQueueItem, OrdersListResponse } from "../types";

function statusColor(status: string): string {
  if (status === "Fully covered") {
    return "#16A34A";
  }
  if (status === "Partially covered") {
    return "#D97706";
  }
  return "#DC2626";
}

export function OrdersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get("q") || "";
  const status = searchParams.get("status") || "";
  const region = searchParams.get("region") || "";
  const kegSize = searchParams.get("keg_size") || "";
  const exceptionsOnly = searchParams.get("exceptions_only") === "true";
  const cursor = searchParams.get("cursor") || undefined;
  const selectedIdParam = searchParams.get("selected") || "";

  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<OrdersListResponse | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderQueueItem | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [showCopilot, setShowCopilot] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  const selectOrder = useCallback(
    (row: OrderQueueItem | null) => {
      setSelectedOrder(row);
      const next = new URLSearchParams(searchParams);
      if (row) {
        next.set("selected", row.order_id);
      } else {
        next.delete("selected");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

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
          const matchFromUrl = selectedIdParam
            ? res.data.find((o) => o.order_id === selectedIdParam)
            : undefined;
          setSelectedOrder((prev) =>
            matchFromUrl ||
            (prev && res.data.find((o) => o.order_id === prev.order_id)) ||
            res.data[0] ||
            null,
          );
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
  }, [q, status, region, kegSize, exceptionsOnly, cursor, reloadTick, selectedIdParam]);

  const updateFilter = useCallback(
    (key: string, value: string | boolean) => {
      const next = new URLSearchParams(searchParams);
      if (value === "" || value === false) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
      next.delete("cursor");
      setCursorHistory([]);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const clearAllFilters = useCallback(() => {
    setCursorHistory([]);
    setSearchInput("");
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const goToNextPage = useCallback(() => {
    if (!data?.next_cursor) {
      return;
    }
    setCursorHistory((prev) => [...prev, cursor || ""]);
    const next = new URLSearchParams(searchParams);
    next.set("cursor", data.next_cursor);
    setSearchParams(next);
  }, [data?.next_cursor, cursor, searchParams, setSearchParams]);

  const goToPrevPage = useCallback(() => {
    const prevCursor = cursorHistory[cursorHistory.length - 1];
    setCursorHistory((prev) => prev.slice(0, -1));
    const next = new URLSearchParams(searchParams);
    if (!prevCursor) {
      next.delete("cursor");
    } else {
      next.set("cursor", prevCursor);
    }
    setSearchParams(next);
  }, [cursorHistory, searchParams, setSearchParams]);

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      updateFilter("q", searchInput.trim());
    },
    [searchInput, updateFilter],
  );

  const { mapMarkers, mapLines } = useMemo(() => {
    const rows = data?.data || [];
    const markers: MapMarkerSpec[] = [];
    const lines: MapLineSpec[] = [];

    // Aggregate orders by region so the overview map never overlaps 50 destination pins
    const byRegion = new Map<
      string,
      { latSum: number; lngSum: number; coordCnt: number; orders: number; uncoveredKegs: number }
    >();
    for (const row of rows) {
      const reg = row.region || "Other";
      const cur = byRegion.get(reg) || {
        latSum: 0,
        lngSum: 0,
        coordCnt: 0,
        orders: 0,
        uncoveredKegs: 0,
      };
      cur.orders += 1;
      cur.uncoveredKegs += Number(row.uncovered_units || 0);
      if (row.dest_lat != null && row.dest_lng != null) {
        cur.latSum += Number(row.dest_lat);
        cur.lngSum += Number(row.dest_lng);
        cur.coordCnt += 1;
      }
      byRegion.set(reg, cur);
    }

    for (const [reg, agg] of byRegion.entries()) {
      if (agg.coordCnt === 0) {
        continue;
      }
      markers.push({
        id: `region-${reg}`,
        lat: agg.latSum / agg.coordCnt,
        lng: agg.lngSum / agg.coordCnt,
        label: `${reg} Region (${agg.orders} orders)`,
        badgeText: agg.uncoveredKegs > 0 ? `${agg.uncoveredKegs.toLocaleString()} uncovered` : "Covered",
        sublabel: `Click to filter by ${reg} region`,
        color: agg.uncoveredKegs > 0 ? "#D97706" : "#16A34A",
        radius: 9,
        selected: region === reg,
        onClick: () => updateFilter("region", region === reg ? "" : reg),
      });
    }

    // Reveal individual source & destination pins ONLY for the selected order
    if (selectedOrder && selectedOrder.dest_lat != null && selectedOrder.dest_lng != null) {
      markers.push({
        id: `sel-dest-${selectedOrder.order_id}`,
        lat: Number(selectedOrder.dest_lat),
        lng: Number(selectedOrder.dest_lng),
        label: `Destination: ${selectedOrder.order_id} · ${selectedOrder.destination_brewer}`,
        badgeText: selectedOrder.status,
        sublabel: `${selectedOrder.keg_size} · Pending ${selectedOrder.pending_units} · Proposed ${selectedOrder.allocated_units}`,
        color: statusColor(selectedOrder.status),
        radius: 10,
        selected: true,
      });
    }

    if (
      selectedOrder &&
      selectedOrder.allocated_units > 0 &&
      selectedOrder.src_lat != null &&
      selectedOrder.src_lng != null &&
      selectedOrder.dest_lat != null &&
      selectedOrder.dest_lng != null
    ) {
      markers.push({
        id: `sel-src-${selectedOrder.order_id}`,
        lat: Number(selectedOrder.src_lat),
        lng: Number(selectedOrder.src_lng),
        label: `Source: ${selectedOrder.source_hub}`,
        badgeText: selectedOrder.src_role || "Source",
        sublabel: `Ships ${selectedOrder.allocated_units} ${selectedOrder.keg_size} kegs via ${selectedOrder.carrier}`,
        color: "#2563EB",
        radius: 10,
        selected: true,
      });

      lines.push({
        id: `line-${selectedOrder.order_id}`,
        fromLat: Number(selectedOrder.src_lat),
        fromLng: Number(selectedOrder.src_lng),
        toLat: Number(selectedOrder.dest_lat),
        toLng: Number(selectedOrder.dest_lng),
        color: "#2563EB",
        dashed: true,
        highlighted: true,
        label: `${selectedOrder.source_hub} → ${selectedOrder.destination_brewer} (${selectedOrder.distance_km} km modeled)`,
      });
    }

    return { mapMarkers: markers, mapLines: lines };
  }, [data, selectedOrder, region, updateFilter]);

  return (
    <Box p="lg" maw={1560} mx="auto">
      <Flex justify="space-between" align="center" mb="sm" wrap="wrap" gap="sm">
        <div>
          <Title order={2}>{t`Order Fulfillment Workspace`}</Title>
          <Text size="sm" c="text-secondary">
            {t`Select an order on the map or queue to preview its modeled source route, or open full evidence & trade-offs.`}
          </Text>
        </div>
        <Group gap="xs">
          <Button variant="default" onClick={() => setShowMap((v) => !v)}>
            {showMap ? t`Hide Map` : t`Show Map`}
          </Button>
          <Button variant="default" onClick={() => setShowCopilot((v) => !v)}>
            {showCopilot ? t`Hide Plan Explanation` : t`Plan Explanation`}
          </Button>
          <Button variant="default" onClick={() => navigate("/operations/scenarios")}>
            {t`Scenario Lab`}
          </Button>
          <Button
            variant="default"
            style={{
              backgroundColor: "#FCE8E6",
              color: "#C5221F",
              borderColor: "#FAD2CF",
            }}
            onClick={() => navigate("/operations/exceptions")}
          >
            {data?.run?.orders_uncovered != null
              ? t`Exceptions (${data.run.orders_uncovered + (data.run.orders_partially_covered || 0)})`
              : t`Exceptions`}
          </Button>
        </Group>
      </Flex>

      <SimulationBanner run={data?.run} disclosures={data?.disclosures} />

      {showCopilot && <OpsCopilotPanel compact />}

      <form onSubmit={handleSearchSubmit}>
        <Flex gap="sm" mb="md" wrap="wrap" align="flex-end">
          <TextInput
            label={t`Search order or Brewer`}
            placeholder={t`e.g. ORD-000663 or Bhubaneswar`}
            value={searchInput}
            onChange={(e) => setSearchInput(e.currentTarget.value)}
            style={{ minWidth: 230 }}
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
          <Flex justify="space-between" align="center" gap="sm" wrap="wrap">
            <Text c="error" fw={600}>
              {error}
            </Text>
            <Button size="xs" variant="default" onClick={() => setReloadTick((v) => v + 1)}>
              {t`Retry`}
            </Button>
          </Flex>
        </Box>
      )}

      {loading ? (
        <Box p="xl">
          <Text size="sm" c="text-secondary">
            {t`Loading proposed fulfillment queue & network map...`}
          </Text>
        </Box>
      ) : !data || data.data.length === 0 ? (
        <Box p="xl" style={{ border: "1px dashed var(--mb-color-border)", borderRadius: 8 }}>
          <Flex justify="space-between" align="center" gap="sm" wrap="wrap">
            <Text size="sm" c="text-secondary">
              {t`No orders match the selected filters in the current planning horizon.`}
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={clearAllFilters}>
                {t`Clear filters`}
              </Button>
              <Button size="xs" variant="subtle" onClick={() => setReloadTick((v) => v + 1)}>
                {t`Retry`}
              </Button>
            </Group>
          </Flex>
        </Box>
      ) : (
        <>
          {showMap && (
            <Box mb="md">
              <FulfillmentMap
                markers={mapMarkers}
                lines={mapLines}
                height={340}
                fitKey={selectedOrder?.order_id || `orders-${region || "all"}`}
                title={t`Regional Order Summary & Selected Route Preview`}
                subtitle={t`Regional clusters summarize page orders; individual pins show the selected order only (schematic distance, not road GPS).`}
                legendItems={[
                  { label: t`Selected Source Hub`, color: "#2563EB" },
                  { label: t`Fully covered`, color: "#16A34A" },
                  { label: t`Partially covered`, color: "#D97706" },
                  { label: t`Needs attention`, color: "#DC2626" },
                ]}
              />
              {selectedOrder && (
                <Flex
                  justify="space-between"
                  align="center"
                  p="sm"
                  mt="xs"
                  wrap="wrap"
                  gap="sm"
                  style={{
                    border: "1px solid var(--mb-color-border)",
                    borderRadius: 8,
                    backgroundColor: "var(--mb-color-background-secondary)",
                  }}
                >
                  <Group gap="sm" wrap="wrap">
                    <Text fw={700} size="sm">{selectedOrder.order_id}</Text>
                    <StatusBadge status={selectedOrder.status} />
                    <Text size="sm">
                      {selectedOrder.allocated_units > 0
                        ? t`${selectedOrder.source_hub} (${selectedOrder.src_role || "Hub"}) → ${selectedOrder.destination_brewer} · ${selectedOrder.allocated_units} ${selectedOrder.keg_size} kegs · ₹${Number(selectedOrder.freight_cost_inr).toLocaleString()}`
                        : t`${selectedOrder.destination_brewer} · ${selectedOrder.uncovered_units} ${selectedOrder.keg_size} kegs uncovered`}
                    </Text>
                  </Group>
                  <Button
                    size="xs"
                    variant="filled"
                    onClick={() => navigate(`/operations/orders/${encodeURIComponent(selectedOrder.order_id)}`)}
                  >
                    {t`Open order →`}
                  </Button>
                </Flex>
              )}
            </Box>
          )}

          <Flex justify="space-between" align="center" mb="xs" wrap="wrap" gap="xs">
            <Text size="xs" c="text-secondary">
              {(() => {
                const start = cursorHistory.length * 50 + 1;
                const end = cursorHistory.length * 50 + data.data.length;
                return t`Showing ${start}–${end} of ${data.total_matching.toLocaleString()} orders`;
              })()}
            </Text>
            <Text size="xs" c="text-secondary">
              {t`Sorted: Fulfilled first (Fully covered → Partial → Needs attention)`}
            </Text>
          </Flex>
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
                  <th style={{ padding: "8px 10px" }}>{t`Source Hub`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Carrier`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Est. Freight`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Action`}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => {
                  const isSel = selectedOrder?.order_id === row.order_id;
                  return (
                    <tr
                      key={row.allocation_id}
                      onClick={() => selectOrder(row)}
                      style={{
                        cursor: "pointer",
                        borderBottom: "1px solid var(--mb-color-border)",
                        backgroundColor: isSel ? "rgba(37, 99, 235, 0.06)" : undefined,
                      }}
                    >
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{row.order_id}</td>
                      <td style={{ padding: "8px 10px" }}>{row.destination_brewer}</td>
                      <td style={{ padding: "8px 10px" }}>{row.region}</td>
                      <td style={{ padding: "8px 10px" }}>{row.keg_size}</td>
                      <td style={{ padding: "8px 10px" }}>{String(row.needed_by).slice(0, 10)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{row.pending_units.toLocaleString()}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{row.allocated_units.toLocaleString()}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: row.uncovered_units > 0 ? 700 : 400 }}>
                        {row.uncovered_units.toLocaleString()}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <StatusBadge status={row.status} />
                      </td>
                      <td style={{ padding: "8px 10px" }}>{row.allocated_units > 0 ? row.source_hub : "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{row.allocated_units > 0 ? row.carrier : "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>
                        {row.allocated_units > 0
                          ? `₹${Number(row.freight_cost_inr).toLocaleString()}`
                          : "—"}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <Button
                          size="xs"
                          variant="default"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/operations/orders/${encodeURIComponent(row.order_id)}`);
                          }}
                        >
                          {t`Open order`}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>

          <Flex justify="space-between" align="center" mt="md">
            <Button
              variant="default"
              disabled={cursorHistory.length === 0}
              onClick={goToPrevPage}
            >
              {t`Previous`}
            </Button>
            <Button
              variant="default"
              disabled={!data.has_more || !data.next_cursor}
              onClick={goToNextPage}
            >
              {t`Next`}
            </Button>
          </Flex>
        </>
      )}
    </Box>
  );
}
