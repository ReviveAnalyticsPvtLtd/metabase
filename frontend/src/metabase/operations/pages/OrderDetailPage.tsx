import { useEffect, useState } from "react";
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
} from "../api";
import { SimulationBanner } from "../components/SimulationBanner";
import { StatusBadge } from "../components/StatusBadge";
import type {
  OrderAlternativesResponse,
  OrderCounterfactualResponse,
  OrderDetailResponse,
} from "../types";

export function OrderDetailPage() {
  const navigate = useNavigate();
  const { orderId = "" } = useParams<{ orderId: string }>();

  const [detail, setDetail] = useState<OrderDetailResponse | null>(null);
  const [alts, setAlts] = useState<OrderAlternativesResponse | null>(null);
  const [counterfactual, setCounterfactual] = useState<OrderCounterfactualResponse | null>(null);
  const [cfLoading, setCfLoading] = useState(false);
  const [cfError, setCfError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCounterfactual(null);
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

  if (loading) {
    return (
      <Box p="lg" maw={1280} mx="auto">
        <Text size="sm" c="text-secondary">
          {t`Loading order fulfillment details...`}
        </Text>
      </Box>
    );
  }

  if (error || !detail) {
    return (
      <Box p="lg" maw={1280} mx="auto">
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

  const handleInspectTradeoff = (candidateRouteId: number) => {
    setCfLoading(true);
    setCfError(null);
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
  const hasValidCoords =
    order.src_lat != null &&
    order.src_lng != null &&
    order.dest_lat != null &&
    order.dest_lng != null &&
    Number.isFinite(Number(order.src_lat)) &&
    Number.isFinite(Number(order.dest_lat));

  return (
    <Box p="lg" maw={1280} mx="auto">
      <Flex justify="space-between" align="center" mb="sm" wrap="wrap" gap="sm">
        <Group gap="sm">
          <Button variant="default" onClick={() => navigate("/operations/orders")}>
            {t`Back to Orders`}
          </Button>
          <Title order={2}>{order.order_id}</Title>
          <StatusBadge status={order.status} />
        </Group>
        <Text size="sm" c="text-secondary">
          {t`${order.destination_brewer} · ${order.region} · ${order.keg_size} · Needed by ${String(order.needed_by).slice(0, 10)}`}
        </Text>
      </Flex>

      <SimulationBanner run={run} disclosures={disclosures} />

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

      {/* Fulfillment Journey */}
      <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
        <Title order={4} mb="sm">{t`Proposed fulfillment journey`}</Title>
        <Flex align="center" gap="md" wrap="wrap">
          <Box p="sm" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 6, minWidth: 200 }}>
            <Badge
              size="xs"
              mb={4}
              style={{
                backgroundColor: "#E8F0FE",
                color: "#1967D2",
                border: "1px solid #D2E3FC",
                textTransform: "none",
              }}
            >
              {order.src_role || t`Source facility`}
            </Badge>
            <Text fw={600}>{order.source_hub}</Text>
            {order.src_city && (
              <Text size="xs" c="text-secondary">{`${order.src_city}${order.src_state ? `, ${order.src_state}` : ""}`}</Text>
            )}
          </Box>
          <Text fw={700}>→</Text>
          <Box p="sm" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 6, minWidth: 200 }}>
            <Badge
              size="xs"
              mb={4}
              style={{
                backgroundColor: "#E6F4EA",
                color: "#137333",
                border: "1px solid #CEEAD6",
                textTransform: "none",
              }}
            >
              {order.distributor_mode === "physical_stop" ? t`Physical stop` : t`Coordinator (not a physical stop)`}
            </Badge>
            <Text fw={600}>{order.distributor || "Unassigned"}</Text>
            <Text size="xs" c="text-secondary">
              {order.allocated_units > 0
                ? t`${order.carrier} · ${order.distance_km} km modeled · ~${order.transit_days} day(s) estimated`
                : t`No carrier assigned`}
            </Text>
          </Box>
          <Text fw={700}>→</Text>
          <Box p="sm" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 6, minWidth: 200 }}>
            <Badge
              size="xs"
              mb={4}
              style={{
                backgroundColor: "#EDE7F6",
                color: "#4527A0",
                border: "1px solid #D1C4E9",
                textTransform: "none",
              }}
            >
              {t`Destination Brewer`}
            </Badge>
            <Text fw={600}>{order.destination_brewer}</Text>
            {order.dest_city && (
              <Text size="xs" c="text-secondary">{`${order.dest_city}${order.dest_state ? `, ${order.dest_state}` : ""}`}</Text>
            )}
          </Box>
        </Flex>
        <Group gap="lg" mt="sm">
          <Text size="sm">
            {t`Proposed quantity: ${order.allocated_units.toLocaleString()} ${order.keg_size} kegs`}
          </Text>
          <Text size="sm">
            {t`Estimated freight: ₹${Number(order.freight_cost_inr || 0).toLocaleString()} (modeled rate)`}
          </Text>
        </Group>
      </Box>

      {/* Schematic Location View & Timeline */}
      <Flex gap="md" mb="md" wrap="wrap">
        <Box p="md" style={{ flex: "1 1 360px", border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
          <Title order={4} mb="xs">{t`Location relationship`}</Title>
          {hasValidCoords ? (
            <>
              <Text size="xs" c="text-secondary" mb="xs">
                {t`Schematic connection — not a road route`}
              </Text>
              <svg
                width="100%"
                height="92"
                viewBox="0 0 420 92"
                role="img"
                aria-label={t`Schematic connection from ${order.source_hub} to ${order.destination_brewer}`}
                style={{ display: "block", marginBottom: 8 }}
              >
                <line
                  x1="60"
                  y1="38"
                  x2="360"
                  y2="38"
                  stroke="#509EE3"
                  strokeWidth="2.5"
                  strokeDasharray="6 4"
                />
                <circle cx="60" cy="38" r="14" fill="#E8F0FE" stroke="#1967D2" strokeWidth="2" />
                <text x="60" y="42" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1967D2">1</text>
                <circle cx="360" cy="38" r="14" fill="#EDE7F6" stroke="#4527A0" strokeWidth="2" />
                <text x="360" y="42" textAnchor="middle" fontSize="11" fontWeight="700" fill="#4527A0">2</text>
                <text x="210" y="28" textAnchor="middle" fontSize="11" fill="#5F6368">
                  {order.allocated_units > 0
                    ? `${order.distance_km} km modeled · ~${order.transit_days}d`
                    : t`No modeled leg`}
                </text>
                <text x="60" y="72" textAnchor="middle" fontSize="11" fill="#3C4043">
                  {order.source_customer_id || t`Unallocated`}
                </text>
                <text x="360" y="72" textAnchor="middle" fontSize="11" fill="#3C4043">
                  {order.destination_customer_id}
                </text>
              </svg>
              <Text size="xs" c="text-secondary">
                {t`Source (${Number(order.src_lat).toFixed(2)}, ${Number(order.src_lng).toFixed(2)}) → Destination (${Number(order.dest_lat).toFixed(2)}, ${Number(order.dest_lng).toFixed(2)})`}
              </Text>
            </>
          ) : (
            <Text size="sm" c="text-secondary">
              {t`Facility coordinates are unavailable for this order (no default location plotted).`}
            </Text>
          )}
        </Box>

        <Box p="md" style={{ flex: "1 1 360px", border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
          <Title order={4} mb="xs">{t`Timeline`}</Title>
          {order.timeline.map((item) => (
            <Flex key={item.label} justify="space-between" py={4}>
              <Text size="sm" fw={500}>{item.label}</Text>
              <Group gap="xs">
                <Text size="sm">
                  {item.date
                    ? String(item.date).slice(0, 10)
                    : item.days !== undefined
                    ? `${item.days} day(s)`
                    : item.feasible !== undefined
                    ? item.feasible
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
                {t`Planning mode: Order-level allocation (single-source allocation per order)`}
              </Text>
              {planning_policy?.decision_stage && (
                <Text size="xs" c="text-secondary">
                  {t`Decision stage: ${planning_policy.decision_stage}`}
                </Text>
              )}
              {order.cost_formula && (
                <Text size="xs" c="text-secondary">
                  {t`Cost basis: ${order.cost_formula}`}
                </Text>
              )}
            </Group>
          </>
        )}
      </Box>

      {/* Evaluated Alternatives */}
      <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
        <Title order={4} mb={4}>{t`Evaluated alternatives`}</Title>
        <Text size="xs" c="text-secondary" mb="sm">
          {alts && alts.truncated
            ? t`Showing ${alts.returned_count ?? alts.alternatives.length} of ${alts.evaluated_count ?? alts.alternatives.length} evaluated candidates${alts.omitted_count ? ` (${alts.omitted_count} farther sources omitted by source cap)` : ""}. Bounded search — not guaranteed global optimum.`
            : t`Showing all ${alts?.alternatives.length ?? 0} evaluated candidates for this order.`}
        </Text>
        {!alts || alts.alternatives.length === 0 ? (
          <Text size="sm" c="text-secondary">
            {alts?.evidence_status === "empty"
              ? t`No candidate evidence was recorded for this order.`
              : t`Alternative evidence is unavailable for this plan.`}
          </Text>
        ) : (
          <Box style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--mb-color-border)", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px" }}>{t`Source`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Carrier`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Qty`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Stock (Avail/Rem)`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Modeled distance`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Estimated transit`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Due-date slack`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Estimated freight`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Decision`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Reason`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Trade-off`}</th>
                </tr>
              </thead>
              <tbody>
                {alts.alternatives.map((alt) => (
                  <tr key={alt.evidence_id} style={{ borderBottom: "1px solid var(--mb-color-border)" }}>
                    <td style={{ padding: "8px 10px" }}>
                      <div>{alt.source_name}</div>
                      <Text size="xs" c="text-secondary">{alt.source_customer_id}</Text>
                    </td>
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
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{`${alt.transit_days} d`}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{`${alt.slack_days} d`}</td>
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
                          variant="default"
                          onClick={() => handleInspectTradeoff(alt.candidate_route_id)}
                        >
                          {t`Inspect`}
                        </Button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        )}

        {cfLoading && (
          <Text size="xs" c="text-secondary" mt="sm">
            {t`Loading counterfactual trade-off...`}
          </Text>
        )}
        {cfError && (
          <Text size="xs" c="error" mt="sm">{cfError}</Text>
        )}
        {counterfactual && (
          <Box
            p="sm"
            mt="md"
            style={{
              border: "1px solid var(--mb-color-border)",
              backgroundColor: "var(--mb-color-background-secondary)",
              borderRadius: 6,
            }}
          >
            <Flex justify="space-between" align="center" mb="xs">
              <Text fw={600} size="sm">
                {t`Counterfactual Trade-Off: ${counterfactual.target_source_name} via ${counterfactual.carrier_name}`}
              </Text>
              <Button variant="subtle" size="xs" onClick={() => setCounterfactual(null)}>
                {t`Close`}
              </Button>
            </Flex>
            <Text size="sm" mb="xs">{counterfactual.conclusion}</Text>
            {counterfactual.affected_orders.length > 0 && (
              <Group gap="xs" wrap="wrap">
                <Text size="xs" c="text-secondary">{t`Competing orders using this stock:`}</Text>
                {counterfactual.affected_orders.slice(0, 6).map((ao) => (
                  <Button
                    key={ao.order_id}
                    size="xs"
                    variant="default"
                    onClick={() => navigate(`/operations/orders/${ao.order_id}`)}
                  >
                    {`${ao.order_id} (${ao.allocated_units} kegs)`}
                  </Button>
                ))}
              </Group>
            )}
          </Box>
        )}
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
