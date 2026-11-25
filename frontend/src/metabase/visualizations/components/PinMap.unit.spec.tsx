import userEvent from "@testing-library/user-event";

import { renderWithProviders, screen } from "__support__/ui";
import MetabaseSettings from "metabase/utils/settings";
import { createMockVisualizationProps } from "metabase/visualizations/types/mocks";
import type {
  DatasetData,
  RowValue,
  VisualizationSettings,
} from "metabase-types/api";
import {
  createMockColumn,
  createMockDatasetData,
  createMockSingleSeries,
  createMockStructuredDatasetQuery,
} from "metabase-types/api/mocks";
import { ORDERS_ID, SAMPLE_DB_ID } from "metabase-types/api/mocks/presets";

import { LeafletGridHeatMap } from "./LeafletGridHeatMap";
import { LeafletMarkerPinMap } from "./LeafletMarkerPinMap";
import { LeafletTilePinMap } from "./LeafletTilePinMap";
import { PinMap, getPoints } from "./PinMap";

const createData = (cols: string[], rows: RowValue[][]) =>
  createMockDatasetData({
    cols: cols.map((name) => createMockColumn({ name })),
    rows,
  });

describe("getPoints", () => {
  it("rejects non-finite, non-numeric, and out-of-range coordinates", () => {
    const { points, warnings } = getPoints({
      data: createData(
        ["lat", "lng"],
        [
          [NaN, 20],
          [10, Infinity],
          [91, 20],
          [10, -181],
          ["10", 20],
          [90, 180],
          [-90, -180],
        ],
      ),
      latitudeColumnName: "lat",
      longitudeColumnName: "lng",
      isPinMap: true,
    });
    expect(points).toEqual([
      [90, 180, 1],
      [-90, -180, 1],
    ]);
    expect(warnings).toEqual([
      "We filtered out 5 row(s) containing missing or invalid map values.",
    ]);
  });

  it("rejects invalid metrics for heat/grid rendering", () => {
    const { points } = getPoints({
      data: createData(
        ["lat", "lng", "metric"],
        [
          [10, 20, NaN],
          [10, 20, Infinity],
          [10, 20, "5"],
          [10, 20, 0],
        ],
      ),
      latitudeColumnName: "lat",
      longitudeColumnName: "lng",
      metricColumnName: "metric",
    });
    expect(points).toEqual([[10, 20, 0]]);
  });
  it("should filter out rows with null values in either the lat, long, or metric column", () => {
    const { points, warnings } = getPoints({
      data: createData(
        ["lat", "lng", "metric"],
        [
          [null, 0, 0],
          [0, null, 0],
          [0, 0, null],
          [0, 0, 0],
        ],
      ),
      latitudeColumnName: "lat",
      longitudeColumnName: "lng",
      metricColumnName: "metric",
    });

    expect(points).toEqual([[0, 0, 0]]);
    expect(warnings).toEqual([
      "We filtered out 3 row(s) containing null values.",
    ]);
  });

  it("should filter out rows only if the lat or long values are null for pin maps", () => {
    const { points, warnings } = getPoints({
      data: createData(
        ["lat", "lng", "metric"],
        [
          [null, 0, 0],
          [0, null, 0],
          [0, 0, null],
          [1, 2, null],
          [0, 0, 0],
        ],
      ),
      latitudeColumnName: "lat",
      longitudeColumnName: "lng",
      metricColumnName: "metric",
      isPinMap: true,
    });

    expect(points).toEqual([
      [0, 0, null],
      [1, 2, null],
      [0, 0, 0],
    ]);
    expect(warnings).toEqual([
      "We filtered out 2 row(s) containing null values.",
    ]);
  });

  it("should return no warnings when no rows are filtered out", () => {
    const { points, warnings } = getPoints({
      data: createData(
        ["lat", "lng", "metric"],
        [
          [0, 0, 0],
          [1, 2, 3],
        ],
      ),
      latitudeColumnName: "lat",
      longitudeColumnName: "lng",
      metricColumnName: "metric",
    });

    expect(points).toEqual([
      [0, 0, 0],
      [1, 2, 3],
    ]);
    expect(warnings).toEqual([]);
  });

  it("should fall back to world bounds when all rows are filtered out", () => {
    const { points, bounds, warnings } = getPoints({
      data: createData(["lat", "lng", "metric"], [[null, null, null]]),
      latitudeColumnName: "lat",
      longitudeColumnName: "lng",
      metricColumnName: "metric",
    });

    expect(points).toEqual([]);
    expect([
      bounds.getSouth(),
      bounds.getWest(),
      bounds.getNorth(),
      bounds.getEast(),
    ]).toEqual([-90, -180, 90, 180]);
    expect(warnings).toEqual([
      "We filtered out 1 row(s) containing null values.",
    ]);
  });

  it("should sum the metric of rows sharing the same grid cell (metabase#69659)", () => {
    const { points, rows, min, max, warnings } = getPoints({
      data: createMockDatasetData({
        cols: [
          createMockColumn({
            name: "lat",
            display_name: "Latitude",
            binning_info: { bin_width: 10 },
          }),
          createMockColumn({
            name: "lng",
            display_name: "Longitude",
            binning_info: { bin_width: 10 },
          }),
          createMockColumn({ name: "id" }),
          createMockColumn({ name: "count", display_name: "Count" }),
        ],
        rows: [
          [40, -80, 1, 1],
          [40, -80, 2, 1],
          [50, -70, 3, 4],
          [40, -80, 4, 1],
        ],
      }),
      latitudeColumnName: "lat",
      longitudeColumnName: "lng",
      metricColumnName: "count",
      isGridMap: true,
    });

    expect(points).toEqual([
      [40, -80, 3],
      [50, -70, 4],
    ]);
    expect(rows).toEqual([
      [40, -80, 1, 1],
      [50, -70, 3, 4],
    ]);
    expect(min).toBe(3);
    expect(max).toBe(4);
    expect(warnings).toEqual([
      '"Latitude", "Longitude" are unaggregated fields: if there is more than one row with the same values, their measure values will be summed.',
    ]);
  });

  it("should not warn or aggregate when grid cells are unique", () => {
    const { points, warnings } = getPoints({
      data: createData(
        ["lat", "lng", "metric"],
        [
          [40, -80, 1],
          [50, -70, 4],
        ],
      ),
      latitudeColumnName: "lat",
      longitudeColumnName: "lng",
      metricColumnName: "metric",
      isGridMap: true,
    });

    expect(points).toEqual([
      [40, -80, 1],
      [50, -70, 4],
    ]);
    expect(warnings).toEqual([]);
  });

  it("should not aggregate points that share coordinates outside grid maps", () => {
    const { points, warnings } = getPoints({
      data: createData(
        ["lat", "lng", "metric"],
        [
          [40, -80, 1],
          [40, -80, 1],
        ],
      ),
      latitudeColumnName: "lat",
      longitudeColumnName: "lng",
      metricColumnName: "metric",
      isPinMap: true,
    });

    expect(points).toEqual([
      [40, -80, 1],
      [40, -80, 1],
    ]);
    expect(warnings).toEqual([]);
  });

  it("should extend the bounds by one bin to the north/east for binned coordinates", () => {
    const { bounds } = getPoints({
      data: createMockDatasetData({
        cols: [
          createMockColumn({ name: "lat", binning_info: { bin_width: 2 } }),
          createMockColumn({ name: "lng", binning_info: { bin_width: 3 } }),
          createMockColumn({ name: "metric" }),
        ],
        rows: [[10, 20, 1]],
      }),
      latitudeColumnName: "lat",
      longitudeColumnName: "lng",
      metricColumnName: "metric",
    });

    expect([
      bounds.getSouth(),
      bounds.getWest(),
      bounds.getNorth(),
      bounds.getEast(),
    ]).toEqual([10, 20, 12, 23]);
  });
});

