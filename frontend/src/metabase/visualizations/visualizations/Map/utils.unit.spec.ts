import type { VisualizationSettings } from "metabase-types/api";

import { normalizeMapSettings } from "./utils";

describe("normalizeMapSettings", () => {
  it("normalizes legacy grid map settings", () => {
    expect(
      normalizeMapSettings({
        "map.type": "grid",
        "map.pin_type": "markers",
      }),
    ).toMatchObject({
      "map.type": "grid",
      "map.pin_type": "grid",
    });
  });

  it("normalizes legacy heat map settings", () => {
    expect(
      normalizeMapSettings({
        "map.type": "heat",
        "map.pin_type": "markers",
      }),
    ).toMatchObject({
      "map.type": "pin",
      "map.pin_type": "heat",
    });
  });

  it("promotes a grid pin type to the grid map type", () => {
    const settings: VisualizationSettings = {
      "map.type": "pin",
      "map.pin_type": "grid",
    };

    expect(normalizeMapSettings(settings)["map.type"]).toBe("grid");
  });
});
