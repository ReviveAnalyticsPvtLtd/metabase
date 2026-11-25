import L from "leaflet";
import _ from "underscore";

import { getSubpathSafeUrl } from "metabase/urls";
import type { HoveredObject } from "metabase/viz-core";
import type { ClickObject } from "metabase-lib";
import { isPK } from "metabase-lib/v1/types/utils/isa";

import {
  LeafletMap,
  type LeafletMapPoint,
  type LeafletMapProps,
} from "./LeafletMap";

type IndexedPoint = LeafletMapPoint<[number]>;

interface LeafletMarkerPinMapProps extends LeafletMapProps<IndexedPoint> {
  onHoverChange?: (hoverObject?: HoveredObject | null) => void;
  onVisualizationClick?: (clickObject: ClickObject | null) => void;
}

export interface CategoryInfo {
  type: string;
  color: string;
  border: string;
  glow: string;
  badgeBg: string;
  badgeColor: string;
}

const GENERIC_CATEGORY_PALETTE = [
  ["#2563EB", "#1D4ED8"],
  ["#EA580C", "#C2410C"],
  ["#10B981", "#059669"],
  ["#8B5CF6", "#6D28D9"],
  ["#06B6D4", "#0E7490"],
] as const;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function genericCategoryInfo(value: string): CategoryInfo {
  const hash = [...value].reduce((total, character) => total + character.charCodeAt(0), 0);
  const [color, border] = GENERIC_CATEGORY_PALETTE[hash % GENERIC_CATEGORY_PALETTE.length];
  return { type: value || "Other", color, border, glow: color + "66", badgeBg: color + "1F", badgeColor: border };
}

function findCategoryColumn(cols: Array<{ name: string }>, rows: unknown[][]): number {
  const preferred = cols.findIndex((column) => /customer.*type|category|segment|type|status/i.test(column.name));
  if (preferred >= 0) return preferred;
  return cols.findIndex((_, index) => {
    const values = new Set(rows.map((row) => row[index]).filter((value) => typeof value === "string"));
    return values.size > 1 && values.size <= 12;
  });
}

export function getCategoryInfo(customerType?: string | null): CategoryInfo {
  const t = (customerType || "").toLowerCase();
  if (t.includes("brewer") || t.includes("brw")) {
    return {
      type: "Brewer",
      color: "#2563EB", // Sapphire Blue
      border: "#1D4ED8",
      glow: "rgba(37, 99, 235, 0.45)",
      badgeBg: "rgba(37, 99, 235, 0.12)",
      badgeColor: "#1D4ED8",
    };
  }
  if (t.includes("distributor") || t.includes("dist")) {
    return {
      type: "Distributor",
      color: "#EA580C", // Amber / Deep Orange
      border: "#C2410C",
      glow: "rgba(234, 88, 12, 0.45)",
      badgeBg: "rgba(234, 88, 12, 0.12)",
      badgeColor: "#C2410C",
    };
  }
  if (t.includes("maint") || t.includes("facility") || t.includes("warehouse")) {
    return {
      type: "Maintenance Facility",
      color: "#10B981", // Emerald Green
      border: "#059669",
      glow: "rgba(16, 185, 129, 0.45)",
      badgeBg: "rgba(16, 185, 129, 0.12)",
      badgeColor: "#047857",
    };
  }
  return genericCategoryInfo(customerType || "Other");
}

export function createCustomMarkerIcon(customerType: string, isHovered = false): L.DivIcon {
  const info = getCategoryInfo(customerType);
  const width = isHovered ? 28 : 24;
  const height = isHovered ? 34 : 30;
  const anchorX = Math.round(width / 2);
  const anchorY = height;

  return L.divIcon({
    className: "nubrix-custom-pin-marker",
    html: `
      <div role="img" aria-label="${escapeHtml(info.type)}" style="position: relative; width: ${width}px; height: ${height}px; filter: drop-shadow(0 3px 5px ${info.glow}); cursor: pointer; transition: transform 0.15s ease;">
        <svg width="${width}" height="${height}" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M12 0.75C5.7868 0.75 0.75 5.7868 0.75 12C0.75 20.6 11.4 29.35 11.85 29.71C11.94 29.78 12.06 29.78 12.15 29.71C12.6 29.35 23.25 20.6 23.25 12C23.25 5.7868 18.2132 0.75 12 0.75Z" fill="${info.color}" stroke="#FFFFFF" stroke-width="1.5"/>
          <circle cx="12" cy="12" r="4.8" fill="#FFFFFF"/>
          <circle cx="12" cy="12" r="2.4" fill="${info.color}"/>
        </svg>
      </div>
    `,
    iconSize: [width, height],
    iconAnchor: [anchorX, anchorY],
    popupAnchor: [0, -anchorY],
  });
}

