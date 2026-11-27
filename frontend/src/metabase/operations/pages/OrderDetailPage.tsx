import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "ttag";

import { useNavigate, useParams } from "metabase/router";
import {
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Text,
  Title,
} from "metabase/ui";

import {
  fetchOrderAlternatives,
  fetchOrderCounterfactual,
  fetchOrderDetail,
  proposeOrderOverride,
} from "../api";
import {
  FulfillmentMap,
  type MapLineSpec,
  type MapMarkerSpec,
} from "../components/FulfillmentMap";
import { OpsCopilotPanel } from "../components/OpsCopilotPanel";
import { SimulationBanner } from "../components/SimulationBanner";
import { StatusBadge } from "../components/StatusBadge";
import type {
  OrderAlternative,
  OrderAlternativesResponse,
  OrderCounterfactualResponse,
  OrderDetailResponse,
  OrderOverrideResponse,
} from "../types";

export function OrderDetailPage() {
  const navigate = useNavigate();
  const { orderId = "" } = useParams<{ orderId: string }>();

  const [detail, setDetail] = useState<OrderDetailResponse | null>(null);
  const [alts, setAlts] = useState<OrderAlternativesResponse | null>(null);
  const [counterfactual, setCounterfactual] = useState<OrderCounterfactualResponse | null>(null);
  const [overrideDraft, setOverrideDraft] = useState<OrderOverrideResponse | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [inspectedCandId, setInspectedCandId] = useState<number | null>(null);
  const [hoveredAlt, setHoveredAlt] = useState<OrderAlternative | null>(null);
  const [showAltPins, setShowAltPins] = useState(false);
  const [showAllOptionsTable, setShowAllOptionsTable] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [cfLoading, setCfLoading] = useState(false);
  const [cfError, setCfError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tradeoffRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!orderId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCounterfactual(null);
    setInspectedCandId(null);
    setHoveredAlt(null);
    setCfError(null);
    Promise.all([
      fetchOrderDetail(orderId),
      fetchOrderAlternatives(orderId).catch(() => null),
    ])
      .then(([d, a]) => {
        if (!cancelled) {
          setDetail(d);
          setAlts(a);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t`Order not found.`);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const handleInspectTradeoff = (candidateRouteId: number) => {
    setInspectedCandId(candidateRouteId);
    setCfLoading(true);
    setCfError(null);
    setTimeout(() => {
      tradeoffRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 30);
    fetchOrderCounterfactual(orderId, candidateRouteId)
      .then((res) => {
        setCounterfactual(res);
        setCfLoading(false);
      })
      .catch((err) => {
        setCfError(err instanceof Error ? err.message : t`Could not load trade-off analysis.`);
        setCfLoading(false);
      });
  };

  const { mapMarkers, mapLines } = useMemo(() => {
    if (!detail) {
      return { mapMarkers: [], mapLines: [] };
    }
    const ord = detail.order;
    const markers: MapMarkerSpec[] = [];
    const lines: MapLineSpec[] = [];

    if (ord.dest_lat != null && ord.dest_lng != null) {
      markers.push({
        id: `dest-${ord.destination_customer_id}`,
        lat: Number(ord.dest_lat),
        lng: Number(ord.dest_lng),
        label: `Destination: ${ord.destination_brewer}`,
        badgeText: "Brewer",
        sublabel: `${ord.dest_city || ""}${ord.dest_state ? `, ${ord.dest_state}` : ""} · Needed ${String(ord.needed_by).slice(0, 10)}`,
        color: "#7C3AED",
        radius: 10,
        selected: true,
      });
    }

    if (ord.allocated_units > 0 && ord.src_lat != null && ord.src_lng != null) {
      markers.push({
        id: `src-${ord.source_customer_id}`,
        lat: Number(ord.src_lat),
        lng: Number(ord.src_lng),
        label: `Selected Source: ${ord.source_hub}`,
        badgeText: ord.src_role || "Source",
        sublabel: `${ord.src_city || ""}${ord.src_state ? `, ${ord.src_state}` : ""} · ${ord.allocated_units} ${ord.keg_size} kegs via ${ord.carrier}`,
        color: "#2563EB",
        radius: 10,
        selected: true,
      });

      if (ord.dest_lat != null && ord.dest_lng != null) {
        lines.push({
          id: "selected-leg",
          fromLat: Number(ord.src_lat),
          fromLng: Number(ord.src_lng),
          toLat: Number(ord.dest_lat),
          toLng: Number(ord.dest_lng),
          color: "#2563EB",
          dashed: true,
          highlighted: true,
          label: `Selected: ${ord.source_hub} → ${ord.destination_brewer} (${ord.distance_km} km modeled · ~${ord.transit_days}d)`,
        });
      }
    }

    if (showAltPins && alts?.alternatives) {
      const seenSources = new Set<string>();
      if (ord.source_customer_id) {
        seenSources.add(ord.source_customer_id);
      }
      for (const alt of alts.alternatives) {
        if (alt.selected || alt.src_lat == null || alt.src_lng == null) {
          continue;
        }
        const isHoveredOrInspected =
          hoveredAlt?.source_customer_id === alt.source_customer_id ||
          inspectedCandId === alt.candidate_route_id;

        if (!seenSources.has(alt.source_customer_id)) {
          seenSources.add(alt.source_customer_id);
          const altColor =
            alt.reason_code === "POLICY_EXCLUDED_PEER_BREWER" || !alt.feasible
              ? "#DC2626"
              : "#D97706";
          markers.push({
            id: `alt-${alt.source_customer_id}`,
            lat: Number(alt.src_lat),
            lng: Number(alt.src_lng),
            label: `Alternative: ${alt.source_name}`,
            badgeText: alt.source_role || "Candidate",
            sublabel: `${alt.carrier_name} · ${alt.distance_km} km · ₹${Number(alt.freight_cost_inr).toLocaleString()} · ${alt.rejection_reason || ""}`,
            color: altColor,
            radius: isHoveredOrInspected ? 10 : 6,
            selected: isHoveredOrInspected,
            onClick:
              alt.candidate_route_id > 0
                ? () => handleInspectTradeoff(alt.candidate_route_id)
                : undefined,
          });
        }

        if (
          isHoveredOrInspected &&
          ord.dest_lat != null &&
          ord.dest_lng != null
        ) {
          lines.push({
            id: `alt-line-${alt.evidence_id}`,
            fromLat: Number(alt.src_lat),
            fromLng: Number(alt.src_lng),
            toLat: Number(ord.dest_lat),
            toLng: Number(ord.dest_lng),
            color: "#D97706",
            dashed: true,
            highlighted: true,
            label: `Alternative: ${alt.source_name} → ${ord.destination_brewer} (${alt.distance_km} km · ₹${Number(alt.freight_cost_inr).toLocaleString()})`,
          });
        }
      }
    }

    return { mapMarkers: markers, mapLines: lines };
  }, [detail, alts, showAltPins, hoveredAlt, inspectedCandId]);

  if (loading) {
    return (
      <Box p="lg" maw={1440} mx="auto">
        <Text size="sm" c="text-secondary">
          {t`Loading order fulfillment details & map...`}
        </Text>
      </Box>
    );
  }

  if (error || !detail) {
    return (
      <Box p="lg" maw={1440} mx="auto">
        <Button variant="default" mb="md" onClick={() => navigate("/operations/orders")}>
          {t`Back to Orders`}
        </Button>
        <Box p="md" style={{ border: "1px solid var(--mb-color-error)", borderRadius: 8 }}>
          <Text c="error" fw={600}>
            {error || t`Order could not be loaded.`}
          </Text>
        </Box>
      </Box>
    );
  }

  const { order, run, disclosures, consistency_check, planning_policy } = detail;

  return (
    <Box p="lg" maw={1440} mx="auto">
      <Flex justify="space-between" align="center" mb="sm" wrap="wrap" gap="sm">
        <Group gap="sm">
          <Button variant="default" onClick={() => navigate("/operations/orders")}>
            {t`Back to Orders`}
          </Button>
          <Title order={2}>{order.order_id}</Title>
          <StatusBadge status={order.status} />
        </Group>
        <Group gap="sm">
          <Text size="sm" c="text-secondary">
            {t`${order.destination_brewer} · ${order.region} · ${order.keg_size} · Needed by ${String(order.needed_by).slice(0, 10)}`}
          </Text>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setShowDiagnostics((v) => !v)}
          >
            {showDiagnostics ? t`Hide Audit Details` : t`View Audit Evidence`}
          </Button>
        </Group>
      </Flex>

      <SimulationBanner run={run} disclosures={disclosures} />

      {showDiagnostics && (
        <Box
          p="sm"
          mb="md"
          style={{
            border: "1px dashed var(--mb-color-border)",
            borderRadius: 8,
            backgroundColor: "var(--mb-color-background-secondary)",
          }}
        >
          <Text size="xs" fw={600} mb={4}>{t`Technical Provenance & Diagnostics`}</Text>
          <Text size="xs" c="text-secondary">
            {`Run: ${run.run_id} · Mode: ${planning_policy?.mode || "MODE_A_ORDER_LEVEL"} · Policy: ${planning_policy?.source_policy || "depot_first"} · Objective: ${planning_policy?.objective_policy || "—"} · Stage: ${planning_policy?.decision_stage || "—"} · Solver: ${run.diagnostic?.solver_status || "—"}`}
          </Text>
        </Box>
      )}

      {!order.reconciled && (
        <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-error)", borderRadius: 8 }}>
          <Text c="error" fw={600}>
            {t`Data-quality warning: ordered, fulfilled, proposed, and uncovered quantities do not reconcile.`}
          </Text>
        </Box>
      )}

      {consistency_check && !consistency_check.passed && (
        <Box p="md" mb="md" style={{ border: "1px solid #F29900", backgroundColor: "#FEF7E0", borderRadius: 8 }}>
          <Text fw={600} style={{ color: "#B06000" }}>
            {t`Evidence consistency warning: ${consistency_check.warnings.join(" ")}`}
          </Text>
        </Box>
      )}

      {/* Quantity Summary */}
      <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
        <Title order={4} mb="sm">{t`Quantity summary`}</Title>
        <Flex gap="xl" wrap="wrap">
          <div>
            <Text size="xs" c="text-secondary">{t`Ordered`}</Text>
            <Text size="lg" fw={700}>{order.ordered_units.toLocaleString()}</Text>
          </div>
          <div>
            <Text size="xs" c="text-secondary">{t`Previously fulfilled`}</Text>
            <Text size="lg" fw={700}>{order.fulfilled_units.toLocaleString()}</Text>
          </div>
          <div>
            <Text size="xs" c="text-secondary">{t`Still pending`}</Text>
            <Text size="lg" fw={700}>{order.pending_units.toLocaleString()}</Text>
          </div>
          <div>
            <Text size="xs" c="text-secondary">{t`Proposed now`}</Text>
            <Text size="lg" fw={700} style={{ color: "var(--mb-color-brand)" }}>
              {order.allocated_units.toLocaleString()}
            </Text>
          </div>
          <div>
            <Text size="xs" c="text-secondary">{t`Still uncovered`}</Text>
            <Text size="lg" fw={700} c={order.uncovered_units > 0 ? "red" : undefined}>
              {order.uncovered_units.toLocaleString()}
            </Text>
          </div>
        </Flex>
      </Box>

      {/* Interactive Route Map + Timeline */}
      <Flex gap="md" mb="md" wrap="wrap" align="stretch">
        <Box style={{ flex: "1.4 1 520px" }}>
          <Flex justify="space-between" align="center" mb="xs">
            <Text size="xs" c="text-secondary">
              {showAltPins
                ? t`Showing selected route plus evaluated alternative sources.`
                : t`Showing selected source and destination Brewer.`}
            </Text>
            <Button size="xs" variant="subtle" onClick={() => setShowAltPins((v) => !v)}>
              {showAltPins ? t`Show selected route only` : t`Compare options on map`}
            </Button>
          </Flex>
          <FulfillmentMap
            markers={mapMarkers}
            lines={mapLines}
            height={360}
            fitKey={orderId}
            title={t`Proposed Fulfillment Route`}
            subtitle={t`Schematic connection — not a road route (${order.distance_km} km modeled; road routing provider pending approval)`}
            legendItems={[
              { label: t`Selected Source`, color: "#2563EB" },
              { label: t`Destination Brewer`, color: "#7C3AED" },
              ...(showAltPins
                ? [
                    { label: t`Alternative (Stock Committed)`, color: "#D97706" },
                    { label: t`Ineligible / Deadline`, color: "#DC2626" },
                  ]
                : []),
            ]}
          />
        </Box>

        <Box p="md" style={{ flex: "1 1 360px", border: "1px solid var(--mb-color-border)", borderRadius: 10 }}>
          <Title order={4} mb="sm">{t`Proposed journey & timeline`}</Title>
          <Box mb="md">
            <Flex align="center" gap="xs" wrap="wrap" mb="xs">
              <Badge style={{ backgroundColor: "#E8F0FE", color: "#1967D2", textTransform: "none" }}>
                {order.src_role || t`Source`}
              </Badge>
              <Text fw={600} size="sm">{order.source_hub}</Text>
            </Flex>
            <Text size="xs" c="text-secondary" mb="xs">
              {`↓ ${order.distributor_mode === "physical_stop" ? t`Physical stop` : t`Coordinated via`} ${order.distributor || "Unassigned"} · ${order.allocated_units > 0 ? `${order.carrier} · ₹${Number(order.freight_cost_inr || 0).toLocaleString()}` : t`No carrier assigned`}`}
            </Text>
            <Flex align="center" gap="xs" wrap="wrap">
              <Badge style={{ backgroundColor: "#EDE7F6", color: "#4527A0", textTransform: "none" }}>
                {t`Destination Brewer`}
              </Badge>
              <Text fw={600} size="sm">{order.destination_brewer}</Text>
            </Flex>
          </Box>

          <Title order={5} mb="xs">{t`Timing & feasibility`}</Title>
          {order.timeline.map((item) => (
            <Flex key={item.label} justify="space-between" py={5} style={{ borderBottom: "1px solid var(--mb-color-border)" }}>
              <Text size="sm" fw={500}>{item.label}</Text>
              <Group gap="xs">
                <Text size="sm" c={(item as any).overdue_vs_as_of ? "red" : undefined}>
                  {item.date
                    ? String(item.date).slice(0, 10)
                    : item.days !== undefined
                    ? `${item.days} day(s)`
                    : item.feasible !== undefined
                    ? (item as any).overdue_vs_as_of
                      ? t`Overdue vs. planning as-of`
                      : item.feasible
                      ? t`Within window`
                      : t`Outside window`
                    : "—"}
                </Text>
                <Badge
                  size="xs"
                  style={{
                    backgroundColor: "#F1F3F4",
                    color: "#3C4043",
                    border: "1px solid #DADCE0",
                    textTransform: "none",
                  }}
                >
                  {item.basis}
                </Badge>
              </Group>
            </Flex>
          ))}
        </Box>
      </Flex>

      {/* Why this plan? */}
      <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
        <Flex justify="space-between" align="center" mb={showWhy ? "xs" : 0}>
          <Title order={4}>{t`Why this plan?`}</Title>
          <Button variant="subtle" size="xs" onClick={() => setShowWhy((v) => !v)}>
            {showWhy ? t`Hide` : t`Expand`}
          </Button>
        </Flex>
        {showWhy && (
          <>
            <Text size="sm" mb="xs">{order.why_this_plan}</Text>
            <Group gap="md" wrap="wrap">
              <Text size="xs" c="text-secondary">
                {t`Source policy: ${planning_policy?.source_policy_label || t`Depot-First — approved facilities and distributors`}`}
              </Text>
              {order.cost_formula && (
                <Text size="xs" c="text-secondary">
                  {t`Cost basis: ${order.cost_formula}`}
                </Text>
              )}
            </Group>
          </>
        )}
      </Box>

      {/* Embedded Order-Scoped AI Copilot */}
      <OpsCopilotPanel orderId={order.order_id} compact />

      {/* Evaluated Options: Recommended + Top 2 Decision Cards, with expandable full table */}
      <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 8 }} ref={tradeoffRef}>
        <Flex justify="space-between" align="center" mb={4} wrap="wrap" gap="xs">
          <Title order={4}>{t`Compare fulfillment options`}</Title>
          {alts && alts.alternatives.length > 0 && (
            <Button size="xs" variant="subtle" onClick={() => setShowAllOptionsTable((v) => !v)}>
              {showAllOptionsTable
                ? t`Hide full comparison table`
                : t`All evaluated options (${alts.alternatives.length})`}
            </Button>
          )}
        </Flex>
        <Text size="xs" c="text-secondary" mb="sm">
          {alts && alts.truncated
            ? t`Showing ${alts.returned_count ?? alts.alternatives.length} of ${alts.evaluated_count ?? alts.alternatives.length} evaluated options${alts.omitted_count ? ` (${alts.omitted_count} farther sources omitted)` : ""}.`
            : t`Showing ${alts?.alternatives.length ?? 0} evaluated options for this order.`}
        </Text>

        {alts && alts.alternatives.length > 0 && (
          <Flex gap="sm" mb="md" wrap="wrap">
            {alts.alternatives.slice(0, 3).map((alt) => {
              const isInspected = inspectedCandId === alt.candidate_route_id && alt.candidate_route_id > 0;
              return (
                <Box
                  key={alt.evidence_id}
                  p="sm"
                  style={{
                    flex: "1 1 260px",
                    border: alt.selected
                      ? "2px solid #16A34A"
                      : isInspected
                      ? "2px solid #1967D2"
                      : "1px solid var(--mb-color-border)",
                    borderRadius: 8,
                    backgroundColor: "var(--mb-color-background-secondary)",
                  }}
                >
                  <Flex justify="space-between" align="center" mb={4} gap="xs">
                    <Text fw={700} size="sm">{alt.source_name}</Text>
                    <Badge
                      size="xs"
                      style={
                        alt.selected
                          ? { backgroundColor: "#E6F4EA", color: "#137333", textTransform: "none" }
                          : { backgroundColor: "#F1F3F4", color: "#3C4043", textTransform: "none" }
                      }
                    >
                      {alt.selected ? t`Recommended` : alt.source_role || t`Alternative`}
                    </Badge>
                  </Flex>
                  <Text size="xs" c="text-secondary" mb={4}>
                    {`${alt.carrier_name} · ${alt.candidate_quantity ?? order.pending_units} kegs · ${alt.distance_km} km · ₹${Number(alt.freight_cost_inr).toLocaleString()}`}
                  </Text>
                  <Text size="xs" mb="xs">
                    {alt.rejection_reason || (alt.selected ? t`Selected in active plan` : "—")}
                  </Text>
                  {!alt.selected && alt.candidate_route_id > 0 && (
                    <Button
                      size="xs"
                      variant={isInspected ? "filled" : "default"}
                      loading={cfLoading && isInspected}
                      onClick={() => handleInspectTradeoff(alt.candidate_route_id)}
                    >
                      {isInspected ? t`Impact shown below` : t`Check network impact`}
                    </Button>
                  )}
                </Box>
              );
            })}
          </Flex>
        )}

        {cfLoading && (
          <Box
            p="sm"
            mb="sm"
            style={{
              border: "1px solid #1967D2",
              backgroundColor: "#E8F0FE",
              borderRadius: 6,
            }}
          >
            <Text size="sm" fw={600} style={{ color: "#1967D2" }}>
              {t`Running counterfactual trade-off analysis for selected candidate...`}
            </Text>
          </Box>
        )}
        {cfError && (
          <Text size="xs" c="error" mb="sm">{cfError}</Text>
        )}
        {counterfactual && (
          <Box
            p="md"
            mb="md"
            style={{
              border: "2px solid #1967D2",
              backgroundColor: "var(--mb-color-background-secondary)",
              borderRadius: 8,
            }}
            data-testid="counterfactual-tradeoff-panel"
          >
            <Flex justify="space-between" align="center" mb="xs" wrap="wrap" gap="xs">
              <Text fw={700} size="sm">
                {t`Trade-Off Inspection: ${counterfactual.target_source_name} via ${counterfactual.carrier_name}`}
              </Text>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="light"
                  loading={overrideLoading}
                  onClick={() => {
                    setOverrideLoading(true);
                    proposeOrderOverride(order.order_id, {
                      source_customer_id: counterfactual.target_source_id,
                      carrier: counterfactual.carrier_name,
                      quantity: order.pending_units,
                    })
                      .then((res) => {
                        setOverrideDraft(res);
                        setOverrideLoading(false);
                      })
                      .catch((err) => {
                        setCfError(err instanceof Error ? err.message : t`Override failed`);
                        setOverrideLoading(false);
                      });
                  }}
                >
                  {t`Try another option (Draft Override)`}
                </Button>
                <Button variant="subtle" size="xs" onClick={() => { setCounterfactual(null); setInspectedCandId(null); setOverrideDraft(null); }}>
                  {t`Close`}
                </Button>
              </Group>
            </Flex>
            <Text size="sm" mb="xs">{counterfactual.conclusion}</Text>
            <Group gap="lg" mb="xs" wrap="wrap">
              {counterfactual.solver_status && (
                <Text size="xs" c="text-secondary">
                  {t`Solver: ${counterfactual.solver_status}`}
                </Text>
              )}
              {counterfactual.kegs_delta != null && (
                <Text size="xs" c="text-secondary">
                  {t`Plan Kegs Delta: ${counterfactual.kegs_delta >= 0 ? "+" : ""}${counterfactual.kegs_delta.toLocaleString()}`}
                </Text>
              )}
              {counterfactual.freight_delta_inr != null && (
                <Text size="xs" c="text-secondary">
                  {t`Plan Freight Delta: ${counterfactual.freight_delta_inr >= 0 ? "+" : ""}₹${Number(counterfactual.freight_delta_inr).toLocaleString()}`}
                </Text>
              )}
              {counterfactual.uncovered_delta != null && (
                <Text size="xs" c="text-secondary">
                  {t`Uncovered Orders Delta: ${counterfactual.uncovered_delta >= 0 ? "+" : ""}${counterfactual.uncovered_delta}`}
                </Text>
              )}
            </Group>
            {overrideDraft && (
              <Box p="xs" my="xs" style={{ border: "1px solid #137333", backgroundColor: "#E6F4EA", borderRadius: 6 }}>
                <Text size="xs" fw={700} style={{ color: "#137333" }}>
                  {overrideDraft.ok
                    ? t`Draft Override Re-Solved (Active Plan Unchanged): ${overrideDraft.forced_qty} kegs from ${overrideDraft.target_source_name}, plan freight delta ${overrideDraft.freight_delta_inr != null && overrideDraft.freight_delta_inr >= 0 ? "+" : ""}₹${Number(overrideDraft.freight_delta_inr || 0).toLocaleString()}, ${overrideDraft.affected_orders_total ?? 0} order(s) affected.`
                    : t`Draft Override Blocked: ${overrideDraft.error}`}
                </Text>
              </Box>
            )}
            {counterfactual.affected_orders.length > 0 && (
              <Group gap="xs" wrap="wrap">
                <Text size="xs" c="text-secondary">{t`Affected orders in re-solve:`}</Text>
                {counterfactual.affected_orders.slice(0, 6).map((ao) => (
                  <Button
                    key={ao.order_id}
                    size="xs"
                    variant="default"
                    onClick={() => navigate(`/operations/orders/${ao.order_id}`)}
                  >
                    {`${ao.order_id} (${ao.allocated_delta_kegs != null ? `${ao.allocated_delta_kegs >= 0 ? "+" : ""}${ao.allocated_delta_kegs}` : ao.allocated_units} kegs)`}
                  </Button>
                ))}
              </Group>
            )}
          </Box>
        )}

        {!alts || alts.alternatives.length === 0 ? (
          <Text size="sm" c="text-secondary">
            {alts?.evidence_status === "empty"
              ? t`No alternative evidence was recorded for this order.`
              : t`Alternative evidence is unavailable for this plan.`}
          </Text>
        ) : showAllOptionsTable ? (
          <Box style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--mb-color-border)", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px" }}>{t`Source`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Role`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Carrier`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Qty`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Stock (Avail/Rem)`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Distance`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Transit / Slack`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Est. Freight`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Decision`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Reason`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Trade-off`}</th>
                </tr>
              </thead>
              <tbody>
                {alts.alternatives.map((alt) => {
                  const isInspected = inspectedCandId === alt.candidate_route_id && alt.candidate_route_id > 0;
                  return (
                    <tr
                      key={alt.evidence_id}
                      onMouseEnter={() => setHoveredAlt(alt)}
                      onMouseLeave={() => setHoveredAlt(null)}
                      style={{
                        borderBottom: "1px solid var(--mb-color-border)",
                        backgroundColor: isInspected
                          ? "rgba(25, 103, 210, 0.08)"
                          : alt.selected
                          ? "rgba(22, 163, 74, 0.05)"
                          : undefined,
                      }}
                    >
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ fontWeight: 600 }}>{alt.source_name}</div>
                        <Text size="xs" c="text-secondary">{alt.source_customer_id}</Text>
                      </td>
                      <td style={{ padding: "8px 10px" }}>{alt.source_role || "—"}</td>
                      <td style={{ padding: "8px 10px" }}>{alt.carrier_name}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>
                        {alt.candidate_quantity != null ? alt.candidate_quantity.toLocaleString() : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>
                        {alt.stock_available_kegs != null
                          ? `${alt.stock_available_kegs} / ${alt.stock_remaining_kegs ?? "—"}`
                          : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{`${alt.distance_km} km`}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{`${alt.transit_days}d / ${alt.slack_days}d`}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{`₹${Number(alt.freight_cost_inr).toLocaleString()}`}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <Badge
                          size="sm"
                          style={
                            alt.selected
                              ? {
                                  backgroundColor: "#E6F4EA",
                                  color: "#137333",
                                  border: "1px solid #CEEAD6",
                                  textTransform: "none",
                                }
                              : {
                                  backgroundColor: "#F1F3F4",
                                  color: "#3C4043",
                                  border: "1px solid #DADCE0",
                                  textTransform: "none",
                                }
                          }
                        >
                          {alt.selected ? t`Selected` : t`Not selected`}
                        </Badge>
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        {alt.rejection_reason || (alt.selected ? t`Selected in optimization run` : "—")}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        {!alt.selected && alt.candidate_route_id > 0 ? (
                          <Button
                            size="xs"
                            variant={isInspected ? "filled" : "default"}
                            loading={cfLoading && isInspected}
                            onClick={() => handleInspectTradeoff(alt.candidate_route_id)}
                          >
                            {isInspected ? t`Inspected` : t`Inspect`}
                          </Button>
                        ) : alt.reason_code === "POLICY_EXCLUDED_PEER_BREWER" ? (
                          <Text size="xs" c="text-secondary">{t`Policy`}</Text>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        ) : null}
      </Box>

      {/* Other orders on the same trip */}
      <Box p="md" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
        <Title order={4} mb="xs">{t`Other orders on the same trip`}</Title>
        <Text size="sm" c="text-secondary">
          {planning_policy?.shared_trip_message || t`No validated shared-trip record is available for this proposal.`}
        </Text>
      </Box>
    </Box>
  );
}