describe("PinMap", () => {
  const setup = ({
    isDashboard = false,
    token,
    data = createData(
      ["lat", "lng"],
      [
        [10, 20],
        [null, 30],
      ],
    ),
    settings = {
      "map.type": "pin",
      "map.pin_type": "markers",
      "map.latitude_column": "lat",
      "map.longitude_column": "lng",
    },
  }: {
    isDashboard?: boolean;
    token?: string;
    data?: DatasetData;
    settings?: VisualizationSettings;
  } = {}) => {
    const onRender = jest.fn();
    const onRenderError = jest.fn();

    const series = [
      createMockSingleSeries(
        {
          dataset_query: createMockStructuredDatasetQuery({
            database: SAMPLE_DB_ID,
            query: { "source-table": ORDERS_ID },
          }),
        },
        { data },
      ),
    ];

    const props = createMockVisualizationProps({
      series,
      rawSeries: series,
      data: series[0].data,
      card: series[0].card,
      settings,
      isDashboard,
      height: 300,
      onRender,
      onRenderError,
    });

    const { rerender } = renderWithProviders(
      <PinMap {...props} token={token} />,
    );

    return { onRender, onRenderError, props, rerender };
  };

  beforeEach(() => {
    jest.spyOn(MetabaseSettings, "get").mockImplementation((key: string) => {
      if (key === "map-tile-server-url") {
        return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
      }
      return null;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    { type: "pin", pinType: "markers", renderer: LeafletMarkerPinMap },
    { type: "pin", pinType: "tiles", renderer: LeafletTilePinMap },
    { type: "grid", pinType: "markers", renderer: LeafletGridHeatMap },
    { type: "heat", pinType: "markers", renderer: LeafletGridHeatMap },
  ] as const)(
    "mounts the normalized $type/$pinType renderer",
    ({ type, pinType, renderer }) => {
      const mount = jest.spyOn(renderer.prototype, "componentDidMount");
      const { onRenderError } = setup({
        data: createMockDatasetData({
          cols: [
            createMockColumn({ name: "lat", binning_info: { bin_width: 1 } }),
            createMockColumn({ name: "lng", binning_info: { bin_width: 1 } }),
            createMockColumn({ name: "metric" }),
          ],
          rows: [[10, 20, 5]],
        }),
        settings: {
          "map.type": type,
          "map.pin_type": pinType,
          "map.latitude_column": "lat",
          "map.longitude_column": "lng",
          "map.metric_column": "metric",
        },
      });
      expect(mount).toHaveBeenCalledTimes(1);
      expect(onRenderError).not.toHaveBeenCalled();
    },
  );

  it("should render the 'Set as default view' button with the PinMapUpdateButton class", () => {
    setup();

    const button = screen.getByRole("button", { name: "Set as default view" });
    expect(button).toHaveClass("PinMapUpdateButton");
  });

  it("should render the 'Draw box to filter' button outside dashboards", async () => {
    setup();

    const button = await screen.findByRole("button", {
      name: "Draw box to filter",
    });
    expect(button).toHaveClass("PinMapUpdateButton");
  });

  it("should report rows filtered out because of null coordinates through onRender", () => {
    const { onRender } = setup();

    expect(onRender).toHaveBeenCalledWith({
      warnings: ["We filtered out 1 row(s) containing null values."],
    });
  });

  it("should report the unaggregated data warning for grid maps with duplicated cells (metabase#69659)", () => {
    const { onRender } = setup({
      data: createMockDatasetData({
        cols: [
          createMockColumn({
            name: "lat",
            display_name: "Latitude",
            binning_info: { bin_width: 10 },
          }),
          createMockColumn({
            name: "lng",
            display_name: "Longitude",
            binning_info: { bin_width: 10 },
          }),
          createMockColumn({ name: "count", display_name: "Count" }),
        ],
        rows: [
          [40, -80, 1],
          [40, -80, 1],
        ],
      }),
      settings: {
        "map.type": "grid",
        "map.pin_type": "grid",
        "map.latitude_column": "lat",
        "map.longitude_column": "lng",
        "map.metric_column": "count",
      },
    });

    expect(onRender).toHaveBeenCalledWith({
      warnings: [
        '"Latitude", "Longitude" are unaggregated fields: if there is more than one row with the same values, their measure values will be summed.',
      ],
    });
  });

  it("should not render the 'Set as default view' button for static embedding", () => {
    setup({ token: "token" });

    expect(screen.queryByText("Set as default view")).not.toBeInTheDocument();
  });

  it("should not render either map button on dashboards outside editing", async () => {
    setup({ isDashboard: true });

    expect(await screen.findByText("OpenStreetMap")).toBeInTheDocument();
    expect(screen.queryByText("Set as default view")).not.toBeInTheDocument();
    expect(screen.queryByText("Draw box to filter")).not.toBeInTheDocument();
  });

  it("should toggle the filter button label when starting a box filter", async () => {
    setup();

    await userEvent.click(await screen.findByText("Draw box to filter"));

    expect(screen.getByText("Cancel filter")).toBeInTheDocument();
    expect(screen.queryByText("Draw box to filter")).not.toBeInTheDocument();
  });

  it("should render the heat map through the grid heat renderer", async () => {
    const { props, rerender } = setup({
      data: createMockDatasetData({
        cols: [
          createMockColumn({ name: "lat", binning_info: { bin_width: 1 } }),
          createMockColumn({ name: "lng", binning_info: { bin_width: 1 } }),
          createMockColumn({ name: "metric" }),
        ],
        rows: [[10, 20, 5]],
      }),
      settings: {
        "map.type": "grid",
        "map.pin_type": "grid",
        "map.latitude_column": "lat",
        "map.longitude_column": "lng",
        "map.metric_column": "metric",
      },
    });

    expect(await screen.findByText("Draw box to filter")).toBeInTheDocument();

    rerender(
      <PinMap
        {...props}
        settings={{ ...props.settings, "map.pin_type": "heat" }}
      />,
    );

    expect(screen.getByText("Draw box to filter")).toBeInTheDocument();
  });

  it("should keep the map controls when switching to the heat renderer", async () => {
    const { props, rerender } = setup({
      data: createMockDatasetData({
        cols: [
          createMockColumn({ name: "lat", binning_info: { bin_width: 1 } }),
          createMockColumn({ name: "lng", binning_info: { bin_width: 1 } }),
        ],
        rows: [[10, 20]],
      }),
    });

    expect(await screen.findByText("Draw box to filter")).toBeInTheDocument();

    rerender(
      <PinMap
        {...props}
        settings={{ ...props.settings, "map.pin_type": "heat" }}
      />,
    );

    expect(screen.getByText("Draw box to filter")).toBeInTheDocument();
  });

  it("does not mutate caller-owned rows while filtering invalid points", () => {
    const data = createData(
      ["lat", "lng"],
      [
        [10, 20],
        [null, 30],
      ],
    );
    const rows = data.rows;
    setup({ data });
    expect(data.rows).toBe(rows);
    expect(data.rows).toEqual([
      [10, 20],
      [null, 30],
    ]);
  });

  it("reports invalid grid settings only once across repeated updates", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { props, rerender, onRenderError } = setup({
      settings: {
        "map.type": "grid",
        "map.pin_type": "grid",
        "map.latitude_column": "lat",
        "map.longitude_column": "lng",
      },
    });
    rerender(<PinMap {...props} height={400} />);
    expect(onRenderError).toHaveBeenCalledTimes(1);
    expect(onRenderError).toHaveBeenCalledWith(
      "Grid map requires binned longitude/latitude.",
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("escapes hostile category values in the map legend", () => {
    const data = createData(
      ["CustomerType", "Latitude", "Longitude"],
      [
        ["Brewer", 19.076, 72.877],
        ["<img src=x onerror=alert(1)>", 12.971, 77.594],
      ],
    );
    setup({
      data,
      settings: {
        "map.type": "pin",
        "map.pin_type": "markers",
        "map.latitude_column": "Latitude",
        "map.longitude_column": "Longitude",
      },
    });
    const legend = document.querySelector(".nubrix-map-legend");
    expect(legend).not.toBeNull();
    expect(legend?.querySelectorAll("img").length).toBe(0);
    expect(legend?.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("renders marker icons and tooltips safely for hostile labels", () => {
    const hostileType = '<script>alert(1)</script>" onmouseover="alert(2)';
    const data = createData(
      ["CustomerName", "CustomerType", "Region", "City", "State", "Latitude", "Longitude"],
      [
        ['<img src=x onerror=alert(9)>', hostileType, "<b>West</b>", "Pune", "MH", 18.52, 73.85],
      ],
    );
    setup({
      data,
      settings: {
        "map.type": "pin",
        "map.pin_type": "markers",
        "map.latitude_column": "Latitude",
        "map.longitude_column": "Longitude",
      },
    });
    const marker = document.querySelector(".nubrix-custom-pin-marker");
    expect(marker).not.toBeNull();
    expect(marker?.querySelectorAll("script").length).toBe(0);
    const imgRoleEl = marker?.querySelector('[role="img"]');
    expect(imgRoleEl).not.toBeNull();
    expect(imgRoleEl?.getAttribute("aria-label")).toBe(hostileType);
  });
});
