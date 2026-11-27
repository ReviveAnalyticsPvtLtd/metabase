import { useEffect, useMemo, useState } from "react";
import { t } from "ttag";

import { Box, Flex, Select, Text, TextInput, Title } from "metabase/ui";

import { fetchOperationsInventory } from "../api";
import { FulfillmentMap, type MapMarkerSpec } from "../components/FulfillmentMap";
import { SimulationBanner } from "../components/SimulationBanner";
import type { InventoryListResponse } from "../types";

function roleColor(role: string): string {
  if (role === "Maintenance Facility") {
    return "#10B981";
  }
  if (role === "Distributor") {
    return "#F59E0B";
  }
  return "#2563EB";
}

export function InventoryPage() {
  const [region, setRegion] = useState<string>("");
  const [kegSize, setKegSize] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [data, setData] = useState<InventoryListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchOperationsInventory({
      region: region || undefined,
      keg_size: kegSize || undefined,
      q: q.trim() || undefined,
    })
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t`Unable to load inventory.`);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [region, kegSize, q]);

  const mapMarkers = useMemo<MapMarkerSpec[]>(() => {
    const byFacility = new Map<string, MapMarkerSpec & { total: number }>();
    for (const row of data?.data || []) {
      if (row.lat == null || row.lng == null) {
        continue;
      }
      const existing = byFacility.get(row.customer_id);
      if (existing) {
        existing.total += row.available_kegs;
        existing.sublabel = `${row.facility_role} · ${row.city} · ${existing.total.toLocaleString()} simulated kegs`;
        existing.radius = Math.min(14, Math.max(6, Math.round(Math.sqrt(existing.total) / 5)));
      } else {
        byFacility.set(row.customer_id, {
          id: row.customer_id,
          lat: Number(row.lat),
          lng: Number(row.lng),
          label: row.facility_name,
          badgeText: row.facility_role,
          sublabel: `${row.facility_role} · ${row.city} · ${row.available_kegs.toLocaleString()} simulated kegs`,
          color: roleColor(row.facility_role),
          radius: Math.min(14, Math.max(6, Math.round(Math.sqrt(row.available_kegs) / 5))),
          total: row.available_kegs,
        });
      }
    }
    return Array.from(byFacility.values());
  }, [data]);

  return (
    <Box p="lg" maw={1440} mx="auto">
      <Title order={2} mb={4}>{t`Simulated Empty-Keg Network Inventory`}</Title>
      <Text size="sm" c="text-secondary" mb="sm">
        {t`Latest reported inventory snapshot per facility and keg size. Inventory is simulated and not reserved.`}
      </Text>

      <SimulationBanner run={data?.run} disclosures={data?.disclosures} />

      <Flex gap="sm" mb="md" wrap="wrap">
        <TextInput
          label={t`Search facility`}
          placeholder={t`Facility name or ID`}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Select
          label={t`Region`}
          placeholder={t`All regions`}
          clearable
          value={region || null}
          onChange={(val) => setRegion(val || "")}
          data={["North", "South", "East", "West"]}
        />
        <Select
          label={t`Keg size`}
          placeholder={t`All sizes`}
          clearable
          value={kegSize || null}
          onChange={(val) => setKegSize(val || "")}
          data={["20L", "30L", "50L"]}
        />
      </Flex>

      {error && (
        <Box p="md" mb="md" style={{ border: "1px solid var(--mb-color-error)", borderRadius: 8 }}>
          <Text c="error" fw={600}>{error}</Text>
        </Box>
      )}

      {loading ? (
        <Text size="sm" c="text-secondary">{t`Loading simulated inventory & map...`}</Text>
      ) : !data || data.data.length === 0 ? (
        <Text size="sm" c="text-secondary">{t`No inventory rows match the selected filters.`}</Text>
      ) : (
        <>
          <Box mb="md">
            <FulfillmentMap
              markers={mapMarkers}
              height={320}
              title={t`Clean-Keg Supply Distribution Across India`}
              subtitle={t`Pin size scales with reported available inventory. Depot-First uses Maintenance Facilities & Distributors first.`}
              legendItems={[
                { label: t`Maintenance Facility (Eligible Depot)`, color: "#10B981" },
                { label: t`Distributor (Eligible Hub)`, color: "#F59E0B" },
                { label: t`Brewer (Excluded unless peer-transfer scenario)`, color: "#2563EB" },
              ]}
            />
          </Box>
          <Box style={{ overflowX: "auto", border: "1px solid var(--mb-color-border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--mb-color-border)", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px" }}>{t`Facility`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Role`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Region`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`City`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Keg size`}</th>
                  <th style={{ padding: "8px 10px" }}>{t`Snapshot date`}</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>{t`Available (simulated)`}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr key={`${row.customer_id}-${row.keg_size}`} style={{ borderBottom: "1px solid var(--mb-color-border)" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{row.facility_name}</td>
                    <td style={{ padding: "8px 10px" }}>{row.facility_role}</td>
                    <td style={{ padding: "8px 10px" }}>{row.region}</td>
                    <td style={{ padding: "8px 10px" }}>{row.city}</td>
                    <td style={{ padding: "8px 10px" }}>{row.keg_size}</td>
                    <td style={{ padding: "8px 10px" }}>{String(row.snapshot_date).slice(0, 10)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>
                      {row.available_kegs.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </>
      )}
    </Box>
  );
}