export class LeafletMarkerPinMap extends LeafletMap<LeafletMarkerPinMapProps> {
  pinMarkerLayer: L.LayerGroup | null = null;
  pinMarkerIcon: L.Icon | null = null;
  legendControl: L.Control | null = null;

  componentDidMount() {
    super.componentDidMount();

    if (!this.map) {
      return;
    }

    this.pinMarkerLayer = L.layerGroup([]).addTo(this.map);
    this.pinMarkerIcon = L.icon({
      iconUrl: getSubpathSafeUrl("app/assets/img/pin.png"),
      iconSize: [28, 32],
      iconAnchor: [15, 24],
      popupAnchor: [0, -13],
    });

    this.syncMarkerLayer();
    this.syncLegend();
  }

  componentDidUpdate(prevProps: LeafletMarkerPinMapProps) {
    super.componentDidUpdate(prevProps);
    this.syncMarkerLayer();
    this.syncLegend();
  }

  componentWillUnmount() {
    if (this.legendControl && this.map) {
      try {
        this.map.removeControl(this.legendControl);
      } catch {
        // ignore
      }
      this.legendControl = null;
    }
    super.componentWillUnmount?.();
  }

  private syncLegend() {
    if (!this.map) {
      return;
    }

    if (this.legendControl) {
      try {
        this.map.removeControl(this.legendControl);
      } catch {
        // ignore
      }
      this.legendControl = null;
    }

    const series = this.props.series?.[0];
    if (!series?.data?.cols || !series?.data?.rows) {
      return;
    }

    const { cols, rows } = series.data;
    const typeIndex = findCategoryColumn(cols, rows);
    if (typeIndex < 0) {
      return;
    }

    const counts: Record<string, number> = {};
    for (const row of rows) {
      const val = String(row[typeIndex] || "Other");
      counts[val] = (counts[val] || 0) + 1;
    }

    const LegendClass = L.Control.extend({
      options: { position: "topright" as L.ControlPosition },
      onAdd: () => {
        const div = L.DomUtil.create("div", "nubrix-map-legend");
        div.setAttribute("role", "region");
        div.setAttribute("aria-label", "Customer Network Legend");
        div.style.cssText =
          "background: rgba(255, 255, 255, 0.94); backdrop-filter: blur(10px); padding: 8px 12px; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; border: 1px solid rgba(226, 232, 240, 0.85); pointer-events: auto; display: flex; flex-direction: column; gap: 5px; z-index: 999; margin-top: 10px; margin-right: 10px;";

        const header = document.createElement("div");
        header.style.cssText =
          "font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 2px;";
        header.textContent = "Customer Network";
        div.appendChild(header);

        const keys = Object.keys(counts).sort();

        for (const type of keys) {
          const info = getCategoryInfo(type);
          const count = counts[type];

          const rowEl = document.createElement("div");
          rowEl.style.cssText =
            "display: flex; align-items: center; justify-content: space-between; gap: 12px;";

          const leftEl = document.createElement("div");
          leftEl.style.cssText = "display: flex; align-items: center; gap: 6px;";

          const dotEl = document.createElement("span");
          dotEl.style.cssText = `display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: ${info.color}; box-shadow: 0 0 0 2px ${info.glow};`;
          dotEl.setAttribute("aria-hidden", "true");

          const labelEl = document.createElement("span");
          labelEl.style.cssText =
            "color: #1E293B; font-weight: 600; font-size: 11px;";
          labelEl.textContent = info.type;

          leftEl.appendChild(dotEl);
          leftEl.appendChild(labelEl);

          const countEl = document.createElement("span");
          countEl.style.cssText = `background: ${info.badgeBg}; color: ${info.badgeColor}; font-weight: 700; font-size: 10px; padding: 1px 6px; border-radius: 10px;`;
          countEl.textContent = String(count);

          rowEl.appendChild(leftEl);
          rowEl.appendChild(countEl);
          div.appendChild(rowEl);
        }

        return div;
      },
    });

    this.legendControl = new LegendClass();
    this.legendControl.addTo(this.map);
  }

