import { useEffect, useState } from "react";
import { t } from "ttag";

import { useNavigate } from "metabase/router";
import {
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Select,
  Text,
  Title,
} from "metabase/ui";

import { fetchScenariosCompare, runWhatIfScenario } from "../api";
import { OpsCopilotPanel } from "../components/OpsCopilotPanel";
import { SimulationBanner } from "../components/SimulationBanner";
import type { ScenarioRunResponse, ScenariosCompareResponse } from "../types";

export function ScenariosPage() {
  const navigate = useNavigate();
  const [compareData, setCompareData] = useState<ScenariosCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState<ScenarioRunResponse | null>(null);
  const [simTimestamp, setSimTimestamp] = useState<string | null>(null);
  const [disabledCarrier, setDisabledCarrier] = useState<string>("EastWest Transport");
  const [stockPct, setStockPct] = useState<string>("0.8");
  const [deadlineDelta, setDeadlineDelta] = useState<string>("-2");

  useEffect(() => {
    let cancelled = false;
    fetchScenariosCompare()
      .then((res) => {
        if (!cancelled) {
          setCompareData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t`Unable to load policy comparison.`);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRunScenario = async (
    scenarioType: string,
    opts?: { disabled_carrier?: string; stock_pct?: number; deadline_days_delta?: number },
  ) => {
    setSimLoading(true);
    setError(null);
    try {
      const res = await runWhatIfScenario({
        scenario_type: scenarioType,
        ...opts,
      });
      setSimResult(res);
      setSimTimestamp(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Simulation failed.`);
    } finally {
      setSimLoading(false);
    }
  };

  const handleResetBaseline = () => {
    setDisabledCarrier("EastWest Transport");
    setStockPct("0.8");
    setDeadlineDelta("-2");
    setSimResult(null);
    setSimTimestamp(null);
  };

  const active = compareData?.active_plan;
  const bench = compareData?.benchmark_plan;

  return (
    <Box p="lg" maw={1440} mx="auto">
      <Flex justify="space-between" align="center" mb="sm" wrap="wrap" gap="sm">
        <div>
          <Title order={2}>{t`Policy Comparison & Scenario Lab`}</Title>
          <Text size="sm" c="text-secondary">
            {t`Compare the active Depot-First operational policy against the unrestricted nearest-source benchmark and run read-only what-if simulations.`}
          </Text>
        </div>
        <Group gap="xs">
          <Button variant="default" onClick={() => navigate("/dashboard/23")}>
            {t`Control Tower`}
          </Button>
          <Button variant="default" onClick={() => navigate("/operations/orders")}>
            {t`Order Fulfillment`}
          </Button>
        </Group>
      </Flex>

      <SimulationBanner run={active ? { ...active, created_at: "", as_of_date: "", horizon_orders: active.orders_total, total_open_orders: active.orders_total } : null} disclosures={compareData?.disclosures} />

      <OpsCopilotPanel compact />

      {error && (
        <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-error)", borderRadius: 8 }}>
          <Text c="error" fw={600}>{error}</Text>
        </Box>
      )}

      {loading ? (
        <Text size="sm" c="text-secondary">{t`Loading policy comparison...`}</Text>
      ) : (
        <>
          <Flex gap="md" mb="md" wrap="wrap">
            {active && (
              <Box p="md" style={{ flex: "1 1 400px", border: "2px solid #1967D2", borderRadius: 10 }}>
                <Group justify="space-between" mb="xs">
                  <Badge style={{ backgroundColor: "#E8F0FE", color: "#1967D2", textTransform: "none" }}>
                    {t`Active Operational Default`}
                  </Badge>
                  <Text size="xs" fw={600}>{active.source_policy_label}</Text>
                </Group>
                <Flex gap="xl" wrap="wrap" mb="sm">
                  <div>
                    <Text size="xs" c="text-secondary">{t`Proposed Kegs`}</Text>
                    <Text size="xl" fw={700}>{active.kegs_allocated.toLocaleString()}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="text-secondary">{t`Fully Covered`}</Text>
                    <Text size="xl" fw={700} c="green">{active.orders_fully_covered.toLocaleString()}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="text-secondary">{t`Uncovered Orders`}</Text>
                    <Text size="xl" fw={700} c="red">{active.orders_uncovered.toLocaleString()}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="text-secondary">{t`Modeled Freight`}</Text>
                    <Text size="xl" fw={700}>{`₹${Math.round(active.total_freight_inr).toLocaleString()}`}</Text>
                  </div>
                </Flex>
                <Text size="xs" fw={600} mb={4}>{t`Source Role Distribution:`}</Text>
                {active.source_role_breakdown.map((r) => (
                  <Flex key={r.source_role} justify="space-between" py={2}>
                    <Text size="xs">{r.source_role}</Text>
                    <Text size="xs" fw={600}>
                      {t`${r.orders_count} orders · ${Number(r.kegs_allocated).toLocaleString()} kegs · ${r.avg_distance_km} km avg`}
                    </Text>
                  </Flex>
                ))}
              </Box>
            )}

            {bench && (
              <Box p="md" style={{ flex: "1 1 400px", border: "1px solid var(--mb-color-border)", borderRadius: 10 }}>
                <Group justify="space-between" mb="xs">
                  <Badge style={{ backgroundColor: "#FEF7E0", color: "#B06000", textTransform: "none" }}>
                    {t`Comparison Benchmark Only`}
                  </Badge>
                  <Text size="xs" fw={600}>{bench.source_policy_label}</Text>
                </Group>
                <Flex gap="xl" wrap="wrap" mb="sm">
                  <div>
                    <Text size="xs" c="text-secondary">{t`Proposed Kegs`}</Text>
                    <Text size="xl" fw={700}>{bench.kegs_allocated.toLocaleString()}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="text-secondary">{t`Fully Covered`}</Text>
                    <Text size="xl" fw={700}>{bench.orders_fully_covered.toLocaleString()}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="text-secondary">{t`Uncovered Orders`}</Text>
                    <Text size="xl" fw={700}>{bench.orders_uncovered.toLocaleString()}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="text-secondary">{t`Modeled Freight`}</Text>
                    <Text size="xl" fw={700}>{`₹${Math.round(bench.total_freight_inr).toLocaleString()}`}</Text>
                  </div>
                </Flex>
                <Text size="xs" fw={600} mb={4}>{t`Source Role Distribution (includes peer Brewers):`}</Text>
                {bench.source_role_breakdown.map((r) => (
                  <Flex key={r.source_role} justify="space-between" py={2}>
                    <Text size="xs">{r.source_role}</Text>
                    <Text size="xs" fw={600}>
                      {t`${r.orders_count} orders · ${Number(r.kegs_allocated).toLocaleString()} kegs · ${r.avg_distance_km} km avg`}
                    </Text>
                  </Flex>
                ))}
              </Box>
            )}
          </Flex>

          <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-border)", borderRadius: 10 }}>
            <Flex justify="space-between" align="center" mb="xs" wrap="wrap" gap="xs">
              <div>
                <Title order={4}>{t`Operational Disruption & Policy Scenarios`}</Title>
                <Text size="xs" c="text-secondary">
                  {t`Test supply, carrier, policy, or due-date changes on the active baseline snapshot without changing the published plan.`}
                </Text>
              </div>
              {simResult && (
                <Button size="xs" variant="subtle" onClick={handleResetBaseline}>
                  {t`Reset to baseline`}
                </Button>
              )}
            </Flex>

            <Flex gap="md" wrap="wrap" align="stretch">
              <Box p="sm" style={{ flex: "1 1 240px", border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
                <Text fw={600} size="sm" mb={4}>{t`Carrier outage`}</Text>
                <Select
                  label={t`Unavailable carrier`}
                  value={disabledCarrier}
                  onChange={(v) => setDisabledCarrier(v || "EastWest Transport")}
                  data={[
                    "EastWest Transport",
                    "Deccan Freight",
                    "MetroLine Cargo",
                    "SwiftHaul Logistics",
                    "BlueRoute Carriers",
                    "PrimeKeg Mobility",
                  ]}
                  mb="xs"
                />
                <Button
                  size="xs"
                  loading={simLoading}
                  onClick={() => handleRunScenario("carrier_outage", { disabled_carrier: disabledCarrier })}
                >
                  {t`Run carrier outage`}
                </Button>
              </Box>

              <Box p="sm" style={{ flex: "1 1 240px", border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
                <Text fw={600} size="sm" mb={4}>{t`Source inventory change`}</Text>
                <Select
                  label={t`Available stock level`}
                  value={stockPct}
                  onChange={(v) => setStockPct(v || "0.8")}
                  data={[
                    { value: "0.6", label: t`60% (−40% stock)` },
                    { value: "0.8", label: t`80% (−20% stock)` },
                    { value: "0.9", label: t`90% (−10% stock)` },
                    { value: "1.2", label: t`120% (+20% stock)` },
                  ]}
                  mb="xs"
                />
                <Button
                  size="xs"
                  variant="default"
                  loading={simLoading}
                  onClick={() => handleRunScenario("stock_shock", { stock_pct: Number(stockPct) })}
                >
                  {t`Run inventory scenario`}
                </Button>
              </Box>

              <Box p="sm" style={{ flex: "1 1 240px", border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
                <Text fw={600} size="sm" mb={4}>{t`Due-date shift`}</Text>
                <Select
                  label={t`Shift needed-by dates`}
                  value={deadlineDelta}
                  onChange={(v) => setDeadlineDelta(v || "-2")}
                  data={[
                    { value: "-3", label: t`3 days earlier` },
                    { value: "-2", label: t`2 days earlier` },
                    { value: "2", label: t`2 days later` },
                    { value: "5", label: t`5 days later` },
                  ]}
                  mb="xs"
                />
                <Button
                  size="xs"
                  variant="default"
                  loading={simLoading}
                  onClick={() => handleRunScenario("deadline_shift", { deadline_days_delta: Number(deadlineDelta) })}
                >
                  {t`Run due-date scenario`}
                </Button>
              </Box>

              <Box p="sm" style={{ flex: "1 1 240px", border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
                <Text fw={600} size="sm" mb={4}>{t`Sourcing policy comparison`}</Text>
                <Text size="xs" c="text-secondary" mb="sm">
                  {t`Compare strict Depot-Only (excluding peer Brewers) vs. Service-First Fallback.`}
                </Text>
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    loading={simLoading}
                    onClick={() => handleRunScenario("strict_depot_only")}
                  >
                    {t`Strict Depot-Only`}
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    loading={simLoading}
                    onClick={() => handleRunScenario("service_first_fallback")}
                  >
                    {t`Service-First Fallback`}
                  </Button>
                </Group>
              </Box>
            </Flex>

            {simResult && (
              <Box
                p="md"
                mt="md"
                style={{
                  border: "1px solid #1967D2",
                  borderRadius: 8,
                  backgroundColor: "var(--mb-color-background-secondary)",
                }}
                data-testid="scenario-sim-result"
              >
                <Flex justify="space-between" align="center" mb="xs" wrap="wrap" gap="xs">
                  <Title order={5}>{simResult.title}</Title>
                  {simTimestamp && (
                    <Text size="xs" c="text-secondary">
                      {t`Evaluated at ${simTimestamp} · Active plan unchanged`}
                    </Text>
                  )}
                </Flex>
                <Text size="sm" mb="sm">{simResult.summary}</Text>
                <Flex gap="xl" wrap="wrap" mb="sm">
                  <div>
                    <Text size="xs" c="text-secondary">{t`Kegs Impact`}</Text>
                    <Text size="md" fw={700}>
                      {`${simResult.scenario_kegs.toLocaleString()} (${simResult.kegs_delta >= 0 ? "+" : ""}${simResult.kegs_delta.toLocaleString()})`}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="text-secondary">{t`Uncovered Orders Impact`}</Text>
                    <Text size="md" fw={700}>
                      {`${simResult.scenario_uncovered.toLocaleString()} (${simResult.uncovered_delta >= 0 ? "+" : ""}${simResult.uncovered_delta.toLocaleString()})`}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="text-secondary">{t`Modeled Freight Impact`}</Text>
                    <Text size="md" fw={700}>
                      {`₹${simResult.scenario_freight_inr.toLocaleString()} (${simResult.freight_delta_inr >= 0 ? "+" : ""}₹${simResult.freight_delta_inr.toLocaleString()})`}
                    </Text>
                  </div>
                </Flex>
                {simResult.assumptions && simResult.assumptions.length > 0 && (
                  <Text size="xs" c="text-secondary">
                    {simResult.assumptions.join(" ")}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
