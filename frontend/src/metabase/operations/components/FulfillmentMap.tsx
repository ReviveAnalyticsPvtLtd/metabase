import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "ttag";

import { Box, Button, Flex, Group, Text } from "metabase/ui";

export interface MapMarkerSpec {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  color: string;
  badgeText?: string;
  radius?: number;
  selected?: boolean;
  onClick?: () => void;
}

export interface MapLineSpec {
  id: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  color: string;
  dashed?: boolean;
  highlighted?: boolean;
  label?: string;
}

export interface MapLegendItem {
  label: string;
  color: string;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng)) &&
    !(Number(lat) === 0 && Number(lng) === 0)
  );
}

export function FulfillmentMap({
  markers,
  lines = [],
  height = 380,
  title,
  subtitle,
  legendItems = [],
  emptyMessage,
  fitKey,
}: {
  markers: MapMarkerSpec[];
  lines?: MapLineSpec[];
  height?: number;
  title?: string;
  subtitle?: string;
  legendItems?: MapLegendItem[];
  emptyMessage?: string;
  fitKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const lastFitKeyRef = useRef<string | undefined>(undefined);
  const latestBoundsRef = useRef<[number, number][]>([]);
  const [tileError, setTileError] = useState(false);

  const validMarkers = useMemo(
    () => markers.filter((m) => isValidCoord(m.lat, m.lng)),
    [markers],
  );
  const validLines = useMemo(
    () =>
      lines.filter(
        (l) =>
          isValidCoord(l.fromLat, l.fromLng) && isValidCoord(l.toLat, l.toLng),
      ),
    [lines],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) {
      return;
    }

    const map = L.map(el, {
      center: [22.5, 79.0],
      zoom: 5,
      scrollWheelZoom: false,
      attributionControl: true,
    });

    const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    });
    tileLayer.on("tileerror", () => setTileError(true));
    tileLayer.on("tileload", () => setTileError(false));
    tileLayer.addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        map.invalidateSize();
      });
      ro.observe(el);
    }

    return () => {
      if (ro) {
        ro.disconnect();
      }
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) {
      return;
    }

    group.clearLayers();
    const boundsCoords: [number, number][] = [];

    for (const line of validLines) {
      const latlngs: [number, number][] = [
        [Number(line.fromLat), Number(line.fromLng)],
        [Number(line.toLat), Number(line.toLng)],
      ];
      boundsCoords.push(...latlngs);
      const poly = L.polyline(latlngs, {
        color: line.color,
        weight: line.highlighted ? 4 : 2.5,
        opacity: line.highlighted ? 0.95 : 0.72,
        dashArray: line.dashed ? "7 6" : undefined,
      });
      if (line.label) {
        poly.bindTooltip(escapeHtml(line.label), { sticky: true });
      }
      poly.addTo(group);
    }

    for (const m of validMarkers) {
      const lat = Number(m.lat);
      const lng = Number(m.lng);
      boundsCoords.push([lat, lng]);

      const radius = m.selected ? (m.radius || 9) + 3 : m.radius || 7;
      const circle = L.circleMarker([lat, lng], {
        radius,
        color: m.selected ? "#111827" : "#FFFFFF",
        weight: m.selected ? 3 : 2,
        fillColor: m.color,
        fillOpacity: m.selected ? 1 : 0.9,
      });

      const tooltipHtml = `
        <div style="font-size:12px;line-height:1.35;">
          <strong>${escapeHtml(m.label)}</strong>
          ${m.badgeText ? `<span style="margin-left:6px;padding:1px 5px;border-radius:4px;background:#F3F4F6;color:#111827;font-size:10px;">${escapeHtml(m.badgeText)}</span>` : ""}
          ${m.sublabel ? `<div style="color:#4B5563;margin-top:2px;">${escapeHtml(m.sublabel)}</div>` : ""}
        </div>
      `;
      circle.bindTooltip(tooltipHtml, { direction: "top", offset: [0, -6] });

      if (m.onClick) {
        circle.on("click", m.onClick);
      }
      circle.addTo(group);
    }

    latestBoundsRef.current = boundsCoords;
    const effectiveFitKey = fitKey ?? "__default__";
    const shouldFit =
      boundsCoords.length > 0 && lastFitKeyRef.current !== effectiveFitKey;

    if (shouldFit) {
      lastFitKeyRef.current = effectiveFitKey;
      if (boundsCoords.length === 1) {
        map.setView(boundsCoords[0], 7, { animate: false });
      } else {
        map.fitBounds(L.latLngBounds(boundsCoords), {
          padding: [40, 40],
          maxZoom: 10,
          animate: false,
        });
      }
    } else if (boundsCoords.length === 0 && lastFitKeyRef.current === undefined) {
      map.setView([22.5, 79.0], 5, { animate: false });
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 50);
  }, [validMarkers, validLines, fitKey]);

  const handleFitSelectedRoute = () => {
    const map = mapRef.current;
    const coords = latestBoundsRef.current;
    if (!map) {
      return;
    }
    if (coords.length === 1) {
      map.setView(coords[0], 7, { animate: false });
    } else if (coords.length > 1) {
      map.fitBounds(L.latLngBounds(coords), {
        padding: [40, 40],
        maxZoom: 10,
        animate: false,
      });
    } else {
      map.setView([22.5, 79.0], 5, { animate: false });
    }
  };

  return (
    <Box
      style={{
        border: "1px solid var(--mb-color-border)",
        borderRadius: 10,
        overflow: "hidden",
        backgroundColor: "var(--mb-color-background-primary)",
      }}
      data-testid="fulfillment-leaflet-map"
    >
      {(title || legendItems.length > 0) && (
        <Flex
          justify="space-between"
          align="center"
          px="md"
          py="xs"
          wrap="wrap"
          gap="xs"
          style={{
            borderBottom: "1px solid var(--mb-color-border)",
            backgroundColor: "var(--mb-color-background-secondary)",
          }}
        >
          <div>
            {title && (
              <Text size="sm" fw={600}>
                {title}
              </Text>
            )}
            {subtitle && (
              <Text size="xs" c="text-secondary">
                {subtitle}
              </Text>
            )}
          </div>
          <Group gap="sm" wrap="wrap">
            {legendItems.map((item) => (
              <Group key={item.label} gap={5} wrap="nowrap">
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    backgroundColor: item.color,
                    display: "inline-block",
                  }}
                />
                <Text size="xs" c="text-secondary">
                  {item.label}
                </Text>
              </Group>
            ))}
            {validMarkers.length > 0 && (
              <Button size="xs" variant="default" onClick={handleFitSelectedRoute}>
                {t`Fit selected route`}
              </Button>
            )}
          </Group>
        </Flex>
      )}
      {tileError && (
        <Box px="md" py={6} style={{ backgroundColor: "#FEF7E0", borderBottom: "1px solid #FEEFC3" }}>
          <Text size="xs" style={{ color: "#B06000" }}>
            {t`Map background tiles could not be loaded (network/CSP). Facility markers and modeled path remain plotted below.`}
          </Text>
        </Box>
      )}
      <Box style={{ position: "relative", height }}>
        {validMarkers.length === 0 && (
          <Flex align="center" justify="center" style={{ height }} p="md">
            <Text size="sm" c="text-secondary">
              {emptyMessage || t`Facility coordinates are unavailable for this view.`}
            </Text>
          </Flex>
        )}
        <div
          ref={containerRef}
          style={{
            width: "100%",
            height,
            zIndex: 1,
            display: validMarkers.length === 0 ? "none" : "block",
          }}
          role="region"
          aria-label={title || t`Fulfillment network map`}
        />
      </Box>
      {validMarkers.length > 0 && validMarkers.length <= 20 && (
        <Group
          gap="xs"
          px="md"
          py="xs"
          role="list"
          aria-label={t`Map locations`}
          style={{
            borderTop: "1px solid var(--mb-color-border)",
            backgroundColor: "var(--mb-color-background-secondary)",
          }}
        >
          {validMarkers.map((m) => (
            <Button
              key={m.id}
              size="xs"
              variant={m.selected ? "filled" : "default"}
              onClick={m.onClick}
              role="listitem"
            >
              {m.badgeText ? `${m.badgeText}. ${m.label}` : m.label}
            </Button>
          ))}
        </Group>
      )}
    </Box>
  );
}