  private syncMarkerLayer() {
    try {
      this._createMarkers(this.props.points);
    } catch (err) {
      console.error(err);
      this.props.onRenderError(
        err instanceof Error ? err.message : (err ?? undefined),
      );
    }
  }

  _getMarkerCustomerType = (rowIndex: number): string => {
    const series = this.props.series?.[0];
    if (!series?.data?.cols || !series?.data?.rows) {
      return "Brewer";
    }
    const { cols, rows } = series.data;
    const typeIndex = findCategoryColumn(cols, rows);
    if (typeIndex >= 0 && rows[rowIndex]) {
      return String(rows[rowIndex][typeIndex] || "Brewer");
    }
    return "Brewer";
  };

  _createMarkers = (points?: IndexedPoint[] | null) => {
    const { pinMarkerLayer } = this;
    if (!this.map || !pinMarkerLayer || !points) {
      return;
    }

    const mapBounds = this.map?.getBounds?.();
    if (!mapBounds) {
      return;
    }
    const mapWest = mapBounds.getWest();
    const mapEast = mapBounds.getEast();

    // if map crosses dateline, we need wrapping
    const crossesLeftDateline = mapWest < -180 && mapEast > -180;
    const crossesRightDateline = mapWest < 180 && mapEast > 180;
    const shouldGetWrappedPoints = crossesLeftDateline || crossesRightDateline;

    const wrappedPoints: IndexedPoint[] = shouldGetWrappedPoints
      ? points.flatMap((point, index) => {
          const [lat, lng] = point;
          const wrapped: IndexedPoint[] = [[lat, lng, index]];

          if (crossesLeftDateline) {
            wrapped.push([lat, lng - 360, index]);
          }

          if (crossesRightDateline) {
            wrapped.push([lat, lng + 360, index]);
          }
          return wrapped;
        })
      : points;

    const markers = pinMarkerLayer
      .getLayers()
      .filter((layer): layer is L.Marker => layer instanceof L.Marker);
    const max = Math.max(wrappedPoints.length, markers.length);
    for (let i = 0; i < max; i++) {
      if (i >= wrappedPoints.length) {
        pinMarkerLayer.removeLayer(markers[i]);
        continue;
      }

      const index =
        wrappedPoints.length > points.length ? wrappedPoints[i][2] : i;
      if (i >= markers.length) {
        // create new markers for new points
        const marker = this._createMarker(index);
        pinMarkerLayer.addLayer(marker);
        markers.push(marker);
      }

      if (i < wrappedPoints.length) {
        const { lat, lng } = markers[i].getLatLng();
        if (lng !== wrappedPoints[i][0] || lat !== wrappedPoints[i][1]) {
          markers[i].setLatLng([wrappedPoints[i][0], wrappedPoints[i][1]]);
        }
        // Update marker icon & events to match point index
        const custType = this._getMarkerCustomerType(index);
        markers[i].setIcon(createCustomMarkerIcon(custType));
        this._setupMarkerEvents(markers[i], index);
      }
    }
  };

  _createMarker = (rowIndex: number) => {
    const custType = this._getMarkerCustomerType(rowIndex);
    const icon = createCustomMarkerIcon(custType);
    const marker = L.marker([0, 0], { icon });
    return this._setupMarkerEvents(marker, rowIndex);
  };

