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

import { fetchOrderAlternatives, fetchOrderDetail } from "../api";
import { SimulationBanner } from "../components/SimulationBanner";
import { StatusBadge } from "../components/StatusBadge";
import type { OrderAlternativesResponse, OrderDetailResponse } from "../types";

export function OrderDetailPage() {
  const navigate = useNavigate();
  const { orderId = "" } = useParams<{ orderId: string }>();

  const [detail, setDetail] = useState<OrderDetailResponse | null>(null);
  const [alts, setAlts] = useState<OrderAlternativesResponse | null>(null);
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

  const { order, run, disclosures } = detail;
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
              <Text size="sm">
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
        {showWhy && <Text size="sm">{order.why_this_plan}</Text>}
      </Box>

      {/* Evaluated Alternatives */}
      <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
        <Title order={4} mb="sm">{t`Evaluated alternatives`}</Title>
        {!alts || alts.incomplete_evidence || alts.alternatives.length === 0 ? (
          <Text size="sm" c="text-secondary">
            {t`Alternative evidence is incomplete for this plan.`}
          </Text>
        ) : (
          <Box style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--mb-color-border)", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px" }}>{t`Source`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Carrier`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Modeled distance`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Estimated transit`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Due-date slack`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Estimated freight`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Decision`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Reason`}</th>
                </tr>
              </thead>
              <tbody>
                {alts.alternatives.map((alt) => (
                  <tr key={alt.evidence_id} style={{ borderBottom: "1px solid var(--mb-color-border)" }}>
                    <td style={{ padding: "8px 10px" }}>{alt.source_name}</td>
                    <td style={{ padding: "8px 10px" }}>{alt.carrier_name}</td>
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
                    <td style={{ padding: "8px 10px" }}>{alt.rejection_reason || (alt.selected ? t`Chosen within modeled bounds` : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        )}
      </Box>

      {/* Other orders on the same trip */}
      <Box p="md" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
        <Title order={4} mb="xs">{t`Other orders on the same trip`}</Title>
        <Text size="sm" c="text-secondary">
          {t`Shared-trip information is not available for this proposed plan.`}
        </Text>
      </Box>
    </Box>
  );
}
