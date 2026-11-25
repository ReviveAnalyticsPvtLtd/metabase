import type { ClickObject } from "metabase/visualizations/types";
import type { ClickBehavior } from "metabase-types/api";
import { createMockColumn } from "metabase-types/api/mocks";

import {
  getReportCrossFilters,
  isReportCrossFilterActive,
} from "./report-cross-filter";

const column = createMockColumn({ name: "CATEGORY", display_name: "Category" });

function clicked(): ClickObject {
  const behavior: ClickBehavior = {
    type: "crossfilter",
    parameterMapping: {
      category: {
        id: "category",
        source: { type: "column", id: "CATEGORY", name: "Category" },
        target: { type: "parameter", id: "category" },
      },
    },
  };

  // The fixture omits optional visualization click fields not used by this adapter.
  return {
    column,
    settings: { click_behavior: behavior, column_settings: {} },
    data: [{ value: "Gadget", col: column }],
  } as ClickObject;
}

describe("getReportCrossFilters", () => {
  it("maps a crossfilter click to report parameter updates", () => {
    expect(getReportCrossFilters(clicked())).toEqual([
      { parameterId: "category", value: "Gadget" },
    ]);
  });

  it("ignores non-crossfilter clicks", () => {
    expect(getReportCrossFilters(null)).toEqual([]);
  });
});

describe("isReportCrossFilterActive", () => {
  const filters = [{ parameterId: "category", value: "Gadget" }];

  it("is active when the report filter already matches the click", () => {
    expect(isReportCrossFilterActive(filters, { category: "Gadget" })).toBe(
      true,
    );
  });

  it("is inactive when the report filter has a different value", () => {
    expect(isReportCrossFilterActive(filters, { category: "Widget" })).toBe(
      false,
    );
  });

  it("is inactive when the filter has no value yet", () => {
    expect(isReportCrossFilterActive(filters, {})).toBe(false);
    expect(isReportCrossFilterActive(filters, { category: null })).toBe(false);
  });

  it("compares multi-value selections positionally", () => {
    const multi = [{ parameterId: "category", value: ["Gadget", "Widget"] }];

    expect(
      isReportCrossFilterActive(multi, { category: ["Gadget", "Widget"] }),
    ).toBe(true);
    expect(
      isReportCrossFilterActive(multi, { category: ["Widget", "Gadget"] }),
    ).toBe(false);
    expect(isReportCrossFilterActive(multi, { category: ["Gadget"] })).toBe(
      false,
    );
  });

  it("requires every mapped filter to match", () => {
    const multiple = [
      { parameterId: "category", value: "Gadget" },
      { parameterId: "state", value: "CA" },
    ];

    expect(
      isReportCrossFilterActive(multiple, { category: "Gadget", state: "CA" }),
    ).toBe(true);
    expect(
      isReportCrossFilterActive(multiple, { category: "Gadget", state: "NY" }),
    ).toBe(false);
  });

  it("is inactive for a click with no mapped filters", () => {
    expect(isReportCrossFilterActive([], { category: "Gadget" })).toBe(false);
  });
});