  _setupMarkerEvents = (marker: L.Marker, rowIndex: number) => {
    marker.off("mousemove");
    marker.off("mouseout");
    marker.off("click");

    const series = this.props.series?.[0];
    const cols = series?.data?.cols || [];
    const rows = series?.data?.rows || [];
    const row = rows[rowIndex];

    if (!row) {
      return marker;
    }

    const nameIndex = cols.findIndex((c) =>
      /customer.*name|name/i.test(c.name),
    );
    const typeIndex = findCategoryColumn(cols, rows);
    const cityIndex = cols.findIndex((c) => /city/i.test(c.name));
    const stateIndex = cols.findIndex((c) => /state/i.test(c.name));
    const regionIndex = cols.findIndex((c) => /region/i.test(c.name));

    const custName = nameIndex >= 0 ? String(row[nameIndex]) : "Facility";
    const custType = typeIndex >= 0 ? String(row[typeIndex]) : "Brewer";
    const city = cityIndex >= 0 ? String(row[cityIndex]) : "";
    const state = stateIndex >= 0 ? String(row[stateIndex]) : "";
    const region = regionIndex >= 0 ? String(row[regionIndex]) : "";
    const info = getCategoryInfo(custType);

    const tooltipEl = document.createElement("div");
    tooltipEl.style.cssText =
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; line-height: 1.4; color: #1E293B; min-width: 140px; padding: 2px;";

    const titleEl = document.createElement("div");
    titleEl.style.cssText =
      "font-weight: 700; font-size: 13px; color: #0F172A; margin-bottom: 4px;";
    titleEl.textContent = custName;
    tooltipEl.appendChild(titleEl);

    const metaEl = document.createElement("div");
    metaEl.style.cssText =
      "display: flex; align-items: center; gap: 6px; margin-bottom: 5px;";

    const badgeEl = document.createElement("span");
    badgeEl.style.cssText = `display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; background: ${info.badgeBg}; color: ${info.badgeColor}; text-transform: uppercase; letter-spacing: 0.3px;`;
    badgeEl.textContent = info.type;
    metaEl.appendChild(badgeEl);

    if (region) {
      const regionEl = document.createElement("span");
      regionEl.style.cssText =
        "color: #64748B; font-size: 11px; font-weight: 500;";
      regionEl.textContent = region;
      metaEl.appendChild(regionEl);
    }
    tooltipEl.appendChild(metaEl);

    const locationText = city + (state ? ", " + state : "");
    if (locationText) {
      const locEl = document.createElement("div");
      locEl.style.cssText = "color: #475569; font-size: 11px;";
      locEl.textContent = `Location: ${locationText}`;
      tooltipEl.appendChild(locEl);
    }

    const hintEl = document.createElement("div");
    hintEl.style.cssText =
      "margin-top: 6px; padding-top: 4px; border-top: 1px solid #E2E8F0; color: #2563EB; font-weight: 600; font-size: 10px; display: flex; align-items: center; gap: 4px;";
    hintEl.textContent = "Click to filter dashboard";
    tooltipEl.appendChild(hintEl);

    marker.unbindTooltip();
    marker.bindTooltip(tooltipEl, {
      direction: "top",
      offset: [0, -28],
      opacity: 0.98,
      className: "nubrix-pin-tooltip",
    });

    marker.on("mousemove", () => {
      const { onHoverChange } = this.props;
      if (!onHoverChange) {
        return;
      }
      const hover: HoveredObject = {
        dimensions: cols.map((col, colIndex) => ({
          value: String(row[colIndex] ?? ""),
          column: col,
        })),
        element: marker.getElement(),
      };
      onHoverChange(hover);
    });

    marker.on("mouseout", () => {
      const { onHoverChange } = this.props;
      onHoverChange?.(null);
    });

    marker.on("click", (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      const { onVisualizationClick, settings } = this.props;
      if (!onVisualizationClick) {
        return;
      }

      // Extract column data
      const data = cols.map((col, index) => ({
        col,
        value: row[index],
      }));

      const dimensions = cols.map((col, index) => ({
        column: col,
        value: row[index],
      }));

      const pkIndex = _.findIndex(cols, isPK);
      const idIndex = cols.findIndex((c) => /customer.*id|id/i.test(c.name));
      const bestColIndex =
        pkIndex >= 0
          ? pkIndex
          : nameIndex >= 0
          ? nameIndex
          : idIndex >= 0
          ? idIndex
          : 0;

      onVisualizationClick({
        value: row[bestColIndex],
        column: cols[bestColIndex],
        dimensions,
        element: marker.getElement(),
        origin: { row, cols },
        settings,
        data,
      });
    });

    return marker;
  };
}
